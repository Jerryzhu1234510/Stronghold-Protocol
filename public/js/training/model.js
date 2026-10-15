// Local-only training scenarios. No network, accounts, room state or result uploads.
import { computeBonds } from '../../../server/match/bondsMeta.js';

export const TRAINING_KEY = 'sp-local-training-v1';
export const TRAINING_HISTORY_KEY = 'sp-local-training-results-v1';
export const LIMITS = Object.freeze({ units: 12, enemies: 100, groups: 12, items: 2, layers: 999, seconds: 300 });
export const DATA_FILES = Object.freeze(['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects', 'backups']);
const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj || {}, key);
const integer = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${label}应为 ${min}～${max} 的整数`);
  return v;
};

export function deployTiles(raw, stageId, kind = 'normal') {
  const d = raw.stages?.[stageId]?.deployTiles?.[kind === 'boss' ? 'bossLeft' : 'normal'];
  if (!d) throw new Error('地图不支持此战场');
  // Inputs remain board-relative; the Battle applies its usual boss row offset.
  const map = ([r, c]) => [kind === 'boss' ? r + 7 : r, c];
  return { melee: (d.melee || []).map(map), ranged: (d.rangedOnly || []).map(map) };
}

export function legalTiles(raw, scenario, chessId) {
  const d = deployTiles(raw, scenario.stageId, scenario.kind);
  return raw.chess[chessId]?.position === 'MELEE' ? d.melee : [...d.ranged, ...d.melee];
}

export function validateScenario(input, raw) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('训练方案无效');
  if (!own(raw.stages, input.stageId)) throw new Error('未知地图');
  if (!['normal', 'boss'].includes(input.kind)) throw new Error('未知战场类型');
  const seed = integer(input.seed, 1, 0xffffffff, '随机种子');
  const seconds = integer(input.seconds, 10, LIMITS.seconds, '训练时长');
  const round = integer(input.round, 1, 20, '测试回合');
  const hpMul = integer(input.hpMul, 1, 96, '敌人生命倍率');
  if (!Array.isArray(input.units) || input.units.length > LIMITS.units) throw new Error(`最多 ${LIMITS.units} 名干员`);
  const occupied = new Set();
  const units = input.units.map((u, i) => {
    if (!u || !own(raw.chess, u.chessId) || raw.chess[u.chessId].isDiy) throw new Error('请使用已收录的具名干员');
    if (!legalTiles(raw, input, u.chessId).some(([r, c]) => r === u.row && c === u.col)) throw new Error(`第 ${i + 1} 名干员格位不可部署`);
    const key = `${u.row},${u.col}`;
    if (occupied.has(key)) throw new Error('干员格位不能重叠');
    occupied.add(key);
    if (!['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(u.dir)) throw new Error('干员朝向无效');
    if (!Array.isArray(u.items) || u.items.length > LIMITS.items || u.items.some(id => !own(raw.items, id) || raw.items[id].itemType !== 'EQUIP')) throw new Error('每名干员最多携带两件有效装备');
    return { chessId: u.chessId, row: u.row, col: u.col, dir: u.dir, items: [...u.items] };
  });
  const layers = {};
  for (const [id, n] of Object.entries(input.layers || {})) {
    if (!own(raw.bonds, id)) throw new Error('未知盟约');
    layers[id] = integer(n, 0, LIMITS.layers, '盟约层数');
  }
  if (!Array.isArray(input.enemies) || input.enemies.length > LIMITS.groups) throw new Error(`最多 ${LIMITS.groups} 组敌人`);
  let total = 0;
  const enemies = input.enemies.map(e => {
    if (!e || !own(raw.enemies, e.enemyKey)) throw new Error('未知敌人');
    const count = integer(e.count, 1, LIMITS.enemies, '敌人数量'); total += count;
    const time = integer(e.time, 0, seconds - 1, '入场时间');
    const interval = integer(e.interval, 0, 30, '入场间隔');
    if (time + (count - 1) * interval >= seconds) throw new Error('最后一名敌人必须在训练结束前入场');
    return { enemyKey: e.enemyKey, count, time, interval };
  });
  if (total > LIMITS.enemies) throw new Error(`敌人总数最多 ${LIMITS.enemies}`);
  return { version: 1, stageId: input.stageId, kind: input.kind, seed, seconds, round, hpMul, noBossCap: input.noBossCap === true, units, enemies, layers };
}

export function trainingBonds(scenario, raw) {
  const gd = {
    chess: id => raw.chess[id], item: id => raw.items[id], bond: id => raw.bonds[id],
    baseIdOf: id => raw.chess[id]?.baseId || id, isGolden: id => !!raw.chess[id]?.isGolden,
    bondIds: Object.keys(raw.bonds), modeInactiveBonds: new Set(),
  };
  const board = new Map(scenario.units.map((u, i) => [i, { kind: 'chess', id: u.chessId, items: u.items.map(id => ({ id })) }]));
  return computeBonds(gd, { board, hand: [], layers: scenario.layers });
}

export function battleOptions(input, raw) {
  const s = validateScenario(input, raw);
  if (!s.units.length || !s.enemies.length) throw new Error('至少放置一名干员和一组敌人');
  const top = s.kind === 'boss' ? 2 : 9;
  const routes = ['WALK', 'FLY'].map(motion => ({ motion, start: [top, 10], end: [top, 2], checkpoints: [] }));
  return {
    fieldId: 'local-training', battleId: 'local-training', kind: s.kind, seed: s.seed,
    modeId: 'mode_multi_hard', round: s.round, stageId: s.stageId, timeLimit: s.seconds,
    routes, content: 'full',
    flags: { dpInit: 99, dpMax: 99, dpPerSec: 1, layerGainsEnabled: true,
      extensionBossHp: s.hpMul, extensionEnemyHp: s.hpMul, extensionBossNoDamageLimit: s.noBossCap },
    players: [{ playerId: 'training', seat: 0, side: 'L', colOffset: 0, bonds: trainingBonds(s, raw),
      units: s.units.map((u, i) => ({ ...u, uid: i + 1, kind: 'chess', items: u.items.map(id => ({ id })) })) }],
    spawns: s.enemies.map(e => ({ ...e, routeIndex: raw.enemies[e.enemyKey]?.isFlyEnemy || raw.enemies[e.enemyKey]?.stats?.motion === 'FLY' ? 1 : 0,
      // Boss rank alone only selects HP scaling. The production damage limit uses
      // isBoss, established by the spawn's boss tag. Training has one player and
      // no shared pool, so the boss kit's multiplayer mirror never activates.
      ...(s.kind === 'boss' && raw.enemies[e.enemyKey]?.rank === 'BOSS' ? { tag: 'boss' } : {}),
      ownerPlayerId: 'training', countInTotal: true })),
  };
}

export function defaultScenario(raw) {
  const s = { version: 1, stageId: own(raw.stages, 'act2autochess_m01') ? 'act2autochess_m01' : Object.keys(raw.stages)[0],
    kind: 'normal', seed: 20261015, seconds: 90, round: 11, hpMul: 1, noBossCap: false, units: [], enemies: [], layers: {} };
  for (const name of ['星熊', '能天使', '白面鸮']) {
    const c = Object.values(raw.chess).find(c => c.name === name && !c.isGolden && !c.isDiy);
    if (!c) continue;
    const tile = legalTiles(raw, s, c.chessId).find(([r, col]) => !s.units.some(u => u.row === r && u.col === col));
    if (tile) s.units.push({ chessId: c.chessId, row: tile[0], col: tile[1], dir: 'RIGHT', items: [] });
  }
  const enemyKey = own(raw.enemies, 'enemy_1000_gopro_2') ? 'enemy_1000_gopro_2' : Object.keys(raw.enemies)[0];
  s.enemies = [{ enemyKey, count: 6, time: 2, interval: 2 }];
  return s;
}

export function saveTraining(storage, scenario, raw) {
  const clean = validateScenario(scenario, raw);
  storage.setItem(TRAINING_KEY, JSON.stringify(clean));
  return clean;
}

export function loadTraining(storage, raw) {
  try { const text = storage.getItem(TRAINING_KEY); return text ? validateScenario(JSON.parse(text), raw) : defaultScenario(raw); }
  catch { return defaultScenario(raw); }
}

export function summarizeTraining(battle, scenario) {
  const r = battle.result();
  return { kind: 'local-training', at: Date.now(), scenario: JSON.parse(JSON.stringify(scenario)),
    time: r.time, reason: r.reason, killed: r.killed, total: r.total, errors: r.errors,
    leaked: r.perPlayer?.training?.leaked?.length || 0,
    units: (r.perPlayer?.training?.unitStats || []).map(u => ({ name: u.name, dmg: u.dmg, heal: u.heal, taken: u.taken, kills: u.kills })) };
}

export function saveTrainingResult(storage, result) {
  if (result.kind !== 'local-training') throw new Error('仅可保存训练记录');
  let history = [];
  try { const a = JSON.parse(storage.getItem(TRAINING_HISTORY_KEY) || '[]'); if (Array.isArray(a)) history = a.slice(0, 9); } catch { /* isolated storage */ }
  storage.setItem(TRAINING_HISTORY_KEY, JSON.stringify([result, ...history]));
}
