import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const CLEM = ['chess_char_4_27_a', 'chess_char_4_27_b'];
const ULPIA = 'chess_char_5_05_a', GLADY = 'chess_char_4_12_a', DEEP = 'chess_char_1_04_a';
const FODDER = 'chess_char_1_01_a';
const on = count => ({ count, active: true, tier: count >= 5 ? 2 : 1, layers: 10 });
const buff = u => u.buffs.find(b => b.key === 'bond:egir:devour');
const tagged = h => h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('bond:egir:devour'));
const unit = (uid, chessId, row, col) => ({ uid, chessId, row, col, dir: 'RIGHT' });
function field(kind, units, bonds) {
  const h = makeBattle({ kind, units, bonds, autoFinish: false, timeLimit: 60,
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000000, atk: 0, speed: 0 }) } },
    hooks: ['damaged', 'kill', 'death', 'deploy', 'layerGain'], captureNoisy: true });
  h.step(); return h;
}
const finish = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };

test('native Clementia normal and elite devour the front operator; friendly devour deaths do not advance the custom enemy-kill trait', () => {
  for (const chessId of CLEM) for (const kind of ['normal', 'unite']) {
    const h = field(kind, [unit(1, chessId, 10, 3), unit(2, FODDER, 10, 4), unit(3, GLADY, 12, 3), unit(4, DEEP, 12, 5)],
      { egirShip: on(3), swiftShip: on(3) });
    const c = h.unit(1), food = h.unit(2);
    assert.equal(buff(c)?.mods.atkFinal, food.base.atk);
    assert.equal(buff(c)?.mods.blockCnt, food.base.blockCnt);
    assert.deepEqual(tagged(h).map(e => [e.source.uid, e.target.uid]), [[1, 2]]);
    assert.ok(!food.alive);
    assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, kind === 'unite' ? 10 : 11);
    const n = chessId.endsWith('_b') ? 2 : 3;
    for (let i = 0; i < n - 1; i++) h.b.kill(h.spawn('dummy', { pos: [12, 8] }), c);
    assert.equal(h.result().perPlayer.p1.layerGains.swiftShip ?? 0, 0, 'eating a friendly piece cannot count as an enemy kill');
    h.b.kill(h.spawn('dummy', { pos: [12, 8] }), c);
    assert.equal(h.result().perPlayer.p1.layerGains.swiftShip ?? 0, kind === 'unite' ? 0 : 1);
    finish(h);
  }
});

test('Clementia is devoured as a five-tier Agir and continues the devour chain, normal and elite; unite retains bonuses without layers', () => {
  for (const chessId of CLEM) for (const kind of ['normal', 'unite']) {
    const h = field(kind, [unit(1, ULPIA, 10, 3), unit(2, chessId, 10, 4), unit(3, FODDER, 10, 5), unit(4, DEEP, 12, 3)], { egirShip: on(3) });
    const u = h.unit(1), c = h.unit(2), food = h.unit(3);
    assert.equal(buff(u)?.mods.atkFinal, c.base.atk + food.base.atk);
    assert.equal(buff(u)?.mods.blockCnt, c.base.blockCnt + food.base.blockCnt);
    assert.equal(buff(c)?.mods.atkFinal, food.base.atk);
    assert.equal(c.def.tier, 5);
    assert.deepEqual(tagged(h).map(e => [e.source.uid, e.target.uid]), [[1, 2], [1, 3]]);
    assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, kind === 'unite' ? 10 : 16);
    assert.equal(h.hooksOf('layerGain').filter(e => e.reason === 'garrison').length, 0);
    finish(h);
  }
});

test('Agir five-member revive redeploys a devoured Clementia exactly once, normal and elite, also in unite', () => {
  for (const chessId of CLEM) for (const kind of ['normal', 'unite']) {
    const h = field(kind, [unit(1, ULPIA, 10, 3), unit(2, chessId, 10, 4), unit(3, GLADY, 12, 3), unit(4, DEEP, 12, 5), unit(5, 'chess_char_2_07_a', 12, 7)], { egirShip: on(5) });
    const c = h.unit(2);
    assert.equal(h.hooksOf('death').filter(e => e.unit === c && e.reason === 'killed').length, 1);
    assert.equal(h.hooksOf('deploy').filter(e => e.unit === c && !e.initial).length, 1);
    assert.ok(c.alive); assert.equal(c.skill.id, 'skchr_clemnt_2');
    assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, kind === 'unite' ? 10 : 15);
    finish(h);
  }
});
