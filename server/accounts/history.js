// server/accounts/history.js — 对局历史（含回放）。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 记录形状参考 fork 的 `shared/history.js`（它有一套 `STAT_FIELDS` 与 `aggregateStats`），但**存储是本移植自己定的**：
// fork 把历史放在每个账号的 Durable Object 里、回放另存进 `MATCH_ARCHIVES` DO 并在 `.replay-engines/` 里留一份**规则
// 版本快照**。本移植没有 DO，也**刻意不做规则版本归档**（见下），所以：
//
//   · 一条记录 = `{ matchId, endedAt, mode, difficulty, rounds, status, victory, hiddenCleared, operators, stats, rows, replay? }`
//     `rows` 是每名玩家一行的结算（谁、什么干员、多少伤害 —— 列表页要展示「我这局干了什么」）；
//   · **回放是一个可选的压缩串**（客户端把 `b.ev` 流自己打包，服务端只当不透明字节存），超过 `REPLAY_MAX_BYTES` 就
//     只留结算、不留回放 —— 服务端**不解析**回放，所以不需要理解它的格式；
//   · **不做规则版本归档**：fork 需要它是因为 DO 上的老回放要用老引擎重放（引擎变了回放就放不出来）。本移植的
//     回放由**客户端**读，客户端跟着服务器一起升级，所以版本错配的窗口只在「升级瞬间正在对局」的那一次 ——
//     这个代价远小于维护一套引擎快照（`.replay-engines/` 30 个文件 + `replay-versions/` 14 个）。**这是刻意的取舍**，
//     回放读不出来时客户端应该提示「这局回放来自旧版本」，而不是崩溃。
//   · 每账号最多 `HISTORY_MAX` 条，超出丢最旧的。
//
// 写入由服务端在**结算时**做（server/match 的结算路径），**不是客户端上报** —— 客户端能上报的话，历史就成了
// 「玩家自己写的战绩」。这一点与 fork 一致（它的 Archive DO 也是服务端写）。

import {
  AccountError, HISTORY_MAX, HISTORY_MAX_ROWS, REPLAY_MAX_BYTES, pageLimit,
} from '../../shared/account-protocol.js';
import { trophyHalfUnits } from './store.js';

/** 一局的状态。 */
export const MATCH_STATUS = Object.freeze(['completed', 'left', 'interrupted']);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, max, d = '') => (typeof v === 'string' && v.length <= max ? v : d);

/** 一局里「我」这一行的统计白名单（其余字段一律丢弃：历史是长期数据，不能让任意键越积越多）。 */
const STAT_KEYS = Object.freeze(['dmgDealt', 'healing', 'kills', 'leaks', 'bossDamage', 'perfectRounds', 'gold', 'refreshes', 'merges', 'lpLost', 'buys', 'sells']);

const cleanStats = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of STAT_KEYS) if (Number.isFinite(Number(raw[k]))) out[k] = Math.round(num(raw[k]));
  return out;
};

/** 一名玩家在结算里的一行。 */
const cleanRow = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const row = {
    seat: Math.max(0, Math.min(7, Math.round(num(raw.seat)))),
    name: str(raw.name, 64, '？'),
    operators: Array.isArray(raw.operators)
      ? raw.operators.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 32)
      : [],
    damageDealt: Math.round(num(raw.damageDealt)),
    damageTaken: Math.round(num(raw.damageTaken)),
    kills: Math.round(num(raw.kills)),
    leaked: Math.round(num(raw.leaked)),
    lp: Math.round(num(raw.lp)),
    survived: !!raw.survived,
    trophies: trophyHalfUnits(raw.trophies) / 2,
  };
  if (!Number.isFinite(Number(raw.bondMax))) delete row.bondMax;
  else row.bondMax = Math.round(num(raw.bondMax));
  return row;
};

export class History {
  constructor(store, { now = Date.now } = {}) {
    this.store = store;
    // 必须是**函数**，别写成 `now = Date.now()` —— 那样 `now` 会在构造时被调用成**一个数字**，
    // 而 `clean()` 里调的是 `this.now()`，于是抛 "this.now is not a function"。端到端测试抓到的。
    this.now = typeof now === 'function' ? now : () => now;
  }

  /**
   * 通用历史写入（导入/回放等）：只存记录，不增加累计杯数；权威结算使用 recordOutcome。
   * @param {string|string[]} accountIds 这一局要记进谁的账号（通常是自己队伍里的真人）
   * @param {object} fact 结算事实（见文件头的字段表）
   */
  record(accountIds, fact) {
    const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter((x) => typeof x === 'string' && x);
    if (!ids.length) return null;
    const clean = this.clean(fact);
    for (const id of ids) this.store.pushHistory(id, { ...clean }, HISTORY_MAX);
    this.store.flush();
    return clean;
  }

  /** 权威结算专用：不能由历史导入、回放上传或客户端上报调用。 */
  recordOutcome(accountId, fact) {
    if (!Number.isSafeInteger(fact?.endedAt) || fact.endedAt <= 0) return null;
    const clean = this.clean(fact);
    const added = this.store.recordAccountOutcome(accountId, clean, HISTORY_MAX);
    // 首次写盘失败后的重试也要再次刷盘，但不能再次加杯。
    this.store.flush();
    if (this.store._dirty) throw new Error('Account outcome could not be persisted');
    return added ? clean : null;
  }

  /** 把一份原始事实清洗成能长期存的记录（也用于导入时的校验）。 */
  clean(fact) {
    if (!fact || typeof fact !== 'object') throw new AccountError('INVALID_MATCH');
    const matchId = str(fact.matchId, 128);
    if (!matchId) throw new AccountError('INVALID_MATCH');
    const status = MATCH_STATUS.includes(fact.status) ? fact.status : 'interrupted';
    const rows = Array.isArray(fact.rows)
      ? fact.rows.map(cleanRow).filter(Boolean).slice(0, HISTORY_MAX_ROWS)
      : [];
    const out = {
      matchId,
      endedAt: Math.round(num(fact.endedAt, this.now())),
      mode: str(fact.mode, 32, 'coop'),
      difficulty: str(fact.difficulty, 32, ''),
      rounds: Math.max(0, Math.round(num(fact.rounds))),
      status,
      victory: !!fact.victory,
      hiddenCleared: !!fact.hiddenCleared,
      trophies: trophyHalfUnits(fact.trophies) / 2,
      operators: Array.isArray(fact.operators)
        ? fact.operators.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 64)
        : [],
      stats: cleanStats(fact.stats),
      rows,
    };
    // 回放：只有确实是字符串且没超上限才留（服务端不解析它）
    if (typeof fact.replay === 'string' && fact.replay.length > 0) {
      if (Buffer.byteLength(fact.replay) <= REPLAY_MAX_BYTES) out.replay = fact.replay;
      else out.replaySkipped = 'too-large';
    }
    return out;
  }

  /** 列表（**不含回放**，列表页不需要它，别把几 MB 传下去）。 */
  list(accountId, { limit = 20, before = null } = {}) {
    const lim = pageLimit(Math.min(50, Math.max(1, Math.round(limit))));
    let rows = this.store.historyOf(accountId);
    if (before) {
      const at = Number.parseInt(before, 10);
      if (Number.isFinite(at)) rows = rows.filter((r) => r.endedAt < at);
    }
    return rows.slice(0, lim).map(({ replay, ...rest }) => rest);
  }

  /** 一条完整记录（含回放）。 */
  get(accountId, matchId) {
    const row = this.store.historyOf(accountId).find((r) => r.matchId === matchId);
    return row ? { ...row } : null;
  }

  /** 历史统计限于保留的记录；totalTrophies 独立持久保存，不受历史裁剪影响。 */
  summary(accountId) {
    const rows = this.store.historyOf(accountId);
    const done = rows.filter((r) => r.status === 'completed');
    const wins = done.filter((r) => r.victory).length;
    const totals = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.stats || {})) totals[k] = (totals[k] || 0) + v;
    const ops = new Map();
    for (const r of rows) for (const id of new Set(r.operators || [])) ops.set(id, (ops.get(id) || 0) + 1);
    return {
      total: rows.length,
      completed: done.length,
      wins,
      totalTrophies: this.store.totalTrophiesOf(accountId),
      left: rows.filter((r) => r.status === 'left').length,
      interrupted: rows.filter((r) => r.status === 'interrupted').length,
      winRate: done.length ? wins / done.length : null,
      highestRound: rows.reduce((n, r) => Math.max(n, r.rounds || 0), 0),
      hiddenCleared: done.filter((r) => r.hiddenCleared).length,
      totals,
      operators: [...ops].map(([id, matches]) => ({ id, matches })).sort((a, b) => b.matches - a.matches || a.id.localeCompare(b.id)),
    };
  }

  /** 管理统计。 */
  stats() {
    const rows = Object.values(this.store.db.history);
    return {
      accounts: rows.filter((l) => l.length).length,
      rows: rows.reduce((n, l) => n + l.length, 0),
      withReplay: rows.reduce((n, l) => n + l.filter((r) => r.replay).length, 0),
    };
  }
}
