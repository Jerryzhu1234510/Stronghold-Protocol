// server/accounts/history-hook.js — 把一局的结算写进玩家的对局历史。
//
// 为什么是**服务端**写、而不是客户端上报：客户端上报的话，历史就成了「玩家自己写的战绩」。这与 fork 一致
// （它的 Archive DO 也是服务端在结算时写）。
//
// 挂钩点：`buildResult()`（server/match/results.js）产出结算之后，`Match.finish` 路径调用这里的 `recordOutcome`。
// 结算行里带 `accountId`（lobby 的 humanSeat → PlayerState.accountId → results 行），**没登录的玩家不在历史里**
// —— 没有账号就没有可记的地方，这是账号功能的固有限制，不是缺陷。
//
// 记什么：`{ matchId, endedAt, mode, difficulty, rounds, status, victory, hiddenCleared, operators, stats, rows }`。
// `stats` 是**这一行玩家自己的**统计（从结算行的 `stats` 取，字段名映射到 history.js 的白名单）；`rows` 是整桌
// 的结算，列表页要展示「我这局和谁一起打、各自什么战绩」。
// 回放**不在这里**：它由客户端单独上传（POST /api/me/history/:matchId/replay），因为服务端不产生回放字节。

import { HISTORY_MAX } from '../../shared/account-protocol.js';
import { trophyHalfUnits } from './store.js';

/** 结算行的 stats 键 → history 的 stats 键（名字不同是历史遗留，映射一次比改两边安全）。 */
const STAT_MAP = Object.freeze({
  dmgDealt: 'dmgDealt',
  healing: 'healing',
  kills: 'kills',
  leaks: 'leaks',
  bossDamage: 'bossDamage',
  perfectRounds: 'perfectRounds',
  gold: 'gold',
  refreshes: 'refreshes',
  merges: 'merges',
  lpLost: 'lpLost',
  buys: 'buys',
  sells: 'sells',
});

const mapStats = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [from, to] of Object.entries(STAT_MAP)) {
    const v = Number(raw[from]);
    if (Number.isFinite(v)) out[to] = Math.round(v);
  }
  return out;
};

/** 结算行里出场的干员 id（棋盘上那些，含自选/代打）。 */
function operatorsOf(row) {
  const out = [];
  for (const e of Array.isArray(row?.lineup) ? row.lineup : []) {
    if (!e) continue;
    const id = e.diy?.charId || e.standInFor || e.id;
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 把一局结算写进每个已登录玩家的历史。
 *
 * @param {object} deps
 * @param {import('./history.js').History} deps.history
 * @param {object} deps.log
 * @param {() => number} [deps.now]
 * @returns {(outcome: object, result: object, meta?: object) => number} 写了几条
 */
export function createHistoryRecorder({ history, log, now = Date.now }) {
  if (!history) return () => 0;
  /**
   * @param {{ victory: boolean, hiddenCleared?: boolean, hiddenReached?: boolean, reason?: string }} outcome
   * @param {{ rows?: object[], matchId?: string }} result `buildResult` 的产出
   * @param {{ matchId?: string, mode?: string, difficulty?: string, rounds?: number }} [meta]
   * @returns {number} 写入的账号数
   */
  return function recordOutcome(outcome, result, meta = {}) {
    try {
      // 结算里的行叫 `players`（见 server/match/results.js 的 buildResult）；`rows` 是接受别的来源时用的别名。
      const rows = Array.isArray(result?.players) ? result.players : (Array.isArray(result?.rows) ? result.rows : []);
      // 只记**真人且已登录**的：机器人没有账号，没登录的玩家没有可记的地方（账号功能的固有限制，不是缺陷）。
      const humans = rows.filter((r) => r && !r.isBot && !r.left && r.accountId);
      if (!humans.length) return 0;
      const matchId = String(meta.matchId || result?.matchId || '').slice(0, 128);
      if (!matchId) return 0;
      // 新版结果的首次结算时间固定不变，跨 worker / 断线重送时用于永久防重。
      // 旧 worker 没有新计杯策略标记时只留历史，不给旧规则猜算补分。
      const stableEndedAt = meta.endedAt ?? result?.endedAt;
      const hasStableTime = Number.isSafeInteger(stableEndedAt) && stableEndedAt > 0;
      const policy = result?.trophyPolicy;
      const canCredit = hasStableTime && policy?.version === 1 && typeof policy.custom === 'boolean'
        && policy.multiplier === (policy.custom ? 0.5 : 1) && policy.reason === (policy.custom ? 'custom' : 'normal');
      const endedAt = hasStableTime ? stableEndedAt : now();
      // 整桌一行一份（历史里要展示"和谁一起打"）：只留展示需要的最小字段
      const table = rows.filter((r) => r && !r.isBot).map((r) => ({
        seat: r.seat,
        name: r.name,
        operators: operatorsOf(r),
        damageDealt: Number(r.stats?.dmgDealt) || 0,
        damageTaken: Number(r.stats?.dmgTaken) || 0,
        kills: Number(r.stats?.kills) || 0,
        leaked: Number(r.stats?.leaks) || 0,
        lp: Number(r.lp) || 0,
        survived: !!r.alive,
        trophies: canCredit ? trophyHalfUnits(r.trophies) / 2 : 0,
      }));
      const base = {
        matchId, endedAt,
        mode: meta.mode || 'coop',
        difficulty: meta.difficulty || '',
        rounds: Number(meta.rounds) || 0,
        status: 'completed',
        victory: !!outcome?.victory,
        hiddenCleared: !!outcome?.hiddenCleared,
        rows: table,
      };
      let n = 0;
      for (const r of humans) {
        const own = {
          ...base,
          operators: operatorsOf(r),
          stats: mapStats(r.stats),
          victory: typeof r.victory === 'boolean' ? r.victory : base.victory,
          trophies: canCredit ? trophyHalfUnits(r.trophies) / 2 : 0,
        };
        try {
          if (canCredit) {
            if (history.recordOutcome(r.accountId, own)) n++;
          } else if (!history.get(r.accountId, matchId)) {
            history.record([r.accountId], own);
            n++;
          }
        } catch (e) {
          // 一个账号写失败不该影响别人
          log?.warn?.(`[accounts] 历史写入失败 accountId=${r.accountId}`, e?.message ?? e);
        }
      }
      return n;
    } catch (e) {
      log?.error?.('[accounts] 历史钩子出错', e);
      return 0;
    }
  };
}

export { HISTORY_MAX, mapStats, operatorsOf };
