import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { Grid } from '../../server/sim/grid.js';
import { GEO } from '../../shared/constants.js';
import { TRIO_UNITE_RECT } from '../../shared/uniteLayout.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const D = getData({ log: { warn() {}, error() {}, info() {} } }), ds = new DataSource(D);
const finish = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };
const dummy = enemyRec({ key: 'dummy', hp: 1e8, speed: 0 });
const slots = [
  { playerId: 'right', seat: 0, side: 'L', colOffset: 8, expected: [10, 10] },
  { playerId: 'left', seat: 1, side: 'L', colOffset: 0, expected: [10, 2] },
  { playerId: 'upper', seat: 2, side: 'L', colOffset: 8, rowOffset: -7, expected: [3, 10] },
];
const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

for (const stage of Object.values(D.stages).filter(s => s.active !== false)) for (const touch of [false, true]) {
  test(`Touch team medics stay on each of the three boards: ${stage.id}, ${touch ? 'Touch' : 'reserve'}`, () => {
    const original = JSON.stringify(stage);
    const grid = new Grid(ds.getStage(stage.id), GEO.NORMAL_RECT), tiles = [];
    for (let r = 9; r <= 12; r++) for (let c = 3; c <= 9; c++) if (grid.canStand(r, c)) tiles.push([r, c]);
    assert.ok(tiles.length >= 2);
    for (const order of orders) {
      const players = order.map(i => ({ ...slots[i], bandId: 'band_amedic', units: touch ? tiles.slice(0, 2).map(([row, col], n) =>
        ({ uid: i * 10 + n + 1, kind: 'chess', chessId: 'elite', row, col })) : [] }));
      const h = makeBattle({ kind: 'unite', stageId: stage.id, rect: TRIO_UNITE_RECT, players, autoFinish: false,
        defs: { chess: { elite: chessRec({ id: 'elite', golden: true, profession: 'TANK', skill: null, stats: { atk: 0, blockCnt: 0 } }) } },
      });
      h.step();
      const id = touch ? 'char_613_acmedc' : 'char_605_cmedic';
      for (const slot of slots) {
        const medic = h.allies().find(u => u.ownerId === slot.playerId && u.defId === id);
        assert.ok(medic, `${slot.playerId} gets its own medic`);
        assert.deepEqual([medic.tileR, medic.tileC], slot.expected);
        assert.equal(medic.dir, 'RIGHT');
        assert.ok(h.b.onOwnBoard(h.b.getPlayer(slot.playerId), medic.tileR, medic.tileC));
      }
      finish(h);
    }
    assert.equal(JSON.stringify(stage), original, 'stage shared with normal/boss battles is never mutated');
  });
}

for (const elite of [false, true]) for (const index of [0, 1, 2]) {
  test(`Lemuen auto-casts S${index + 1} at a wanted target outside her normal range (${elite ? 'elite' : 'normal'})`, () => {
    const id = `chess_char_6_01_${elite ? 'b' : 'a'}`, rec = D.chess[id];
    const h = makeBattle({ autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      defs: { enemies: { dummy }, chess: { [id]: { ...rec, skill: rec.skills[index] } } },
      units: [{ uid: 1, chessId: id, row: 10, col: 3 }],
    });
    h.step(); const u = h.unit(1), e = h.spawn('dummy', { pos: [10, 9] });
    assert.ok(!u.baseRangeKeys.includes(10 * 21 + 9));
    u.skill.charges = 1;
    h.run(.5); assert.equal(u.skill.activations, 0, 'unmarked out-of-range enemies do not trigger a cast');
    h.b.addBuff(e, { key: 'lemuen:wanted', visible: true });
    assert.ok(h.runUntil(() => u.skill.activations > 0, 1), 'the wanted enemy triggers a cast with full SP');
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some(c => c.source === u && c.target === e && c.dmg.isSkill), 6),
      'the skill actually damages the wanted target');
    finish(h);
  });
}

test('Lemuen marking through another Laterano operator also triggers S3 outside her own range', () => {
  const h = makeBattle({ autoFinish: false, hooks: ['damaged'], captureNoisy: true,
    defs: { enemies: { elite: enemyRec({ key: 'elite', rank: 'ELITE', hp: 1e8, speed: 0 }) },
      chess: { marker: chessRec({ id: 'marker', bonds: ['lateranoShip'], rangeGrid: [[0, 7]], skill: null, stats: { atk: 0 } }) } },
    units: [{ uid: 1, chessId: 'chess_char_6_01_a', row: 12, col: 2 }, { uid: 2, chessId: 'marker', row: 10, col: 2 }],
  });
  h.step(); const u = h.unit(1), e = h.spawn('elite', { pos: [10, 9] });
  u.skill.charges = 1;
  h.run(u.mem.wantedInterval - .5); assert.equal(u.skill.activations, 0);
  assert.ok(h.runUntil(() => e.findBuff('lemuen:wanted') && u.skill.activations > 0, 3));
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some(c => c.source === u && c.target === e && c.dmg.tags.includes('bombard')), 5));
  finish(h);
});

for (const tier of [5, 6]) for (const elite of [false, true]) for (const fly of [false, true]) for (const injured of [false, true]) {
  test(`Kaltsit S2 auto-casts for enemies first: T${tier}, elite=${elite}, fly=${fly}, injured=${injured}`, () => {
    const h = makeBattle({ autoFinish: false, hooks: ['damaged', 'heal', 'attack'], captureNoisy: true,
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0, motion: fly ? 'FLY' : 'WALK' }) },
        chess: { patient: chessRec({ id: 'patient', skill: null, stats: { atk: 0, maxHp: 1e7 } }) } },
      units: [{ uid: 1, diy: { slot: tier, charId: 'char_1052_kalts2', skillIndex: 1 }, elite, row: 10, col: 4 },
        { uid: 2, chessId: 'patient', row: 10, col: 5 }],
    });
    h.step(); const u = h.unit(1), patient = h.unit(2);
    u.skill.charges = 1;
    h.run(.5); assert.equal(u.skill.activations, 0, 'no enemy or injury: preserve the skill');
    if (injured) patient.hp = patient.s.maxHp * .3;
    const e = h.spawn('dummy', { pos: [9, 7] }); // Inside S2 y-11, outside basic y-6 and patient burst radius.
    assert.ok(h.runUntil(() => u.skill.active, 1), 'enemy alone can start S2');
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some(c => c.source === u && c.target === e && c.type === 'true'), 4),
      'the enemy receives the skill shot even when a distant ally is injured');
    assert.equal(h.hooksOf('heal').filter(c => c.source === u && c.target === patient && !c.opts?.regen).length, 0,
      'an injured ally does not take priority over an enemy in skill range');
    h.b.kill(e, null);
    patient.hp = patient.s.maxHp * .3;
    const heals = h.hooksOf('heal').length;
    assert.ok(h.runUntil(() => h.hooksOf('heal').slice(heals).some(c => c.source === u && c.target === patient && !c.opts?.regen && c.amount > 0), 4),
      'after the last enemy dies, the remaining S2 shots heal allies');
    finish(h);
  });
}
