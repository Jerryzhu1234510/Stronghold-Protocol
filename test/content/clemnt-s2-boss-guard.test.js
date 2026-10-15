import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { makeBattle, flatStage, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const D = getData({ log: { warn() {}, error() {}, info() {} } });
const stage = flatStage({ rows: Object.fromEntries(Array.from({ length: 19 }, (_, r) => [r, 'r'.repeat(21)])) });
const cast = u => { u.skill.charges = 1; assert.ok(u.skill.activate('test')); };
const finish = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };

for (const elite of [false, true]) test(`Clementia and Angelina: a weightless Lucian remains outside the S2 capsule (${elite ? 'elite' : 'normal'})`, () => {
  const h = makeBattle({ stage, autoFinish: false, timeLimit: 60,
    units: [
      { uid: 1, chessId: `chess_char_4_27_${elite ? 'b' : 'a'}`, row: 10, col: 5, dir: 'RIGHT' },
      { uid: 2, chessId: 'chess_char_5_20_a', row: 11, col: 4 },
    ],
  });
  h.step();
  const u = h.unit(1), angelina = h.unit(2);
  assert.equal(u.skill.id, 'skchr_clemnt_2');
  assert.equal(angelina.skill.id, 'skchr_aglina_3');
  const boss = h.spawn('enemy_2016_csphtm', { tag: 'boss', pos: [10, 6], mods: { speedMul: 0 } });
  h.b.addBuff(boss, { key: 'test:stationary', flags: { noMove: true, disarm: true, invulnerable: true } });
  assert.equal(boss.s.massLevel, 9, 'existing +3 boss weight is present');
  cast(angelina);
  assert.ok(boss.findBuff('aglina:weightless'), 'the real S3 applies its weight debuff');
  assert.equal(boss.s.massLevel, 8, 'within the capsule weight budget despite the previous fix');
  cast(u);
  h.run(.3);
  assert.ok(u.mem.clemnt.capsule.seen.has(boss), 'the capsule actually collides with Lucian');
  assert.ok(!u.mem.clemnt.capsule.passengers.has(boss));
  assert.equal(boss.hidden, false);
  assert.ok(!boss.s.flags.isolated);
  assert.deepEqual([boss.x, boss.y], [6, 10]);
  h.run(2);
  assert.equal(u.mem.clemnt.capsule, null);
  assert.deepEqual([boss.x, boss.y], [6, 10]);
  finish(h);
});

for (const boss of Object.values(D.bosses)) for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
  test(`Clementia S2 respects ${boss.bossId} immunity even at weight zero (${dir})`, () => {
    const h = makeBattle({ stage, autoFinish: false, timeLimit: 60,
      units: [{ uid: 1, diy: { slot: 6, charId: 'char_4231_clemnt', skillIndex: 1 }, elite: true, row: 10, col: 5, dir }],
    });
    h.step();
    const u = h.unit(1), [dr, dc] = u.fwd;
    const e = h.spawn(boss.enemyKey, { tag: 'boss', pos: [u.y + dr, u.x + dc], mods: { speedMul: 0 } });
    h.b.addBuff(e, { key: 'test:weightless', mods: { massFlat: -100 },
      flags: { noMove: true, disarm: true, invulnerable: true } });
    assert.equal(e.s.massLevel, 0);
    const start = [e.x, e.y];
    cast(u);
    let collided = false;
    for (let i = 0; i < 60; i++) {
      h.step();
      const w = u.mem.clemnt.capsule;
      collided ||= !!w?.seen.has(e);
      assert.ok(!w?.passengers.has(e));
      assert.equal(e.hidden, false);
      assert.ok(!e.s.flags.isolated);
      assert.deepEqual([e.x, e.y], start);
    }
    assert.ok(collided);
    assert.equal(u.mem.clemnt.capsule, null);
    finish(h);
  });
}

for (const boss of Object.values(D.bosses)) for (const elite of [false, true]) {
  test(`S2 attacks and vortex still damage ${boss.bossId} without moving it (${elite ? 'elite' : 'normal'})`, () => {
    const h = makeBattle({ stage, autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [{ uid: 1, chessId: `chess_char_4_27_${elite ? 'b' : 'a'}`, row: 10, col: 5, dir: 'RIGHT' }],
    });
    h.step();
    const u = h.unit(1), e = h.spawn(boss.enemyKey, { tag: 'boss', pos: [10, 7], mods: { speedMul: 0, atkMul: 0 } });
    // Leave HP vulnerable: this checks real damage, not just a visual attack event.
    h.b.addBuff(e, { key: 'test:stationary', mods: { massFlat: -100 }, flags: { noMove: true, disarm: true } });
    const hp = e.hp;
    cast(u); h.run(4);
    const hits = h.hooksOf('damaged').filter(c => c.source === u && c.target === e && c.amount > 0);
    assert.ok(hits.some(c => c.type === 'phys' && c.dmg.tags.includes('clemnt:s2')), 'S2 enhanced attacks deal damage');
    assert.ok(hits.some(c => c.type === 'phys' && c.dmg.tags.includes('clemnt:vortex')), 'S2 vortex deals damage in its radius');
    assert.ok(e.hp < hp, 'real boss HP decreases');
    assert.deepEqual([e.x, e.y], [7, 10]);
    assert.ok(!e.hidden && !e.s.flags.isolated);
    finish(h);
  });
}

test('a boss consumes no passenger budget; normal enemies still ride and take S2 damage', () => {
  const h = makeBattle({ stage, autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0, mass: 1 }) } },
    units: [{ uid: 1, chessId: 'chess_char_4_27_a', row: 10, col: 5, dir: 'RIGHT' }],
  });
  h.step();
  const u = h.unit(1), boss = h.spawn('dummy', { tag: 'boss', pos: [10, 6] });
  const normal = h.spawn('dummy', { pos: [10, 6] });
  h.b.addBuff(boss, { key: 'test:weightless', mods: { massFlat: -100 } });
  cast(u); h.run(.3);
  assert.ok(!boss.hidden && normal.hidden);
  assert.equal(u.mem.clemnt.capsule.count, 1);
  assert.equal(u.mem.clemnt.capsule.mass, 1);
  h.run(2.2);
  assert.deepEqual([boss.x, boss.y], [6, 10]);
  assert.ok(Math.abs(normal.x - 8) < 1e-9);
  assert.equal(normal.y, 10);
  assert.ok(!normal.hidden && !normal.s.flags.isolated);
  assert.ok(h.hooksOf('damaged').some(c => c.target === boss && c.dmg.tags.includes('clemnt:s2')),
    'immunity protects only capsule transport, not S2 attacks');
  finish(h);
});
