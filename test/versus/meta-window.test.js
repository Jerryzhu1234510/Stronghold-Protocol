import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssaultRoom } from '../../server/versus/assault.js';
import { data, MONSTERS, OPERATORS } from '../../server/versus/catalog.js';
import { resetMetaWindow, recordMeta, runNativeMeta, settleMetaWindows } from '../../server/versus/metaWindow.js';
import { metaTrait, traitNotes, triggerMeta } from '../../server/versus/traits.js';

const garrison = (key, event, method) => Object.values(data.garrisons).find(g => g.effectKey === key
  && (!event || g.eventType === event) && (!method || g.bbStr?.add_method === method));
function fixture() {
  const room = new AssaultRoom('META', { seed: 91, infoSeconds: 0, prepSeconds: 0 });
  const host = room.join('博士'); room.start(host.id, true); room.players.forEach(p => p.bot = false);
  const p = room.players.find(p => p.role === 'defend'); room.syncBonds = () => {};
  for (const id of Object.keys(data.bonds)) p.bonds[id] = { active: true, count: 3, layers: 0 };
  const o = { uid: room.nextUid++, id: OPERATORS[0].id, row: 4, col: 5, dir: 'RIGHT', items: [] };
  p.operators = [o]; return { room, p, o };
}
test('worm pack keeps price3 with the latest two-unit early bundle, dogs cost2', () => {
  const worm = MONSTERS.find(c => c.id === 'enemy_1007_slime'); assert.equal(worm.price, 3); assert.equal(worm.quantity, 2);
  assert.equal(MONSTERS.find(c => c.id === 'enemy_1000_gopro_2').price, 2);
});
test('native spending, acquisition and refresh methods read exact window stats and original caps', () => {
  const { p, o } = fixture(); recordMeta(p, 'gainedChess', 5); recordMeta(p, 'spent', 8); recordMeta(p, 'refreshes', 10);
  const gain = garrison('SERVER_ADD_BOND_METHOD', 'SERVER_PREP_FIN', 'round_gain_char');
  runNativeMeta(p, o, gain); assert.equal(p.layers[gain.bbStr.bond], 5 * gain.bb.multi);
  const spent = garrison('SERVER_ADD_BOND_ROUND_COIN_COST'); runNativeMeta(p, o, spent);
  for (const id of spent.bbStr.bond.split(',')) assert.equal(p.layers[id], 2 * spent.bb.layer);
  const refresh = garrison('SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER'), previous = { ...p.layers }; runNativeMeta(p, o, refresh);
  for (const id of refresh.bbStr.bond.split(',')) assert.equal(p.layers[id], (previous[id] || 0) + refresh.bb.max_layer);
  const before = { ...p.layers }; metaTrait(p, o, gain, 'kill'); metaTrait(p, o, spent, 'kill');
  assert.deepEqual(p.layers, before);
});
test('settles at30 not29.999, exactly once per boundary, only defender and reset at role exchange', () => {
  const { room, p } = fixture(), g = garrison('SERVER_ADD_BOND_METHOD', 'SERVER_PREP_FIN', 'round_gain_char');
  const id = Object.entries(data.chess).find(([, c]) => c.garrisonIds?.some(gid => data.garrisons[gid] === g))[0];
  p.operators = [{ uid: room.nextUid++, id, row: 4, col: 5, items: [] }]; recordMeta(p, 'gainedChess', 3);
  settleMetaWindows(p, 29.999); assert.equal(p.layers[g.bbStr.bond], undefined);
  settleMetaWindows(p, 30); assert.equal(p.layers[g.bbStr.bond], 3 * g.bb.multi);
  assert.equal(p.metaWindow.stats.gainedChess, 0); assert.equal(p.metaWindow.index, 2);
  settleMetaWindows(p, 30); assert.equal(p.layers[g.bbStr.bond], 3 * g.bb.multi);
  recordMeta(p, 'gainedChess', 2); settleMetaWindows(p, 60); assert.equal(p.layers[g.bbStr.bond], 5 * g.bb.multi);
  const attack = room.players.find(p => p.role === 'attack'); settleMetaWindows(attack, 90); assert.equal(attack.metaWindow.index, 1);
  room.beginLeg(room.duels.find(d => d.id === p.duel)); assert.equal(p.metaWindow.index, 1); assert.equal(p.metaWindow.stats.gainedChess, 0);
});
test('manual refresh counts per copy and resets in each window, free refresh also counts but spends0', () => {
  const { room, p, o } = fixture(), g = garrison('SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT');
  const bond = g.bbStr.bond;
  runNativeMeta(p, o, g); runNativeMeta(p, o, g); assert.equal(p.layers[bond], g.bb.layer);
  runNativeMeta(p, { ...o, uid: 900 }, g); assert.equal(p.layers[bond], 2 * g.bb.layer);
  settleMetaWindows(p, 30); runNativeMeta(p, o, g); assert.equal(p.layers[bond], 3 * g.bb.layer);
  const before = p.metaWindow.stats.spent; p.freeRefresh = 1; room.refresh(p);
  assert.equal(p.metaWindow.stats.refreshes, 1); assert.equal(p.metaWindow.stats.spent, before);
  room.refresh(p); assert.equal(p.metaWindow.stats.refreshes, 2); assert.equal(p.metaWindow.stats.spent, before + 1);
});
test('original positional, same-row, hand-count and different-tier conditions are preserved', () => {
  const { p, o } = fixture(); p.operators.push({ ...o, uid: 900, row: null, col: null });
  const hand = garrison('SERVER_ADD_BOND_METHOD', 'SERVER_PREP_FIN', 'hand_count');
  runNativeMeta(p, o, hand); assert.equal(p.layers[hand.bbStr.bond], hand.bb.multi);
  const onBoard = garrison('SERVER_ADD_BOND_IN_HAND');
  runNativeMeta(p, { ...o, row: null }, onBoard); assert.equal(p.layers[data.chess[o.id].bonds[0]], undefined);
  runNativeMeta(p, o, onBoard); assert.equal(p.layers[data.chess[o.id].bonds[0]], onBoard.bb.count);
  const row = garrison('SERVER_POOL_CHAR', 'SERVER_PREP_START'); const before = p.operators.length;
  runNativeMeta(p, o, row); assert.equal(p.operators.length, before);
});
test('original random pools, golden weights, odd windows and item inventory limits', () => {
  const { p, o } = fixture(), random = garrison('SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL');
  runNativeMeta(p, o, random); assert.equal(p.items.length, random.bb.count);
  p.metaWindow.index = 2; runNativeMeta(p, o, random); assert.equal(p.items.length, random.bb.count);
  const pool = garrison('SERVER_POOL_EQUIP', 'SERVER_GAIN'); runNativeMeta(p, o, pool);
  assert.ok(p.items.every(it => data.items[it.id]));
  p.items = Array.from({ length: 12 }, (_, uid) => ({ uid })); runNativeMeta(p, o, pool); assert.equal(p.items.length, 12);
});
test('gain/sold gold becomes finite pending kill rewards, not unlimited per-kill operator farming', () => {
  const { room, p, o } = fixture(), gain = garrison('SERVER_ONCE_GOLD', 'SERVER_GAIN');
  metaTrait(p, o, gain, 'gain'); assert.equal(p.pendingKillGold, gain.bb.count);
  p.operators = []; p.coins = 0;
  const b = room.battleOf(p), kill = () => b.emit('kill', { victim: { side: 'enemy', mem: {}, versusPurchased: true, versusPrice: 1 } });
  kill(); assert.equal(p.coins, 2); assert.equal(p.pendingKillGold, Math.max(0, gain.bb.count - 1));
  kill(); assert.equal(p.coins, 3); p.duelTime = 4; kill();
  assert.equal(p.coins, gain.bb.count === 1 ? 4 : 5); assert.equal(p.pendingKillGold, 0);
  resetMetaWindow(p); assert.equal(p.pendingKillGold, 0);
});
test('copy and re-trigger reuse original handlers with bounded recursion', () => {
  const { p, o } = fixture();
  const copy = garrison('SERVER_FRONT_SAME_EFFECT_PREP_FIN');
  const id = Object.entries(data.chess).find(([, c]) => c.garrisonIds?.some(gid => data.garrisons[gid] === copy))[0];
  p.operators = [{ ...o, id }, { ...o, uid: 901, id, col: 6 }];
  runNativeMeta(p, p.operators[0], copy); assert.equal(p.metaWindow.depth, 0);
  const trigger = garrison('SERVER_TRIGGER_ANOTHER', 'SERVER_PREP_START');
  runNativeMeta(p, p.operators[0], trigger); assert.equal(p.metaWindow.depth, 0);
});
test('window descriptions match behavior and all native meta effect keys are covered', () => {
  for (const c of OPERATORS) {
    const traits = traitNotes(c.id); assert.ok(traits.every(t => t.ready), c.id);
    for (const gid of data.chess[c.id].garrisonIds || []) {
      const g = data.garrisons[gid];
      if (g?.effectKey === 'SERVER_ADD_BOND_METHOD' && /PREP/.test(g.eventType)) assert.ok(traits.some(t => t.desc.includes('30秒')));
    }
  }
});
test('actual buys and upgrades record funds and gained chess without counting income', () => {
  const { room, p } = fixture();
  const c = OPERATORS.find(c => !room.bannedChess.has(c.id) && data.chess[c.id].garrisonIds.every(id => data.garrisons[id]?.eventType === 'IN_BATTLE'));
  p.shop.operator[0] = c.id; room.action(p, { action: 'buy', kind: 'operator', index: 0 });
  assert.equal(p.metaWindow.stats.gainedChess, 1); assert.equal(p.metaWindow.stats.spent, c.price);
  assert.equal(p.metaWindow.stats.buys, 1); room.action(p, { action: 'upgrade' });
  assert.equal(p.metaWindow.stats.spent, c.price + 10);
  triggerMeta(p, p.operators[0], 'SERVER_REFRESH_SHOP', 'refresh');
});
test('two-copy traits use the original merge count and still issue the native promotion reward', () => {
  const { room, p } = fixture(); p.operators = []; p.bonds = {};
  const c = OPERATORS.find(c => !room.bannedChess.has(c.id) && room.gd.mergeCount(c.id) === 2);
  assert.ok(c); room.acquireOperator(p, c.id); const elite = room.acquireOperator(p, c.id);
  assert.equal(elite.id, data.chess[c.id].goldenId); assert.equal(p.operators.length, 1);
  assert.equal(p.stats.merges, 1); assert.ok(p.offers[0].slots.length > 0);
});
test('trait-gift coin is consumed using the native handler even with full equipment slots', () => {
  const { room, p, o } = fixture(); o.items = ['chess_item_1_01_a', 'chess_item_1_02_a'];
  const coin = { uid: room.nextUid++, id: 'chess_item_1_03_e_a' }; p.items.push(coin); p.coins = 99;
  room.action(p, { action: 'equip', uid: o.uid, itemUid: coin.uid });
  assert.equal(p.coins, 100); assert.equal(o.items.length, 2); assert.equal(p.items.length, 0);
});
test('randomly banned bonds never activate even when their members are deployed', () => {
  const room = new AssaultRoom('BANS', { seed: 91, infoSeconds: 0, prepSeconds: 0 });
  const host = room.join('博士'); room.start(host.id, true);
  const p = room.players.find(p => p.role === 'defend');
  p.operators = OPERATORS.map((c, i) => ({ uid: i + 500, id: c.id, row: 4, col: 3 + i, items: [] }));
  room.syncBonds(p);
  for (const id of room.bans.drawn) assert.equal(p.bonds[id]?.active, undefined, id);
});
