import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { withUnitLoadouts } from '../../server/sim/spec.js';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const D = getData({ log: { warn() {}, error() {}, info() {} } });
const forms = [
  { chessId: 'chess_char_4_27_a' }, { chessId: 'chess_char_4_27_b' },
  ...[5, 6].flatMap(slot => [false, true].map(elite => ({
    diy: { slot, charId: 'char_4231_clemnt', skillIndex: 2, uniEquipId: null }, elite,
  }))),
];

function field(form, { hp = 1000000, def = 300, rank = 'NORMAL' } = {}) {
  const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
    units: [{ uid: 1, row: 10, col: 5, dir: 'RIGHT', skillIndex: 2, ...form }] }];
  const enemies = { dummy: enemyRec({ key: 'dummy', hp, def, rank, atk: 0, speed: 0 }) };
  const data = new DataSource({ ...D, enemies: { ...D.enemies, ...enemies } }, null);
  const h = makeBattle({ autoFinish: false, ...(form.diy
    ? { units: players[0].units, defs: { enemies } }
    : { players, data: withUnitLoadouts(data, players) }) });
  h.step();
  const u = h.unit(1), e = h.spawn('dummy', { pos: [10, 6] });
  const bursts = [], attacks = [], rockets = [];
  h.b.on('elementBurst', c => { if (c.target === e) bursts.push(c); });
  h.b.on('damaged', c => {
    if (c.source !== u || c.target !== e) return;
    if (c.type === 'phys' && c.dmg.tags.includes('clemnt:s3')) attacks.push(c);
    if (c.dmg.tags.includes('clemnt:rocket')) rockets.push(c);
  });
  h.b.rng.chance = () => false;
  u.skill.charges = 1;
  assert.ok(u.skill.activate('test'));
  return { h, u, e, bursts, attacks, rockets };
}

function finish(h) {
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors, []);
}

test('all native and DIY S3 forms accumulate actual attacks into normal and leader erosion bursts', () => {
  for (const form of forms) for (const rank of ['NORMAL', 'BOSS']) {
    const { h, u, e, bursts, attacks, rockets } = field(form, { rank });
    h.runUntil(() => bursts.length > 0, 30);
    assert.equal(bursts.length, 1, JSON.stringify({ form, rank }));
    assert.equal(bursts[0].source, u);
    assert.equal(bursts[0].element, 'erosion');
    const accumulated = attacks.reduce((sum, c) => sum + c.amount * .2, 0);
    assert.ok(accumulated >= e.gaugeMax);
    assert.ok(accumulated - attacks.at(-1).amount * .2 < e.gaugeMax);
    h.run(3.2);
    assert.equal(u.skill.ammoLeft, 9);
    assert.equal(rockets.filter(c => c.type === 'phys').length, 3);
    assert.equal(rockets.filter(c => c.type === 'elemental').length, 3);
    finish(h);
  }
});

test('high DEF slows S3 erosion according to actual physical damage, without spending ammunition', () => {
  const { h, u, e, bursts, attacks } = field(forms[0], { def: 10000 });
  h.run(12);
  assert.ok(attacks.length > 5);
  assert.equal(bursts.length, 0);
  assert.ok(Math.abs(e.elem.erosion - attacks.reduce((sum, c) => sum + c.amount * .2, 0)) < 1e-6);
  assert.equal(u.skill.ammoLeft, 10);
  finish(h);
});

test('a low-HP target killed by S3 physical attacks cannot reach the erosion burst threshold', () => {
  const { h, u, e, bursts } = field(forms[0], { hp: 4000 });
  h.run(6);
  assert.equal(e.alive, false);
  assert.equal(bursts.length, 0);
  assert.equal(u.skill.ammoLeft, 10);
  finish(h);
});
