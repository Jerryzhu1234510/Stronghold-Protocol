import { Battle } from '../sim/Battle.js';
import { MODULES } from '../sim/content/index.js';
import { install as installGarrisons } from '../sim/content/garrisons/battle.js';
import { installItem } from '../sim/content/items/battle.js';
import { unitInfo } from '../sim/snapshot.js';
import { GameData } from '../match/gamedata.js';
import { computeBonds } from '../match/bondsMeta.js';
import { drawDisabledBonds, SharedPool } from '../match/pool.js';
import { PlayerAcquire } from '../match/player/acquire.js';
import { mergeTile } from '../match/board.js';
import { detachOperator, relocatePair } from './roster.js';
import { createRng } from '../sim/rng.js';
import { resolveLoadout, unitStatsEntry } from '../../shared/protocol.js';
import { data, byId, OPERATORS, MONSTERS, EQUIPMENT, RECT, STAGE } from './catalog.js';
import { triggerMeta, applyPassives, traitsOf, installEgirRevives, tickEgirLayers } from './traits.js';
import { versusCanStand } from '../../shared/versusPlacement.js';
import { validMapVersion } from '../../shared/roomDirectory.js';
import { installRaid } from '../sim/content/bonds/addon/battle.js';
import { versusUpgradeState, VERSUS_UPGRADE_COOLDOWN, VERSUS_INCOME_INTERVAL, VERSUS_ATTACK_REWARD, VERSUS_LAYER_CAP, versusIncomeInterval, grantVersusCoins } from '../../shared/versusEconomy.js';
import { resetMetaWindow, recordMeta, settleMetaWindows, consumeTraitItem } from './metaWindow.js';

export const GROUP_COLORS = ['#59c9f5', '#f1c75b', '#b89aff', '#70d5a3'];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const directions = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const liveUnitInfo = (u) => ({ ...unitInfo(u), live: { ...unitStatsEntry(u, u.s), src: 'battle' } });
function offsetEvent(raw, offset) {
  const e = structuredClone(raw), type = e[0];
  if (type === 'spawn') e[1].id += offset;
  else if (['deploy', 'dmg', 'heal', 'skill', 'cast', 'die', 'leak', 'status'].includes(type)) e[1] += offset;
  else if (type === 'atk') { e[1] += offset; if (typeof e[2] === 'number') e[2] += offset; }
  else if (type === 'fx' && e[4]) for (const key of ['id', 'from', 'to', 'sourceId', 'targetId']) {
    if (typeof e[4][key] === 'number') e[4][key] += offset;
  }
  return e;
}
export const ownCol = (p, c) => p.side === 'R' ? 20 - c : c;
export function powerAt(t) {
  if (t < 120) return { hp: 0.7, atk: 0.7, level: -1 };
  const n = Math.floor((t - 120) / 60);
  return { hp: Math.min(2, 1.35 ** n), atk: Math.min(2, 1.15 ** n), level: n };
}
export class VersusRoom {
  constructor(code, { seed = Date.now(), prepSeconds = 20, duelSeconds = 480, infoSeconds = 25, stageId, mapVersion = 'new', playerCount = 8 } = {}) {
    this.code = code; this.seed = seed >>> 0; this.prepSeconds = prepSeconds; this.duelSeconds = duelSeconds;
    this.time = 0; this.status = 'lobby'; this.players = []; this.duels = []; this.history = [];
    this.playerCount = playerCount;
    this.round = 0; this.nextUid = 1; this.nextPlayer = 1; this.host = null; this.champion = null;
    this.randomState = this.seed || 1;
    this.infoSeconds = infoSeconds; this.mapVersion = validMapVersion(mapVersion) ? mapVersion : 'new';
    this.stage = data.stages[stageId] || this.pick(Object.values(data.stages).filter(s => s.active && s.weight > 0)) || STAGE;
    // Independent PvP rules: no large-room ban reduction, strategy HP bonus or co-op pool multiplier.
    this.gd = new GameData(data, 'NORMAL', { capacity: 4 });
    this.bans = drawDisabledBonds(this.gd, createRng(this.seed));
    for (const id of this.bans.drawn) this.gd.modeInactiveBonds.add(id);
    this.bannedChess = new Set(this.bans.banned);
    this.rewardPool = new SharedPool(this.gd, { banned: [...this.bannedChess] });
  }
  random() { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0; return this.randomState / 4294967296; }
  pick(list) { return list[Math.floor(this.random() * list.length)]; }
  join(name, bot = false) {
    assert(this.status === 'lobby', '对局已经开始'); assert(this.players.length < this.playerCount, '房间已满');
    const p = { id: `p${this.nextPlayer++}`, name: String(name || '博士').trim().slice(0, 16), bot,
      room: this, coins: 20, level: 1, upgradeNext: 0, strategy: null, infoReady: bot, operators: [], monsters: {}, items: [], offers: [],
      layers: {}, bonds: {}, shop: {}, freeRefresh: 0, refreshCount: 0, economyNext: 0, freeRefreshNext: 0,
      hp: 20, eliminated: false, duel: null, kills: 0, killValue: 0, launchNext: 0, duelTime: 0, connected: true,
      stats: { kills: 0, leaks: 0, launched: 0, merges: 0, spent: 0 }, placement: null };
    resetMetaWindow(p);
    this.players.push(p); if (!this.host && !bot) this.host = p.id;
    this.refresh(p, false); return p;
  }
  refresh(p, paid = true) {
    const free = p.freeRefresh > 0;
    if (paid) { assert(p.freeRefresh > 0 || p.coins >= 1, '金币不足'); if (p.freeRefresh) p.freeRefresh--; else { p.coins--; p.stats.spent++; } }
    const level = p.level;
    const ops = OPERATORS.filter(o => !this.bannedChess.has(o.id) && o.tier <= Math.min(6, level + 1));
    p.shop = {
      operator: Array.from({ length: 5 }, () => this.pick(ops)?.id),
      monster: Array.from({ length: 5 }, () => this.pick(MONSTERS.filter(e => e.tier <= level))?.id),
      equipment: Array.from({ length: 1 }, () => this.pick(EQUIPMENT.filter(e => e.tier <= level))?.id),
    };
    if (paid) { p.refreshCount++; this.onManualRefresh(p, free); }
  }
  start(id, fill = false) {
    assert(id === this.host, '只有房主能开始'); assert(this.status === 'lobby', '对局已经开始');
    if (fill) while (this.players.length < this.playerCount) this.join(`AI · ${this.players.length + 1}`, true);
    assert(this.players.length === this.playerCount, `需要 ${this.playerCount} 名玩家，可以补齐 AI`);
    this.status = 'info'; this.deadline = this.time + this.infoSeconds;
    if (this.infoSeconds <= 0) this.finishInfo();
  }
  finishInfo() {
    const entrants = [...this.players];
    for (let i = entrants.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [entrants[i], entrants[j]] = [entrants[j], entrants[i]]; }
    this.beginStage(entrants);
  }
  beginStage(entrants) {
    this.round++; this.status = 'preparation'; this.deadline = this.time + this.prepSeconds;
    this.duels = [];
    for (let i = 0; i < entrants.length; i += 2) {
      const pair = [entrants[i], entrants[i + 1]];
      const d = { id: `r${this.round}d${i / 2}`, color: GROUP_COLORS[i / 2], pair, battles: [], elapsed: 0, done: false, winner: null, reason: null };
      this.duels.push(d);
      pair.forEach((p, j) => {
        Object.assign(p, { hp: 20, duel: d.id, side: j ? 'R' : 'L', layers: {}, bonds: {}, kills: 0,
          killValue: 0, launchNext: 0, duelTime: 0, economyNext: 0, freeRefreshNext: 0, refreshCount: 0, giftIndex: 0 });
        resetMetaWindow(p);
      });
      d.battles = pair.map(p => this.makeBattle(p, d));
      for (const p of pair) {
        for (const o of p.operators) if (o.row != null) this.addOperator(p, o);
        this.syncBonds(p);
      }
      if (pair.some(p => p.eliminated)) this.finishDuel(d, pair.find(p => !p.eliminated) || pair[0], '退出');
    }
  }
  makeBattle(p, d) {
    // Each defender runs the proven engine with only incoming enemies. The two feeds share one mirrored field.
    const b = new Battle({ seed: this.seed + this.round, kind: 'boss', fieldId: d.id,
      stage: this.stage, rect: RECT, spawns: [], autoFinish: false, timeLimit: Infinity, content: 'generic',
      flags: { dpInit: 999, dpMax: 999, dpPerSec: 0, layerGainsEnabled: true, bondLayerCap: VERSUS_LAYER_CAP },
      players: [{ playerId: p.id, coords: 'field', side: p.side, units: [], bonds: {} }],
    });
    b.contentMode = 'full';
    installEgirRevives(b, p);
    // Original round/boss/bond domains must not run in this continuous prototype.
    for (const [name, mod] of MODULES) if (['tokens', 'enemies'].includes(name)) mod.install?.(b);
    installRaid(b, { canStand: (r, c, u) => r >= 2 && r <= 5 && ownCol(p, c) >= 3 && ownCol(p, c) <= 9
      && versusCanStand(b.grid, this.stage, r, c, u.def.raw) });
    b.on('enemySpawn', ({ enemy }) => {
      if (!enemy.sourcePlayerId) return;
      enemy.versusPurchased = true; enemy.versusPrice = 0;
      enemy.versusPower = powerAt(d.elapsed).level;
      enemy.versusGoal = [2, p.side === 'L' ? 2 : 18];
      // Follow ground routes without changing flight targeting or blocking rules, including spawned children.
      enemy.route.groundPath = true;
    });
    b.start();
    b.on('enemyLeak', ({ enemy }) => {
      if (enemy.versusLeakCounted) return;
      enemy.versusLeakCounted = true;
      const before = p.hp;
      p.hp = Math.max(0, p.hp - Math.max(1, enemy.lpr || 1)); p.stats.leaks++;
      const attacker = d.pair.find(other => other.role === 'attack' && other.id === enemy.sourcePlayerId);
      if (p.role === 'defend' && p.hp < before && attacker) grantVersusCoins(attacker, VERSUS_ATTACK_REWARD);
    });
    b.on('death', ({ unit, reason }) => {
      if (p.role !== 'defend' || unit.kind !== 'op' || unit.ownerId !== p.id || reason !== 'killed' || unit.alive
        || unit.versusRewardedDeath === unit.deploySeq) return;
      const attacker = d.pair.find(other => other.role === 'attack');
      if (!attacker) return;
      unit.versusRewardedDeath = unit.deploySeq;
      grantVersusCoins(attacker, VERSUS_ATTACK_REWARD);
    }, { priority: 100 }); // Record the fallen deployment before instant revives advance deploySeq.
    b.on('kill', ({ victim }) => {
      if (victim.side !== 'enemy' || !victim.versusPurchased || victim.versusRewarded) return;
      victim.versusRewarded = true; p.kills++; p.stats.kills++; p.killValue += victim.versusPrice;
      grantVersusCoins(p, 1);
      if (p.pendingKillGold > 0 && p.economyNext <= p.duelTime) {
        grantVersusCoins(p, 1); p.pendingKillGold--; p.economyNext = p.duelTime + 4;
      }
      for (const o of [...p.operators]) {
        triggerMeta(p, o, 'SERVER_PREP_START', 'kill'); triggerMeta(p, o, 'SERVER_PREP_FIN', 'kill');
      }
      this.syncBonds(p);
    });
    const realCoins = b.addCoins.bind(b);
    b.addCoins = (pid, n) => {
      if (p.economyNext > p.duelTime || n <= 0) return 0;
      const gained = grantVersusCoins(p, 1); p.economyNext = p.duelTime + 4;
      return gained ? realCoins(pid, gained) : 0;
    };
    b.on('layerGain', () => { b.after(0, () => this.readBattleLayers(p)); });
    return b;
  }
  battleOf(p) { const d = this.duels.find(d => d.id === p.duel); return d?.battles[d.pair.indexOf(p)]; }
  addOperator(p, o) {
    const b = this.battleOf(p); if (!b) return;
    const ps = b.getPlayer(p.id);
    const direction = o.dir || 'RIGHT';
    const loadout = resolveLoadout(p.loadout, data.chess[o.id], id => data.chess[id]);
    const input = { uid: o.uid, chessId: o.id, ...loadout, row: o.row, col: ownCol(p, o.col), dir: p.side === 'R' ? ({ LEFT: 'RIGHT', RIGHT: 'LEFT' }[direction] || direction) : direction, items: o.items || [], abs: true };
    ps.input.units = ps.input.units.filter(previous => previous.uid !== o.uid);
    ps.input.units.push(input);
    const u = b._createAllyFromInput(ps, input); assert(u, '干员创建失败');
    u.base.cost = 0; u.markDirty();
    b._setupUnit(u); installGarrisons(b, [u]);
    u.versusItemGrants = new Map();
    for (const item of o.items || []) u.versusItemGrants.set(item, installItem(b, u, item));
    if (!b._deploy(u, { initial: false })) {
      detachOperator(b, o.uid);
      throw new Error('部署失败，地块已被占用');
    }
    this.syncBonds(p);
  }
  readBattleLayers(p) {
    const b = this.battleOf(p); if (!b) return;
    for (const [id, state] of Object.entries(b.getPlayer(p.id).bonds)) p.layers[id] = Math.min(VERSUS_LAYER_CAP, Math.max(p.layers[id] || 0, state.layers || 0));
    this.syncBonds(p);
  }
  syncBonds(p) {
    const board = new Map(p.operators.filter(o => o.row != null).map(o => [`${o.row},${o.col}`, { ...o, kind: 'chess', items: (o.items || []).map(id => ({ id })) }]));
    const hand = p.operators.filter(o => o.row == null).map(o => ({ ...o, kind: 'chess' }));
    p.bonds = computeBonds(this.gd, { board, hand, layers: p.layers });
    const b = this.battleOf(p); if (!b) return;
    b.getPlayer(p.id).bonds = structuredClone(p.bonds); applyPassives(b, p);
  }
  action(p, msg) {
    assert(p && !p.eliminated && this.status !== 'complete', '只能观战');
    if (msg.action === 'infoReady') {
      assert(this.status === 'info', '不在确认阶段'); p.infoReady = true;
      if (this.players.every(p => p.infoReady)) this.finishInfo();
      return;
    }
    assert(this.status !== 'info', '请先确认本局信息');
    const d = this.duels.find(d => d.id === p.duel);
    assert(!d?.done, '本场已结束，等待晋级');
    if (msg.action === 'refresh') { this.refresh(p); return; }
    if (msg.action === 'upgrade') {
      const { price, reason } = versusUpgradeState(p, this.time); assert(!reason, reason);
      p.coins -= price; p.stats.spent += price; p.level++; p.upgradeNext = this.time + VERSUS_UPGRADE_COOLDOWN;
      recordMeta(p, 'spent', price);
      this.refresh(p, false); return;
    }
    if (msg.action === 'buy') {
      const kind = msg.kind, i = msg.index;
      assert(['operator', 'monster', 'equipment'].includes(kind) && Number.isInteger(i), '商店位置无效');
      const id = p.shop[kind][i], card = byId.get(id); assert(card, '商品已售出');
      assert(kind !== 'operator' || !this.bannedChess.has(id), '本局禁用干员');
      let price = card.price;
      if (kind === 'operator') for (const g of traitsOf({ id })) if (g.eventType === 'SERVER_PRICE') price = g.bb.price;
      assert(p.coins >= price, '金币不足');
      assert(kind !== 'operator' || p.operators.length < 16, '干员待部署区已满');
      assert(kind !== 'equipment' || p.items.length < 12, '装备待部署区已满');
      assert(kind !== 'monster' || Object.values(p.monsters).reduce((a, n) => a + n, 0) + card.quantity <= 40, '怪物待部署区已满');
      p.coins -= price; p.stats.spent += price; p.shop[kind][i] = null;
      recordMeta(p, 'spent', price); recordMeta(p, 'buys');
      if (kind === 'operator') {
        this.acquireOperator(p, id, price);
      } else if (kind === 'monster') p.monsters[id] = (p.monsters[id] || 0) + card.quantity;
      else p.items.push({ uid: this.nextUid++, id });
      this.syncBonds(p); return;
    }
    if (msg.action === 'reward') {
      const offer = p.offers[0], slot = offer?.slots[msg.index];
      assert(Number.isInteger(msg.index) && slot && !slot.sold && !this.bannedChess.has(slot.id), '奖励无效');
      assert(p.operators.length < 16, '干员待部署区已满');
      p.offers.shift();
      this.acquireOperator(p, slot.id, 0); this.syncBonds(p); return;
    }
    assert(this.status === 'combat' || this.status === 'preparation', '先开始对局');
    if (msg.action === 'withdraw') {
      const o = p.operators.find(o => o.uid === msg.uid), b = this.battleOf(p);
      const u = b?.allyUnits.find(u => u.uid === o?.uid && !u.removed);
      assert(o && o.row != null && u?.alive, '倒地时不能撤退');
      detachOperator(b, o.uid); o.row = o.col = null; o.egirSeconds = 0; this.syncBonds(p); return;
    }
    if (msg.action === 'deploy' || msg.action === 'move') {
      const o = p.operators.find(o => o.uid === msg.uid); assert(o, msg.action === 'deploy' ? '干员不在待部署区' : '未知干员');
      assert(msg.action !== 'deploy' || o.row == null, '干员不在待部署区');
      assert(msg.action !== 'move' || o.row != null, '干员未部署');
      assert(msg.dir == null || directions.includes(msg.dir), '朝向无效');
      const r = msg.row, c = msg.col, localC = ownCol(p, c);
      assert(Number.isInteger(r) && Number.isInteger(c) && r >= 2 && r <= 5 && localC >= 3 && localC <= 9, '只能部署在己方半场');
      const b = this.battleOf(p);
      const u = b.allyUnits.find(u => u.uid === o.uid && !u.removed);
      const occupant = b.allyUnits.find(u => u.alive && u.deployed && !u.removed && u.tileR === r && u.tileC === c && u.uid !== o.uid);
      const replaced = occupant && p.operators.find(o => o.uid === occupant.uid);
      assert(!b.downOn(r, c) && (!b.isReservedTile(r, c) || replaced || (u?.tileR === r && u?.tileC === c)), '地块被占用');
      assert(versusCanStand(b.grid, this.stage, r, c, data.chess[o.id]), '地块类型不匹配');
      if (msg.action === 'move') {
        assert(u?.alive && u.deployed, '倒地时不能移动');
        if (replaced) assert(versusCanStand(b.grid, this.stage, u.tileR, u.tileC, data.chess[replaced.id]), '交换地块类型不匹配');
        assert(relocatePair(b, u, r, c, occupant), '无法移动');
        if (replaced) { replaced.row = occupant.tileR; replaced.col = ownCol(p, occupant.tileC); }
        o.row = r; o.col = localC;
        if (msg.dir) this.action(p, { action: 'rotate', uid: o.uid, dir: msg.dir });
        this.syncBonds(p); return;
      }
      assert(replaced || p.operators.filter(o => o.row != null).length < 8, '最多部署 8 名干员');
      if (replaced) { detachOperator(b, replaced.uid); replaced.row = replaced.col = null; replaced.egirSeconds = 0; }
      o.row = r; o.col = localC; o.dir = msg.dir || 'RIGHT';
      try { this.addOperator(p, o); } catch (e) { o.row = o.col = null; throw e; }
      return;
    }
    if (msg.action === 'launch') {
      assert(this.status === 'combat' && this.time >= (d.readyAt || 0), '整备阶段不能投怪'); const card = byId.get(msg.id);
      assert(card?.kind === 'monster' && p.monsters[msg.id] > 0, '没有这张怪物卡');
      assert(d.elapsed + 1e-9 >= p.launchNext, '投怪冷却中');
      const r = msg.row, c = msg.col;
      assert(Number.isInteger(r) && Number.isInteger(c) && r >= 2 && r <= 5 && this.launchColumns(p).includes(c), '只能投放在标记的前沿');
      const other = d.pair.find(other => other !== p), target = this.battleOf(other);
      assert(target.grid.groundPassable(r, c), '投放地块不可通行');
      const count = Math.min(card.quantity, p.monsters[msg.id]);
      assert(target.aliveEnemies().filter(e => e.versusPurchased).length + count <= 20, '最多同时投放 20 个怪物，请等待整包投放空间');
      const power = powerAt(d.elapsed);
      for (let i = 0; i < count; i++) {
        const enemy = target.spawnEnemy(msg.id, { pos: [r, c + (i - (count - 1) / 2) * 0.18], ownerPlayerId: other.id, sourcePlayerId: p.id,
          route: { start: [r, c], end: [2, other.side === 'L' ? 2 : 18], checkpoints: [], motion: card.stats.motion },
          mods: { hpMul: power.hp, atkMul: power.atk }, tag: 'versus', countInTotal: true });
        assert(enemy, '投放失败');
        enemy.versusPurchased = true; enemy.versusPrice = card.price / card.quantity; enemy.versusPower = power.level;
        enemy.versusGoal = [2, other.side === 'L' ? 2 : 18];
      }
      p.stats.launched += count;
      p.monsters[msg.id] -= count; if (!p.monsters[msg.id]) delete p.monsters[msg.id]; p.launchNext = d.elapsed + 1;
      return;
    }
    if (msg.action === 'equip') {
      const it = p.items.find(it => it.uid === msg.itemUid), o = p.operators.find(o => o.uid === msg.uid);
      assert(it && o && !o.items.includes(it.id), '无法装备');
      if (consumeTraitItem(p, o, it)) return;
      const replace = msg.replaceIndex;
      assert(o.items.length < 2 || (Number.isInteger(replace) && replace >= 0 && replace < o.items.length), '请选择要替换的装备');
      const b = this.battleOf(p), u = b?.allyUnits.find(u => u.uid === o.uid && !u.removed);
      if (o.items.length >= 2) {
        const old = o.items.splice(replace, 1)[0];
        if (u) { u.versusItemGrants?.get(old)?.dispose(); u.versusItemGrants?.delete(old); u.items.splice(u.items.indexOf(old), 1); }
      }
      if (u) { u.versusItemGrants.set(it.id, installItem(b, u, it.id)); u.items.push(it.id); }
      o.items.push(it.id); p.items.splice(p.items.indexOf(it), 1); this.syncBonds(p); return;
    }
    if (msg.action === 'sell') {
      if (msg.kind === 'monster') {
        assert(byId.get(msg.id)?.kind === 'monster' && p.monsters[msg.id] > 0, '未知怪物');
        const card = byId.get(msg.id), count = Math.min(card.quantity, p.monsters[msg.id]);
        p.monsters[msg.id] -= count; if (!p.monsters[msg.id]) delete p.monsters[msg.id];
        grantVersusCoins(p, Math.floor(card.price * count / card.quantity)); return;
      }
      if (msg.kind === 'equipment') {
        const i = p.items.findIndex(it => it.uid === msg.uid); assert(i >= 0, '未知装备');
        p.items.splice(i, 1); grantVersusCoins(p, 1); return;
      }
      const o = p.operators.find(o => o.uid === msg.uid); assert(o, '未知干员');
      const b = this.battleOf(p), u = b?.allyUnits.find(u => u.uid === o.uid && !u.removed);
      assert(!u || u.alive, '倒地干员不能出售');
      if (u) detachOperator(b, o.uid, 'sold');
      grantVersusCoins(p, 1); p.items.push(...o.items.map(id => ({ id, uid: this.nextUid++ })));
      p.operators.splice(p.operators.indexOf(o), 1); recordMeta(p, 'sells'); triggerMeta(p, o, 'SERVER_CHESS_SOLD', 'sold'); this.syncBonds(p); return;
    }
    if (msg.action === 'rotate') {
      const o = p.operators.find(o => o.uid === msg.uid);
      assert(o && o.row != null && ['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(msg.dir), '朝向无效');
      const b = this.battleOf(p), u = b.allyUnits.find(u => u.uid === o.uid && !u.removed);
      assert(u?.alive, '倒地时不能转向'); o.dir = msg.dir;
      u.dir = p.side === 'R' ? ({ LEFT: 'RIGHT', RIGHT: 'LEFT' }[o.dir] || o.dir) : o.dir;
      b._refreshRange(u); b._ev(['deploy', u.id, u.dir]); return;
    }
    if (msg.action === 'forfeit') { this.finishDuel(d, d.pair.find(other => other !== p), '认输'); return; }
    throw new Error('未知操作');
  }
  finishDuel(d, winner, reason) {
    if (d.done) return;
    d.done = true; d.winner = winner.id; d.reason = reason;
    const loser = d.pair.find(p => p !== winner); loser.eliminated = true;
    loser.placement = [5,3,2][this.round - 1];
    this.history.push({ round: this.round, id: d.id, players: d.pair.map(p => p.id), winner: winner.id, reason,
      hp: d.pair.map(p => p.hp), time: Math.round(d.elapsed), results: d.pair.map(p => this.resultOf(p)) });
  }
  mergeCopies(p, id) {
    const elite = data.chess[id]?.goldenId;
    if (!elite || !byId.has(elite)) return;
    const b = this.battleOf(p);
    const copies = p.operators.filter(o => o.id === id && (o.row == null || b?.allyUnits.find(u => u.uid === o.uid && !u.removed)?.alive));
    if (copies.length < this.gd.mergeCount(id)) return;
    copies.sort((a, c) => Number(c.row != null) - Number(a.row != null) || a.uid - c.uid);
    const selected = copies.slice(0, this.gd.mergeCount(id));
    const tile = mergeTile(selected.filter(o => o.row != null).map(o => ({ key: `${o.row + 7},${o.col}`, uid: o.uid })),
      (row, col) => versusCanStand(b.grid, this.stage, row - 7, ownCol(p, col), data.chess[elite]));
    const kept = selected.find(o => o.uid === tile?.uid) || selected[0];
    if (!tile) kept.row = kept.col = null;
    for (const piece of selected) {
      const u = b?.allyUnits.find(u => u.uid === piece.uid && !u.removed);
      if (u) detachOperator(b, piece.uid, 'merge');
      p.items.push(...piece.items.map(id => ({ uid: this.nextUid++, id })));
      piece.items = [];
      if (piece !== kept) {
        p.operators.splice(p.operators.indexOf(piece), 1);
      }
    }
    kept.id = elite;
    p.stats.merges++;
    PlayerAcquire.prototype.pushRewardOffer.call({ gd: this.gd, shop: { level: p.level }, offers: p.offers,
      m: { pool: this.rewardPool, rngShop: () => this.random() }, diyRollEntries: () => [], dirty: () => {} }, 'merge');
    if (kept.row != null) this.addOperator(p, kept);
    return kept;
  }
  acquireOperator(p, id, price = 0) {
    if (!data.chess[id] || this.bannedChess.has(this.gd.baseIdOf(id)) || p.operators.length >= 16) return null;
    const o = { uid: this.nextUid++, id, items: [], price, row: null, col: null };
    p.operators.push(o); recordMeta(p, 'gainedChess'); this.syncBonds(p);
    const acquired = this.mergeCopies(p, id) || o;
    triggerMeta(p, acquired, 'SERVER_GAIN', 'gain'); this.syncBonds(p); return acquired;
  }
  onManualRefresh(p, free) {
    recordMeta(p, 'refreshes'); if (!free) recordMeta(p, 'spent');
    const owned = [...p.operators];
    for (const o of owned) if (p.operators.includes(o)) triggerMeta(p, o, 'SERVER_REFRESH_SHOP', 'refresh');
    this.syncBonds(p);
  }
  tick(dt = 1 / 30) {
    this.time += dt;
    if (this.status === 'lobby' || this.status === 'complete') return;
    if (this.status === 'info') { if (this.time >= this.deadline) this.finishInfo(); else return; }
    for (const p of this.players) if (this.receivesIncome(p)) grantVersusCoins(p, this.incomeBetween(p, this.time - dt, this.time));
    if (this.status === 'preparation' && this.time >= this.deadline) this.status = 'combat';
    for (const d of this.duels) {
      if (d.done) continue;
      for (const p of d.pair) if (p.bot) this.botAction(p, d);
      if (this.status !== 'combat' || this.time < (d.readyAt || 0)) continue;
      const fighting = Math.max(0, this.time - Math.max(this.time - dt, d.readyAt ?? this.deadline));
      d.elapsed += fighting;
      d.simCarry = (d.simCarry || 0) + fighting * 2;
      const steps = Math.floor((d.simCarry + 1e-9) * 30);
      d.simCarry = Math.max(0, d.simCarry - steps / 30);
      const power = powerAt(d.elapsed);
      for (const p of d.pair) {
        p.duelTime = d.elapsed;
        const b = this.battleOf(p);
        settleMetaWindows(p, d.elapsed);
        for (const e of b.aliveEnemies()) {
          if (!e.versusPurchased || e.versusPower === power.level) continue;
          const previous = powerAt(e.versusPower < 0 ? 0 : 120 + e.versusPower * 60);
          const oldHp = e.s.maxHp, ratio = e.hp / oldHp;
          e.base.maxHp *= power.hp / previous.hp;
          e.base.atk *= power.atk / previous.atk;
          e.mods = { ...e.mods, hpMul: (e.mods?.hpMul ?? 1) * power.hp / previous.hp, atkMul: (e.mods?.atkMul ?? 1) * power.atk / previous.atk };
          e.versusPower = power.level; e.markDirty(); e.hp = e.s.maxHp * ratio;
        }
        for (let step = 0; step < steps; step++) b.step();
        let changed = false;
        for (const [id, state] of Object.entries(b.getPlayer(p.id).bonds)) {
          const value = Math.min(VERSUS_LAYER_CAP, state.layers || 0);
          if ((p.layers[id] || 0) !== value) { p.layers[id] = value; changed = true; }
        }
        if (tickEgirLayers(b, p, fighting)) changed = true;
        if (changed) this.syncBonds(p);
      }
      const dead = d.pair.filter(p => p.hp <= 0);
      this.resolveDuel(d, dead);
    }
    if (this.duels.every(d => d.done)) {
      const winners = this.duels.map(d => this.players.find(p => p.id === d.winner));
      if (winners.length === 1) { this.champion = winners[0].id; winners[0].placement = 1; this.status = 'complete'; }
      else this.beginStage(winners);
    }
  }
  tiebreak(d) {
    const [a, b] = d.pair;
    if (a.hp !== b.hp) return a.hp > b.hp ? a : b;
    if (a.killValue !== b.killValue) return a.killValue > b.killValue ? a : b;
    return this.random() < 0.5 ? a : b;
  }
  receivesIncome(p) { return !p.eliminated; }
  launchColumns(p) { return [ownCol(p, 8), ownCol(p, 9)]; }
  incomeBetween(_p, from, to) {
    return Math.floor((to + 1e-9) / VERSUS_INCOME_INTERVAL) - Math.floor((from + 1e-9) / VERSUS_INCOME_INTERVAL);
  }
  resolveDuel(d, dead) {
    if (dead.length) this.finishDuel(d, dead.length === 1 ? d.pair.find(p => p !== dead[0]) : this.tiebreak(d), '蓝门失守');
    else if (d.elapsed >= this.duelSeconds) this.finishDuel(d, this.tiebreak(d), '时间耗尽');
  }
  botAction(p, _d) {
    if (p.offers.length && p.operators.length < 16) { this.action(p, { action: 'reward', index: 0 }); return; }
    if (this.time < (p.botNext || 0)) return;
    p.botNext = this.time + 1.2 + this.random();
    try {
      const placed = p.operators.filter(o => o.row != null).length;
      const bench = p.operators.find(o => o.row == null);
      if (bench && placed < 6) {
        const b = this.battleOf(p);
        for (const r of [4, 5, 3, 2]) for (const c of [6, 5, 7, 4, 8]) {
          const fc = ownCol(p, c);
          if (!b.isReservedTile(r, fc) && versusCanStand(b.grid, this.stage, r, fc, data.chess[bench.id])) {
            this.action(p, { action: 'deploy', uid: bench.uid, row: r, col: fc }); return;
          }
        }
      }
      const monster = Object.keys(p.monsters)[0];
      if (this.status === 'combat' && monster) {
        this.action(p, { action: 'launch', id: monster, row: this.pick([3, 4, 5]), col: ownCol(p, 9) }); return;
      }
      const upgrade = versusUpgradeState(p, this.time);
      if (!upgrade.reason && p.coins >= upgrade.price + 6 && placed >= 3) { this.action(p, { action: 'upgrade' }); return; }
      const kind = placed < 3 || (placed < 6 && this.random() < 0.25) ? 'operator' : 'monster';
      const index = p.shop[kind].findIndex(id => id && byId.get(id).price <= p.coins);
      if (index >= 0) this.action(p, { action: 'buy', kind, index });
      else if (p.coins >= 2) this.refresh(p);
    } catch { /* A bot retries after cooldown when its selected tile or launch capacity is unavailable. */ }
  }
  publicView() {
    return { code: this.code, host: this.host, status: this.status, round: this.round,
      gameMode: 'versus', mapVersion: this.mapVersion, stageId: this.stage.id,
      disabledBonds: [...this.bans.drawn, ...this.bans.staticOff], drawnDisabledBonds: this.bans.drawn, staticInactiveBonds: this.bans.staticOff, bannedChess: this.bans.banned,
      time: Math.round(this.time), countdown: Math.max(0, Math.ceil((this.deadline || 0) - this.time)), champion: this.champion,
      players: this.players.map(p => ({ id: p.id, name: p.name, bot: p.bot, eliminated: p.eliminated, hp: p.hp,
        infoReady: p.infoReady, initial: [...p.name][0] || '博', color: this.duels.find(d => d.id === p.duel)?.color,
        duel: p.duel, side: p.side, kills: p.kills, connected: p.connected, placement: p.placement })),
      duels: this.duels.map(d => ({ id: d.id, color: d.color, players: d.pair.map(p => p.id), done: d.done, winner: d.winner,
        elapsed: Math.round(d.elapsed), power: powerAt(d.elapsed), remaining: Math.max(0, Math.ceil(this.duelSeconds - d.elapsed)) })), history: this.history,
      results: this.status === 'complete' ? this.players.map(p => this.resultOf(p)).sort((a,b) => a.placement - b.placement) : null };
  }
  resultOf(p) {
    return { id: p.id, name: p.name, bot: p.bot, placement: p.placement, hp: p.hp, coins: p.coins,
      stats: { ...p.stats }, lineup: p.operators.filter(o => o.row != null).map(o => ({ id: o.id, items: [...o.items] })),
      bonds: structuredClone(p.bonds) };
  }
  privateView(p) {
    return { id: p.id, coins: p.coins, level: p.level, upgrade: versusUpgradeState(p, this.time), operators: p.operators, monsters: p.monsters, items: p.items,
      shop: p.shop, rewardOffer: p.offers[0] ? { ...p.offers[0], queued: p.offers.length } : null, loadout: p.loadout, strategy: p.strategy, bonds: p.bonds, freeRefresh: p.freeRefresh, side: p.side,
      launchColumns: this.launchColumns(p), incomeInterval: versusIncomeInterval(p.duelTime), launchCooldown: Math.max(0, p.launchNext - p.duelTime) };
  }
  fieldViews(id) {
    const d = this.duels.find(d => d.id === id); if (!d) return null;
    const feeds = d.battles.map(b => ({ snapshot: b.snapshot(), events: b.drainEvents() }));
    const fullId = `${d.id}:${d.leg || 0}:overview`;
    const fullAllowed = d.battles.map((b, i) => new Set(b.units.filter(u => u.kind !== 'device'
      || (i === 0 ? u.x <= 10 : u.x > 10)).map(u => u.id)));
    const fullUnits = d.battles.flatMap((b, i) => b.units.filter(u => fullAllowed[i].has(u.id) && ((u.alive && u.deployed && !u.hidden) || b.isDown(u)))
      .map(u => ({ ...liveUnitInfo(u), id: u.id + i * 1000000, sourcePlayerId: u.sourcePlayerId })));
    const overview = {
      meta: { fieldId: fullId, kind: 'boss', rect: RECT, stageId: this.stage.id, units: fullUnits },
      snapshot: { ...feeds[0].snapshot, fieldId: fullId,
        units: feeds.flatMap((f, i) => f.snapshot.units.filter(t => fullAllowed[i].has(t[0])).map(t => [t[0] + i * 1000000, ...t.slice(1)])),
        down: feeds.flatMap((f, i) => (f.snapshot.down || []).map(t => [t[0] + i * 1000000, ...t.slice(1)])) },
      events: feeds.flatMap((f, i) => f.events.filter(e => e[0] !== 'spawn' || fullAllowed[i].has(e[1].id)).map(raw => {
        const e = offsetEvent(raw, i * 1000000);
        if (e[0] === 'spawn') e[1].sourcePlayerId = d.battles[i].units.find(u => u.id === raw[1].id)?.sourcePlayerId;
        return e;
      })),
    };
    // Share outgoing monsters, not the other player's operators. Each simulation still runs exactly once.
    return Object.fromEntries(d.pair.map((p, j) => {
      const b = d.battles[j], other = d.battles[1 - j], offset = j * 1000000, otherOffset = (1 - j) * 1000000;
      const fieldId = `${d.id}:${d.leg || 0}:${p.id}`, feed = feeds[j], otherFeed = feeds[1 - j];
      const outgoing = other.units.filter(u => u.sourcePlayerId === p.id && u.versusPurchased);
      const outgoingIds = new Set(outgoing.map(u => u.id));
      const aliveOutgoing = outgoing.filter(u => u.alive && u.deployed && !u.hidden);
      const units = b.units.filter(u => (u.alive && u.deployed && !u.hidden) || b.isDown(u)).map(u => ({ ...liveUnitInfo(u), id: u.id + offset, sourcePlayerId: u.sourcePlayerId }));
      units.push(...aliveOutgoing.map(u => ({ ...liveUnitInfo(u), id: u.id + otherOffset, outgoing: true, sourcePlayerId: u.sourcePlayerId })));
      const tuples = [...feed.snapshot.units.map(t => [t[0] + offset, ...t.slice(1)]),
        ...otherFeed.snapshot.units.filter(t => outgoingIds.has(t[0])).map(t => [t[0] + otherOffset, ...t.slice(1)])];
      const outgoingEvents = otherFeed.events.filter(e => e[0] === 'spawn' ? outgoingIds.has(e[1].id)
        : ['deploy', 'dmg', 'heal', 'skill', 'cast', 'die', 'leak', 'status', 'atk'].includes(e[0]) && outgoingIds.has(e[1]));
      const routes = aliveOutgoing.filter(u => u.versusGoal).map(u => ({ id: u.id + otherOffset,
        cells: other.grid.findPath(Math.round(u.y), Math.round(u.x), ...u.versusGoal) || [] }));
      const events = [...feed.events.map(e => offsetEvent(e, offset)), ...outgoingEvents.map(e => offsetEvent(e, otherOffset))];
      for (const e of events) if (e[0] === 'spawn') {
        const info = units.find(u => u.id === e[1].id);
        if (info) Object.assign(e[1], { sourcePlayerId: info.sourcePlayerId, outgoing: info.outgoing });
      }
      return [p.id, { duelId: d.id, playerId: p.id, side: p.side, bonds: structuredClone(p.bonds),
        meta: { fieldId, kind: 'boss', rect: RECT, stageId: this.stage.id, units },
        snapshot: { ...feed.snapshot, fieldId, units: tuples, down: (feed.snapshot.down || []).map(t => [t[0] + offset, ...t.slice(1)]) },
        routes, events, overview }];
    }));
  }
}
