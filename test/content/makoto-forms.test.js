import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { fxForm } from '../../shared/protocol.js';

const supportChessId = (_char, tier, gold = false) => `chess_char_${tier}_diy1_${gold ? 'b' : 'a'}`;
const char = 'char_4217_makoto';
function setup(skillIndex, gold = false, extra = {}) {
  const id = supportChessId(char, 5, gold);
  const h = makeBattle({ units: [{ diy: { slot: 5, charId: char, skillIndex }, elite: gold, row: 10, col: 4 }],
    autoFinish: false, timeLimit: 120, seed: 7, ...extra });
  h.step();
  return { h, u: h.unit(id) };
}
const fatal = (h, u) => h.b.dealDamage(null, u, { amount: 1e8, type: 'true' });

for (const skill of [0, 1, 2]) for (const gold of [false, true]) for (const trigger of ['skill', 'fatal']) {
  test(`Makoto S${skill + 1} ${gold ? 'elite' : 'normal'} ${trigger} switches, uses the persona range and returns`, () => {
    const { h, u } = setup(skill, gold);
    const range = u.rangeGrid;
    if (trigger === 'skill') u.skill.activate('test', { free: true }); else fatal(h, u);
    assert.ok(u.alive && u.trait.doll);
    assert.equal(u.form, 'doll');
    assert.ok(h.eventsOf('fx').some(ev => ev[4]?.id === u.id && fxForm(ev) === 'doll'));
    h.run(1.1);
    assert.equal(u.hp, u.s.maxHp);
    assert.equal(u.profile.dmgType, 'arts');
    assert.deepEqual(u.rangeGrid, u.def.skill.rangeGrid, 'the passive persona range survives the instant skill ending');
    h.run(21);
    assert.equal(u.form, null);
    assert.equal(u.trait.doll, false);
    assert.equal(u.profile.noAttack, false);
    assert.equal(u.profile.dmgType, 'phys');
    assert.deepEqual(u.rangeGrid, range);
    checkInvariants(h.b);
  });
}

test('Makoto S3 fatal damage changes Thanatos to Orpheus and serializes the new form', () => {
  const { h, u } = setup(2);
  u.skill.activate('test', { free: true }); h.run(1.1);
  fatal(h, u);
  assert.ok(u.alive && u.trait.doll && u.mem.makotoOrpheus);
  assert.equal(u.form, 'makotoOrpheus');
  assert.equal(unitInfo(u).form, 'makotoOrpheus', 'late joins and observers receive the current form');
  assert.ok(h.eventsOf('fx').some(ev => ev[4]?.id === u.id && fxForm(ev) === 'makotoOrpheus'));
  assert.equal(u.profile.noAttack, true);
  assert.equal(u.s.blockCnt, u.def.skill.bb['attack@block_cnt']);
  h.run(21);
  assert.equal(u.form, null);
  assert.equal(u.mem.makotoOrpheus, false);
  assert.equal(u.profile.noAttack, false);
  checkInvariants(h.b);
});

for (const gold of [false, true]) test(`Makoto S3 ${gold ? 'elite' : 'normal'} cannot actively switch its output persona to healing`, () => {
  const { h, u } = setup(2, gold);
  u.skill.activate('test', { free: true }); h.run(1.1);
  const timer = u.findBuff('trait:substitute');
  const left = timer.timeLeft;
  u.skill.activate('test-second-cast', { free: true });
  assert.equal(u.form, 'doll');
  assert.equal(u.mem.makotoOrpheus, false);
  assert.equal(u.profile.noAttack, false);
  assert.equal(timer.timeLeft, left, 'an extra cast must not reset the original substitute deadline');
  h.run(left + 1.1);
  assert.equal(u.form, null);
  assert.equal(u.trait.doll, false);
  checkInvariants(h.b);
});

for (const gold of [false, true]) for (const killed of [false, true]) {
  test(`Makoto S3 ${gold ? 'elite' : 'normal'} natural combat ${killed ? 'fatal healing' : 'output only'} returns on the original timer`, () => {
    const enemy = enemyRec({ key: 'makoto_timer_enemy', hp: 1e8, atk: 0, speed: 0 });
    const id = supportChessId(char, 5, gold);
    const h = makeBattle({ units: [{ diy: { slot: 5, charId: char, skillIndex: 2 }, elite: gold, row: 10, col: 4 }],
      defs: { enemies: { [enemy.key]: enemy } }, enemies: [{ key: enemy.key, pos: [10, 5] }],
      autoFinish: false, timeLimit: 120, seed: 7 });
    h.step(); const u = h.unit(id);
    h.runUntil(() => u.trait.doll, 30);
    assert.equal(u.form, 'doll');
    const castCount = u.skill.activations;
    const deadline = h.b.time + u.findBuff('trait:substitute').timeLeft;
    h.run(10);
    if (killed) {
      const left = u.findBuff('trait:substitute').timeLeft;
      fatal(h, u);
      assert.equal(u.form, 'makotoOrpheus');
      assert.equal(u.findBuff('trait:substitute').timeLeft, left, 'fatal healing does not extend the substitute period');
    }
    while (h.b.time < deadline - 0.1) {
      h.step();
      assert.equal(u.form, killed ? 'makotoOrpheus' : 'doll');
      assert.equal(u.skill.activations, castCount, 'never auto-cast the second phase');
    }
    h.run(1.3);
    assert.ok(u.alive && u.deployed);
    assert.equal(u.form, null);
    assert.equal(u.mem.makotoOrpheus, false);
    assert.equal(u.profile.noAttack, false);
    assert.equal(u.profile.dmgType, 'phys');
    assert.equal(u.trait.doll, false);
    assert.ok(h.eventsOf('fx').some(ev => ev[4]?.id === u.id && fxForm(ev) === null));
    assert.equal(u.skill.activations, castCount, 'returning must not immediately re-enter a substitute with recovered SP');
    checkInvariants(h.b);
  });
}

for (const gold of [false, true]) test(`Makoto S3 ${gold ? 'elite' : 'normal'} carries a ready charge into fatal substitution without auto-casting healing`, () => {
  const enemy = enemyRec({ key: 'makoto_charge_enemy', hp: 1e8, atk: 0, speed: 0 });
  const { h, u } = setup(2, gold, { defs: { enemies: { [enemy.key]: enemy } },
    enemies: [{ key: enemy.key, pos: [10, 5] }] });
  u.skill.setSpTotal(u.skill.spCost);
  assert.ok(u.skill.ready);
  fatal(h, u); h.run(8);
  assert.equal(u.form, 'doll');
  assert.equal(u.mem.makotoOrpheus, false);
  assert.equal(u.skill.activations, 0);
  assert.ok(u.skill.ready, 'the saved charge is not consumed by a second-phase cast');
  checkInvariants(h.b);
});

test('Makoto S3 knocked out as Orpheus redeploys as an attacking body and can switch again', () => {
  const { h, u } = setup(2);
  u.skill.activate('test', { free: true }); h.run(1.1);
  fatal(h, u); fatal(h, u);
  assert.equal(u.alive, false);
  assert.equal(u.form, null);
  assert.equal(u.mem.makotoOrpheus, false);
  assert.equal(u.profile.noAttack, false, 'the non-attacking persona must not survive a knock-down');
  assert.equal(u.profile.dmgType, 'phys');
  assert.ok(h.b.redeploy(u, { free: true }));
  assert.ok(u.alive && !u.trait.doll);
  assert.equal(u.profile.noAttack, false);
  fatal(h, u); h.run(1.1);
  assert.equal(u.form, 'doll');
  assert.equal(u.mem.makotoOrpheus, false);
  assert.equal(u.profile.noAttack, false);
  checkInvariants(h.b);
});
