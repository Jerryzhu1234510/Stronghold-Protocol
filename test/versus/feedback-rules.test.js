import test from 'node:test';
import assert from 'node:assert/strict';
import { AssaultRoom } from '../../server/versus/assault.js';
import { ownCol, powerAt } from '../../server/versus/engine.js';
import { MONSTERS, OPERATORS, DERIVED_MONSTERS, data } from '../../server/versus/catalog.js';
import { versusCanStand } from '../../shared/versusPlacement.js';
import { versusIncomeBetween, versusIncomeInterval, versusShopSlots } from '../../shared/versusEconomy.js';

function setup(options = {}) {
  const room = new AssaultRoom('TEST', { seed: 81, prepSeconds: 0, infoSeconds: 0, ...options });
  for (let i = 0; i < 4; i++) room.join(`Player ${i}`);
  room.start(room.host); room.tick();
  return room;
}
const roles = d => ({ attack: d.pair.find(p => p.role === 'attack'), defend: d.pair.find(p => p.role === 'defend') });
function deploy(room, p) {
  const card = OPERATORS.find(c => !room.bannedChess.has(c.id) && c.position === 'MELEE');
  const o = room.acquireOperator(p, card.id), b = room.battleOf(p);
  for (let row = 2; row <= 5; row++) for (let col = 3; col <= 9; col++) {
    const c = ownCol(p, col);
    if (!b.isReservedTile(row, c) && versusCanStand(b.grid, room.stage, row, c, data.chess[o.id])) {
      room.action(p, { action: 'deploy', uid: o.uid, row, col: c });
      return b.allyUnits.find(u => u.uid === o.uid && !u.removed);
    }
  }
  throw new Error('no deployment tile');
}

test('income changes at four real minutes, splits boundaries and resets separately for each leg', () => {
  assert.equal(versusIncomeInterval(239.999), 2); assert.equal(versusIncomeInterval(240), 1);
  assert.equal(versusIncomeBetween(0, 240), 120); assert.equal(versusIncomeBetween(240, 480), 240);
  assert.equal(versusIncomeBetween(239.5, 241), 2);
  const room = setup(), d = room.duels[0], other = room.duels[1];
  d.elapsed = 239; other.elapsed = 5;
  for (const p of room.players) p.coins = 0;
  room.tick(1); assert.ok(d.pair.every(p => p.coins === 1));
  room.tick(1); assert.ok(d.pair.every(p => p.coins === 2));
  assert.ok(other.pair.every(p => p.coins === 1));
  room.beginLeg(d); d.pair.forEach(p => p.coins = 0);
  room.tick(1); assert.ok(d.pair.every(p => p.coins === 0));
  room.tick(1); assert.ok(d.pair.every(p => p.coins === 1));
});

test('combat advances two simulation seconds per real second while the eight-minute timer and meta clock remain real', () => {
  const room = setup(), d = room.duels[0], p = roles(d).defend, b = room.battleOf(p);
  const elapsed = d.elapsed, sim = b.time;
  room.tick(1);
  assert.ok(Math.abs(d.elapsed - elapsed - 1) < 1e-6);
  assert.ok(Math.abs(b.time - sim - 2) < 1e-6);
  assert.equal(p.duelTime, d.elapsed); assert.equal(p.metaWindow.next, 30);
  assert.equal(room.duelSeconds, 480); assert.equal(d.leg, 1);
  assert.ok(Math.abs(room.fieldViews(d.id)[p.id].snapshot.t - b.time) < .001);
});

test('each confirmed operator knockout or gate leak pays attacker five once, never movement or withdrawal', () => {
  const room = setup(), d = room.duels[0], { attack, defend } = roles(d), b = room.battleOf(defend);
  const u = deploy(room, defend), enemy = b.spawnEnemy(MONSTERS[0].id, { sourcePlayerId: attack.id });
  attack.coins = 0;
  b.kill(u, enemy); assert.equal(attack.coins, 5);
  b.emit('death', { unit: u, reason: 'killed', killer: enemy }); assert.equal(attack.coins, 5);
  b.emit('death', { unit: { kind: 'token', ownerId: defend.id }, reason: 'killed', killer: enemy }); assert.equal(attack.coins, 5);
  b.emit('death', { unit: u, reason: 'sold' }); assert.equal(attack.coins, 5);
  enemy.lpr = 3; b.emit('enemyLeak', { enemy });
  assert.equal(defend.hp, 17); assert.equal(attack.coins, 10);
  b.emit('enemyLeak', { enemy }); assert.equal(attack.coins, 10); assert.equal(defend.hp, 17);
  const another = deploy(room, defend); b.kill(another, null); assert.equal(attack.coins, 15, 'native explosion damage can have no killer unit');
  attack.coins = 99; const last = b.spawnEnemy(MONSTERS[0].id, { sourcePlayerId: attack.id });
  b.emit('enemyLeak', { enemy: last }); assert.equal(attack.coins, 100);
});

test('every level expands both role shops, sold slots remain, max ten units plus one equipment', () => {
  const room = setup(), { attack, defend } = roles(room.duels[0]);
  for (const p of [attack, defend]) {
    const kind = p.role === 'attack' ? 'monster' : 'operator';
    let previous = 0;
    for (let level = 1; level <= 6; level++) {
      p.level = level; room.refresh(p, false);
      assert.ok(p.shop[kind].length > previous); previous = p.shop[kind].length;
      assert.equal(previous, versusShopSlots(level).chess);
      assert.equal(p.shop.equipment.length, p.role === 'attack' ? 0 : 1);
      assert.ok(previous + p.shop.equipment.length <= 11);
    }
  }
});

test('advancing resets all role banks, inventory, bonds, shop levels and money', () => {
  const room = setup();
  for (const d of room.duels) {
    const p = d.pair[0]; Object.assign(p, { coins: 99, level: 6, operators: [{ uid: 99, id: OPERATORS[0].id, row: null, items: [] }],
      items: [{ uid: 100, id: 'any' }], monsters: { [MONSTERS[0].id]: 5 }, layers: { yanShip: 199 }, offers: [{}],
      roleBanks: { defend: { coins: 100, level: 6, operators: [], bonds: {} } } });
    room.finishDuel(d, p, 'test');
  }
  room.tick(); assert.equal(room.round, 2);
  for (const p of room.duels[0].pair) {
    assert.equal(p.coins, 20); assert.equal(p.level, 1); assert.deepEqual(p.operators, []);
    assert.deepEqual(p.items, []); assert.deepEqual(p.monsters, {}); assert.deepEqual(p.layers, {});
    assert.deepEqual(p.offers, []); assert.deepEqual(p.roleBanks, {});
  }
});

test('both roles share the defender view and launching is restricted to its front two columns', () => {
  const room = setup(), d = room.duels[0];
  for (let leg = 1; leg <= 2; leg++) {
    const { attack, defend } = roles(d), feeds = room.fieldViews(d.id);
    assert.equal(feeds[attack.id].side, defend.side);
    assert.deepEqual(feeds[attack.id].meta, feeds[defend.id].meta);
    assert.deepEqual(feeds[attack.id].snapshot, feeds[defend.id].snapshot);
    assert.deepEqual(room.launchColumns(attack), [ownCol(defend, 8), ownCol(defend, 9)]);
    attack.monsters[MONSTERS[0].id] = 2;
    assert.throws(() => room.action(attack, { action: 'launch', id: MONSTERS[0].id, row: 4, col: ownCol(attack, 9) }), /前沿/);
    if (leg === 1) room.beginLeg(d);
  }
});

test('monster health and attack growth cap at two, batches match tier, and children are not sold', () => {
  assert.deepEqual(powerAt(0), { hp: .7, atk: .7, level: -1 });
  assert.deepEqual(powerAt(480), { hp: 2, atk: 2, level: 6 });
  assert.equal(powerAt(3600).hp, 2); assert.equal(powerAt(3600).atk, 2);
  assert.ok(MONSTERS.every(c => c.quantity === (c.tier <= 3 ? 2 : 1)));
  assert.ok(MONSTERS.every(c => !DERIVED_MONSTERS.has(c.id)));
  assert.equal(MONSTERS.find(c => c.id === 'enemy_1000_gopro_2').price, 2);
  assert.equal(MONSTERS.find(c => c.id === 'enemy_1007_slime').price, 3);
  const room = setup(), p = roles(room.duels[0]).defend, b = room.battleOf(p);
  const child = b.spawnEnemy('enemy_1200_msfjin'); const hp = child.hp;
  b.dealDamage(null, child, { amount: 100000, type: 'true' }); assert.equal(child.hp, hp - 1);
});
