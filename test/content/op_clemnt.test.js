import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, flatStage, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { pickOptions, pickChoices, slotRecord } from '../../public/js/ui/diyModel.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const B = load('backups'), C = load('chess'), ID = 'char_4231_clemnt';
const forms = B.units[ID].forms;
const combos = [[5, false], [6, false], [5, true], [6, true]];
const form = (tier, elite) => forms[elite ? `2/60/7/${tier === 5 ? 1 : 3}` : '2/1/4/0'];
const close = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const defs = { enemies: {
  enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, def: 300, speed: 0, mass: 1 }),
  enemy_zero: enemyRec({ key: 'enemy_zero', hp: 1e9, speed: 0, mass: 0 }),
  enemy_heavy: enemyRec({ key: 'enemy_heavy', hp: 1e9, speed: 0, mass: 9 }),
  enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e9, speed: 0, motion: 'FLY' }),
  enemy_immune: enemyRec({ key: 'enemy_immune', hp: 1e9, speed: 0, otherImmunities: ['ISOLATE'] }),
  enemy_walker: enemyRec({ key: 'enemy_walker', hp: 1e9, speed: 0.5, mass: 1 }),
} };
function field({ tier = 5, elite = false, skill = 0, dir = 'RIGHT', stage, seed = 17 } = {}) {
  const h = makeBattle({ defs, ...(stage ? { stage } : {}), autoFinish: false, timeLimit: 900, seed,
    hooks: ['attack', 'damaged', 'skillStart', 'skillEnd', 'elementBurst', 'ammoUsed'], captureNoisy: true,
    flags: { dpPerSec: 0 },
    units: [{ uid: 1, diy: { slot: tier, charId: ID, skillIndex: skill, uniEquipId: null }, elite, row: 10, col: 5, dir }],
  });
  h.step();
  const u = h.unit(1);
  h.b.rng.chance = () => false;
  return { h, u };
}
function cast(u) { u.skill.charges = 1; assert.ok(u.skill.activate('test')); }
function done(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }
function hits(h, u, filter = () => true) {
  const out = [];
  h.b.on('damaged', (c) => { if (c.source === u && c.type !== 'element' && filter(c)) out.push(c); });
  return out;
}

test('Clementia is a real legal pick at tiers 5/6; all three skills and every normal/elite form use generated official data', () => {
  assert.equal(typeof OPERATOR_KITS[ID], 'function');
  for (const tier of [5, 6]) {
    assert.ok(diyPool(tier, { data: { chess: C, backups: B }, kitted: KITTED_CHARS }).includes(ID));
    const slot = `chess_char_${tier}_diy1_a`, data = { chess: C, backups: B };
    assert.equal(pickOptions(slot, {}, data, KITTED_CHARS).find(p => p.charId === ID)?.unit.name, '克莱门莎');
    assert.equal(pickChoices(ID, slot, data).skills.length, 3);
    assert.equal(slotRecord(slot, { charId: ID, skillIndex: 2 }, data).charId, ID);
    assert.ok(validateDiyPicks({ [`chess_char_${tier}_diy1_a`]: { charId: ID, skillIndex: 2, uniEquipId: null } },
      { data: { chess: C, backups: B }, kitted: KITTED_CHARS }).ok);
  }
  for (const [tier, elite] of combos) for (const skill of [0, 1, 2]) {
    const { h, u } = field({ tier, elite, skill });
    const f = form(tier, elite), s = f.skills[skill];
    assert.equal(u.def.charId, ID); assert.equal(u.kit.skillSource, 'skills'); assert.ok(!u.kit.generic);
    assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.bat], [f.stats.maxHp, f.stats.atk, f.stats.def, f.stats.bat]);
    assert.deepEqual([u.s.blockCnt, u.profile.dmgType, u.profile.canHitFly, u.profile.sub], [2, 'phys', false, 'primguard']);
    assert.deepEqual(u.liveRangeGrid, f.rangeGrid);
    assert.equal(u.skill.id, s.skillId); assert.equal(u.skill.rule, s.trigger.rule);
    done(h);
  }
});

test('生死定夺 rolls per physical instance: 25% intact DEF, 50% reduced DEF; scales ATK before DEF; no roll for arts / elemental', () => {
  for (const [tier, elite] of combos) {
    const { h, u } = field({ tier, elite });
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    const asked = []; h.b.rng.chance = (p) => { asked.push(p); return true; };
    const t = form(tier, elite).talents[0].bb;
    close(h.b.dealDamage(u, e, { amount: 1000, type: 'phys' }), 1000 * t.t1_atk_scale - 300);
    h.b.addBuff(e, { key: 'test:def', mods: { defFlat: -120 } });
    close(h.b.dealDamage(u, e, { amount: 1000, type: 'phys' }), 1000 * t.t1_atk_scale - 180);
    h.b.dealDamage(u, e, { amount: 10, type: 'arts' });
    h.b.dealDamage(u, e, { amount: 10, type: 'elemental' });
    assert.deepEqual(asked, [t.prob_normal, t.prob_special]); done(h);
  }
});

test('习得性防御 rotates with facing, includes the same tile line / own blocker, uses 海怪 tag, affects physical and arts only', () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    const { h, u } = field({ dir });
    const [dr, dc] = u.fwd;
    const front = h.spawn('enemy_zero', { pos: [u.tileR + dr, u.tileC + dc] });
    const back = h.spawn('enemy_zero', { pos: [u.tileR - dr, u.tileC - dc] });
    const normal = form(5, false).talents[1].bb.damage_resistance_normal;
    const sea = form(5, false).talents[1].bb.damage_resistance_seamonster;
    close(h.b.dealDamage(front, u, { amount: 500, type: 'arts' }), 500 * .9 * (1 - normal));
    close(h.b.dealDamage(back, u, { amount: 500, type: 'arts' }), 500 * .9);
    front.tags.add('seamonster');
    close(h.b.dealDamage(front, u, { amount: 500, type: 'phys' }), (500 - u.s.def) * (1 - sea));
    close(h.b.dealDamage(front, u, { amount: 10, type: 'elemental' }), 10);
    close(h.b.dealDamage(front, u, { amount: 10, type: 'true' }), 10);
    back.blockedBy = u; u.blocking.push(back);
    close(h.b.dealDamage(back, u, { amount: 100, type: 'arts' }), 90 * (1 - normal));
    done(h);
  }
});

test('S1 冲蚀 uses rank4/7 ATK multiplier and feeds erosion from actual physical damage, then returns to ordinary attacks', () => {
  for (const [tier, elite] of combos) {
    const { h, u } = field({ tier, elite });
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    const list = hits(h, u); const s = form(tier, elite).skills[0];
    cast(u); h.run(.1);
    assert.equal(list.length, 1);
    close(list[0].amount, u.s.atk * s.bb.atk_scale - e.s.def);
    close(e.elem.erosion, list[0].amount * s.bb.ep_damage_ratio);
    assert.ok(!u.skill.active);
    const erosion = e.elem.erosion;
    h.run(1.3);
    assert.ok(list.length >= 2); close(e.elem.erosion, erosion); done(h);
  }
});

test('S1 does not fill erosion after a dodged or lethal hit', () => {
  for (const lethal of [false, true]) {
    const { h, u } = field(); const e = h.spawn('enemy_zero', { pos: [10, 6] });
    if (lethal) e.hp = 1;
    else h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    cast(u); h.run(.1);
    close(e.elem.erosion, 0); assert.equal(e.alive, !lethal); done(h);
  }
});

test('S2 capsule travels three tiles at 2/s; isolates / releases ground enemies, rejects excess weight, flying and immune enemies; resumes attacks', () => {
  const { h, u } = field({ skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  const heavy = h.spawn('enemy_heavy', { pos: [10, 6] });
  const air = h.spawn('enemy_fly', { pos: [10, 6] });
  const immune = h.spawn('enemy_immune', { pos: [10, 6] });
  const list = hits(h, u);
  cast(u); h.run(.3);
  assert.ok(e.hidden && e.s.flags.isolated); assert.ok(u.s.flags.disarm);
  assert.ok(!heavy.hidden && !air.hidden && !immune.hidden); assert.equal(list.length, 0);
  h.run(1.3);
  assert.ok(!e.hidden && !e.s.flags.isolated && !u.s.flags.disarm);
  close(e.x, u.x + 3); close(e.y, u.y);
  h.run(.7); assert.ok(list.some((c) => c.dmg.tags.includes('clemnt:s2'))); done(h);
});

test('S2 cumulative weight 8 and passenger count 15; one capsule per cast, no airborne capture', () => {
  for (const [key, expected] of [['enemy_dummy', 8], ['enemy_zero', 15]]) {
    const { h, u } = field({ skill: 1 });
    const es = Array.from({ length: 18 }, () => h.spawn(key, { pos: [10, 6] }));
    cast(u); h.run(.3);
    assert.equal(es.filter((e) => e.hidden).length, expected);
    assert.equal(u.mem.clemnt.capsule.count, expected);
    h.run(2); assert.ok(es.every((e) => !e.hidden)); done(h);
  }
});

test('S2 emits a persistent vortex at the capsule endpoint even with no enemies', () => {
  const { h, u } = field({ skill: 1 });
  cast(u); h.run(1.6);
  const events = h.eventsOf('fx').filter(e => e[1] === 'clemntVortex');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].slice(2, 4), [u.x + 3, u.y]);
  assert.equal(events[0][4].radius, 1.5);
  assert.equal(events[0][4].dur, 2);
  h.run(2.1); assert.equal(u.mem.clemnt.zones.length, 0);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'clemntVortex').length, 1);
  done(h);
});

test('S2 capsule stops before a crate/high tile and restores every passenger and attack flag on skill cancellation or death', () => {
  for (const mode of ['crate', 'high', 'cancel', 'death']) {
    const high = flatStage();
    high.rows[10] = high.rows[10].slice(0, 7) + 'h' + high.rows[10].slice(8);
    const terrain = mode === 'crate' ? flatStage({ crates: [[10, 7]] })
      : mode === 'high' ? high : null;
    const { h, u } = field({ skill: 1, ...(terrain ? { stage: terrain } : {}) });
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    cast(u); h.run(.3); assert.ok(e.hidden);
    if (mode === 'cancel') u.skill.end('test');
    else if (mode === 'death') h.b.kill(u, null);
    else h.run(1.3);
    assert.ok(!e.hidden && !e.s.flags.isolated); assert.ok(!u.s.flags.disarm);
    assert.equal(u.mem.clemnt.capsule, null);
    if (mode === 'crate' || mode === 'high') assert.ok(e.x < 6.5);
    else assert.equal(u.mem.clemnt.zones.length, 0);
    done(h);
  }
});

test('S2 attacks hit primary + at most five nearby ground targets; vortex lasts 2s, slows air too, deals erosion and physical once/sec', () => {
  const { h, u } = field({ skill: 1 });
  cast(u); h.run(1.6);
  const z = u.mem.clemnt.zones[0]; assert.ok(z);
  const es = Array.from({ length: 8 }, () => h.spawn('enemy_dummy', { pos: [10, 6] }));
  const list = hits(h, u, (c) => c.dmg.tags.includes('clemnt:s2'));
  h.run(.1); assert.equal(list.length, 6); assert.equal(new Set(list.map((c) => c.target)).size, 6);
  const air = h.spawn('enemy_fly', { pos: [10, 8] });
  const vx = hits(h, u, (c) => c.target === air && c.dmg.tags.includes('clemnt:vortex'));
  h.run(.1); close(air.s.moveSpeed, air.base.moveSpeed * .3);
  h.run(1.1); assert.equal(vx.length, 1); close(air.elem.erosion, 200);
  h.run(1.1); assert.equal(u.mem.clemnt.zones.length, 0); assert.ok(!air.findBuff(`clemnt:vortex:${u.id}`));
  assert.ok(es.every((e) => e.alive)); done(h);
});

test('S3 ordinary attacks hit three ground targets and build erosion; attacks never consume rocket ammunition', () => {
  for (const [tier, elite] of combos) {
    const { h, u } = field({ tier, elite, skill: 2 });
    const es = Array.from({ length: 4 }, () => h.spawn('enemy_dummy', { pos: [10, 7] }));
    const air = h.spawn('enemy_fly', { pos: [10, 7] });
    cast(u); const ammo = u.skill.ammoLeft; h.run(.1);
    const damaged = es.filter((e) => e.hp < e.s.maxHp);
    assert.equal(damaged.length, 3); close(air.hp, air.s.maxHp); assert.equal(u.skill.ammoLeft, ammo);
    const bb = form(tier, elite).skills[2].bb;
    for (const e of damaged) close(e.elem.erosion, (u.s.atk * bb['attack@atk_scale'] - 300) * bb['attack@ep_damage_ratio']);
    done(h);
  }
});

test('S3 listens to erosion burst anywhere from another source; one round gives three cross-shaped physical + elemental strikes at +1/+2/+3s', () => {
  const { h, u } = field({ skill: 2 }); cast(u);
  const e = h.spawn('enemy_dummy', { pos: [12, 9] });
  const adjacent = h.spawn('enemy_dummy', { pos: [11, 9] });
  const diagonal = h.spawn('enemy_dummy', { pos: [11, 8] });
  const air = h.spawn('enemy_fly', { pos: [11, 9] });
  const list = hits(h, u, (c) => c.dmg.tags.includes('clemnt:rocket'));
  const ammo = u.skill.ammoLeft;
  h.b.dealDamage(null, e, { type: 'element', element: 'erosion', amount: 1000 });
  h.step(); assert.equal(u.skill.ammoLeft, ammo - 1); assert.equal(list.length, 0);
  h.run(3.1);
  assert.equal(list.length, 12); assert.ok(list.every((c) => c.target === e || c.target === adjacent));
  assert.equal(list.filter((c) => c.type === 'elemental').length, 6);
  close(diagonal.hp, diagonal.s.maxHp); close(air.hp, air.s.maxHp);
  const bb = form(5, false).skills[2].bb;
  close(list.find((c) => c.target === adjacent && c.type === 'phys').amount, u.s.atk * bb.s3_atk_scale - 300);
  close(list.find((c) => c.type === 'elemental').amount, u.s.atk * bb.ep_damage_scale);
  done(h);
});

test('S3 filters non-erosion, ally and flying bursts; same-tile missiles are excluded for 5s; marks expire after 1s when stunned', () => {
  const { h, u } = field({ skill: 2 }); cast(u);
  const e = h.spawn('enemy_dummy', { pos: [12, 9] });
  const air = h.spawn('enemy_fly', { pos: [12, 9] });
  const ammo = u.skill.ammoLeft;
  h.b.emit('elementBurst', { source: null, target: e, element: 'burn' });
  h.b.emit('elementBurst', { source: null, target: u, element: 'erosion' });
  h.b.emit('elementBurst', { source: null, target: air, element: 'erosion' });
  h.step(); assert.equal(u.skill.ammoLeft, ammo);
  h.b.emit('elementBurst', { source: null, target: e, element: 'erosion' });
  h.step(); assert.equal(u.skill.ammoLeft, ammo - 1);
  h.b.emit('elementBurst', { source: null, target: e, element: 'erosion' });
  h.run(1.2); assert.equal(u.skill.ammoLeft, ammo - 1);
  h.b.applyStatus(u, 'stun', { duration: 2 });
  const far = h.spawn('enemy_dummy', { pos: [12, 7] });
  h.b.emit('elementBurst', { source: null, target: far, element: 'erosion' });
  h.run(2.2); assert.equal(u.skill.ammoLeft, ammo - 1); done(h);
});

test('S3 ends only when rocket ammunition is empty; the final launched rocket still lands, death cancels outstanding missiles', () => {
  for (const death of [false, true]) {
    const { h, u } = field({ skill: 2 }); cast(u); u.skill.ammoLeft = 1;
    const e = h.spawn('enemy_dummy', { pos: [12, 9] });
    const list = hits(h, u, (c) => c.dmg.tags.includes('clemnt:rocket'));
    h.b.emit('elementBurst', { source: null, target: e, element: 'erosion' });
    h.step(); assert.ok(!u.skill.active); assert.equal(u.skill.ammoLeft, 0);
    if (death) h.b.kill(u, null);
    h.run(3.2); assert.equal(list.length, death ? 0 : 6); done(h);
  }
});

test('repeated seeded mixed-wave battles under every skill are deterministic and invariant-safe', () => {
  const run = (skill) => {
    const { h, u } = field({ skill, elite: true, seed: 345 });
    // Keep actual RNG: crit draws affect combat and must replay identically.
    h.b.rng.chance = (p) => h.b.rng() < p;
    for (let i = 0; i < 8; i++) h.spawn(i % 3 ? 'enemy_walker' : 'enemy_fly', { routeIndex: i % 2 });
    h.run(90); done(h);
    return [u.stats.dmg, u.stats.taken, u.skill.activations, h.enemies().map((e) => [e.id, e.hp, e.x, e.y, e.hidden])];
  };
  for (const s of [0, 1, 2]) assert.deepEqual(run(s), run(s));
});
