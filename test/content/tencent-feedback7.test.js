import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const bond = (count = 3, tier = 1, layers = 0) => ({ count, tier, layers, active: true });
const skill = { spCost: 100, initSp: 15, trigger: { rule: 'NEVER' } };
const front = (garrisonIds = []) => ({ ...chessRec({ id: 'front', bonds: ['yanShip'], skill }), garrisonIds });
const grants = (g, dir, row, col, id) => ({ ...chessRec({ id, skill: null }), garrisonIds: [g], dir, row, col });

for (const [form, expected] of [['a', 14], ['b', 28]]) test(`two same-form Warfarins (${form}) grant independent traits and independent layer caps`, () => {
  const a = grants(`garrison_72_${form}`, 'RIGHT', 10, 4, 'w1');
  const b = grants(`garrison_72_${form}`, 'DOWN', 11, 5, 'w2');
  const h = makeBattle({ autoFinish: false, defs: { chess: { w1: a, w2: b, front: front() } },
    bonds: { yanShip: bond() }, units: [
      { chessId: 'w1', row: 10, col: 4, dir: 'RIGHT' }, { chessId: 'w2', row: 11, col: 5, dir: 'DOWN' },
      { chessId: 'front', row: 10, col: 5 },
    ] });
  h.step();
  for (let i = 0; i < 8; i++) h.b.emit('skillStart', { unit: h.unit('front'), skill: h.unit('front').skill });
  assert.equal(h.result().perPlayer.p1.layerGains.yanShip, expected);
  checkInvariants(h.b);
});

for (const form of ['a', 'b']) test(`Mlynar (${form}): two raid redeployments add initial SP to the carried total and respect skill capacity`, () => {
  const h = makeBattle({ autoFinish: false, units: [{ chessId: `chess_char_5_19_${form}`, row: 10, col: 5 }] });
  h.step();
  const u = h.unit(`chess_char_5_19_${form}`);
  u.skill.setSpTotal(20);
  for (let i = 0; i < 2; i++) {
    const old = u.skill.spTotal;
    h.b.retreat(u, { reason: 'raid' });
    assert.ok(h.b.redeploy(u, { keepSp: true, addInitSp: true }));
    assert.equal(u.skill.spTotal, Math.min(u.skill.spCost, old + u.skill.initSp));
  }
  assert.equal(u.skill.ready, true);
  checkInvariants(h.b);
});

test('Kroos and Civilight face the same casting operator: granted precision gains include Civilight bonus', () => {
  for (const [k, m, expected] of [['a', 'a', 2], ['b', 'a', 3], ['a', 'b', 3], ['b', 'b', 4]]) {
    const h = makeBattle({ autoFinish: false, bonds: { preciShip: bond() }, units: [
      { chessId: `chess_char_4_06_${k}`, row: 10, col: 4, dir: 'RIGHT' },
      { chessId: `chess_char_4_25_${m}`, row: 11, col: 5, dir: 'DOWN' },
      { chessId: 'chess_char_1_01_a', row: 10, col: 5 },
    ] });
    h.step();
    const u = h.unit('chess_char_1_01_a');
    h.b.emit('skillStart', { unit: u, skill: u.skill });
    assert.equal(h.result().perPlayer.p1.layerGains.preciShip, expected, `${k}/${m}`);
    checkInvariants(h.b);
  }
});

test('three-member Indom gives five SP to an immediately redeployed casualty as well as the other field operators', () => {
  const h = makeBattle({ autoFinish: false, defs: { chess: { front: front(), receiver: chessRec({ id: 'receiver', skill }) } },
    bonds: { indomShip: bond(3, 2, 300) }, units: [
      { chessId: 'front', row: 10, col: 4 }, { chessId: 'receiver', row: 12, col: 5 },
    ] });
  h.step();
  const u = h.unit('front'), r = h.unit('receiver'), before = r.skill.sp;
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, true);
  assert.equal(u.skill.sp, u.skill.initSp + 5);
  assert.ok(Math.abs(r.skill.sp - before - 5) < 1e-6);
  checkInvariants(h.b);
});

test('raid preserves accumulated SP and adds the skill initial SP on every jump', () => {
  const rec = chessRec({ id: 'raider', bonds: ['raidShip'], skill });
  const h = makeBattle({ autoFinish: false, defs: { chess: { raider: rec }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0 }) } },
    bonds: { raidShip: bond(3) }, units: [{ chessId: 'raider', row: 12, col: 3 }],
    enemies: [{ key: 'dummy', pos: [9, 9] }], hooks: ['deploy', 'death'] });
  h.step();
  const u = h.unit('raider');
  const seq = u.deploySeq;
  let before;
  h.b.on('death', ({ unit, reason }) => { if (unit === u && reason === 'raid') before = u.skill.sp; });
  assert.ok(h.runUntil(() => u.deploySeq !== seq, 12));
  assert.ok(Math.abs(u.skill.sp - before - u.skill.initSp) < 0.1);
  checkInvariants(h.b);
});

test('Lemuen finishes bombing a living locked enemy after it leaves her normal range', () => {
  const h = makeBattle({ autoFinish: false, defs: { enemies: { walker: enemyRec({ key: 'walker', hp: 1e9, speed: 3 }) } },
    units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3, carryState: { sp: 99 } }],
    enemies: [{ key: 'walker', route: { motion: 'WALK', start: [9, 5], end: [9, 10], checkpoints: [] } }] });
  const u = h.unit('chess_char_6_01_a');
  assert.ok(h.runUntil(() => u.mem.lemLocks?.length > 0, 5));
  assert.ok(h.runUntil(() => h.b.enemiesInKeys(u.rangeKeys, u, u.profile).length === 0, 5));
  assert.ok(h.runUntil(() => h.eventsOf('fx').some(e => e[1] === 'bombardShell'), 6), 'no indefinite lock wait');
  checkInvariants(h.b);
});
