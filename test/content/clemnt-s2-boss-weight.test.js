import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildBossWave, setupMatchWaves } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { makeBattle, flatStage, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const D = getData({ log: { warn() {}, error() {}, info() {} } });
const BOSSES = Object.values(D.bosses);
const MODES = Object.keys(D.config.modes);
const stage = flatStage({ rows: Object.fromEntries(Array.from({ length: 19 }, (_, r) => [r, 'r'.repeat(21)])) });
const finish = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };

test('every production boss wave adds weight exactly once; escorts and boss parts keep their original weight', () => {
  let checked = 0;
  for (const modeId of MODES) {
    const gd = new GameData(D, modeId);
    const setup = setupMatchWaves(gd, createRng(17));
    for (const boss of BOSSES) {
      const template = boss.templates[modeId];
      if (!template) continue;
      const wave = buildBossWave(gd, createRng(17), setup.factions, template.round, { bossId: boss.bossId, solo: modeId.startsWith('mode_single_') });
      assert.equal(wave.templateId, template.template);
      const h = makeBattle({ kind: boss.hidden ? 'hidden' : 'boss', content: 'none', autoFinish: false });
      h.b.enemyOverrides = wave.overrides;
      let leaders = 0;
      for (const s of wave.spawns) {
        const def = h.b.data.getEnemy(s.enemyKey);
        if (!def) continue;
        const original = wave.overrides[def.key]?.stats?.massLevel ?? def.massLevel;
        const e = h.spawn(s.enemyKey, { ...s, pos: [3, 10] });
        assert.equal(e.base.massLevel, original + (s.tag === 'boss' ? 3 : 0), `${modeId}/${boss.bossId}/${s.enemyKey}`);
        if (e.isBoss) { leaders++; checked++; assert.ok(e.s.massLevel > 8); }
      }
      assert.ok(leaders > 0, `${modeId}/${boss.bossId}: actual leader spawn`);
      for (const key of boss.parts) {
        const part = h.spawn(key, { tag: 'part', pos: [3, 10] });
        assert.equal(part.base.massLevel, h.b.data.getEnemy(key).massLevel);
      }
      finish(h);
    }
  }
  assert.ok(checked >= BOSSES.length);
});

for (const boss of BOSSES) for (const elite of [false, true]) for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
  test(`S2 cannot capture or move ${boss.bossId} with +3 weight (${elite ? 'elite' : 'normal'}, ${dir})`, () => {
    const h = makeBattle({ stage, autoFinish: false, timeLimit: 60, flags: { dpPerSec: 0 },
      units: [{ uid: 1, diy: { slot: 5, charId: 'char_4231_clemnt', skillIndex: 1 }, elite, row: 10, col: 5, dir }],
    });
    h.step();
    const u = h.unit(1), [dr, dc] = u.fwd;
    const e = h.spawn(boss.enemyKey, { tag: 'boss', pos: [u.y + dr, u.x + dc], mods: { speedMul: 0 } });
    h.b.addBuff(e, { key: 'test:stationary', flags: { noMove: true, disarm: true, invulnerable: true } });
    const start = [e.x, e.y];
    assert.equal(e.base.massLevel, D.enemies[boss.enemyKey].stats.massLevel + 3);
    u.skill.charges = 1;
    assert.ok(u.skill.activate('test'));
    let collided = false;
    for (let i = 0; i < 60; i++) {
      h.step();
      const w = u.mem.clemnt.capsule;
      collided ||= !!w?.seen.has(e);
      assert.ok(!w?.passengers.has(e), 'boss was never a passenger');
      assert.equal(e.hidden, false);
      assert.ok(!e.s.flags.isolated);
      assert.deepEqual([e.x, e.y], start, 'no capsule-induced pull or push');
    }
    assert.ok(collided, 'capsule actually collided with the boss');
    assert.ok(u.mem.clemnt.capsule === null, 'capsule completed its travel');
    finish(h);
  });
}

test('S2 still transports ordinary enemies up to weight 8 and refuses weight 9', () => {
  for (const mass of [1, 8, 9]) {
    const h = makeBattle({ stage, autoFinish: false, timeLimit: 60,
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0, mass }) } },
      units: [{ uid: 1, diy: { slot: 5, charId: 'char_4231_clemnt', skillIndex: 1 }, row: 10, col: 5 }],
    });
    h.step();
    const u = h.unit(1), e = h.spawn('dummy', { pos: [10, 6] });
    assert.equal(e.s.massLevel, mass);
    u.skill.charges = 1;
    assert.ok(u.skill.activate('test'));
    h.run(.3);
    assert.equal(e.hidden, mass <= 8);
    h.run(1.3);
    assert.equal(e.hidden, false);
    assert.ok(!e.s.flags.isolated);
    assert.ok(Math.abs(e.x - (mass <= 8 ? 8 : 6)) < 1e-6);
    finish(h);
  }
});

test('restoring the original pipe boss weight cannot bypass the capsule leader protection', () => {
  const h = makeBattle({ stage, autoFinish: false, timeLimit: 60,
    units: [{ uid: 1, diy: { slot: 5, charId: 'char_4231_clemnt', skillIndex: 1 }, row: 10, col: 5, dir: 'RIGHT' }],
  });
  h.step();
  const u = h.unit(1), [dr, dc] = u.fwd;
  const e = h.spawn('enemy_9021_acduml', { tag: 'boss', pos: [u.y + 2 * dr, u.x + 2 * dc] });
  // The old +3 weight fix alone let this large hitbox snap backwards into the capsule.
  e.base.massLevel = D.enemies[e.defId].stats.massLevel;
  e.markDirty();
  h.b.addBuff(e, { key: 'test:stationary', flags: { noMove: true, disarm: true, invulnerable: true } });
  const start = [e.x, e.y];
  u.skill.charges = 1;
  assert.ok(u.skill.activate('test'));
  h.step();
  assert.ok(u.mem.clemnt.capsule.seen.has(e), 'capsule collided with the large hitbox');
  assert.ok(!e.hidden && !e.s.flags.isolated);
  assert.deepEqual([e.x, e.y], start, 'low original weight no longer permits a backward snap');
  h.run(2);
  assert.equal(e.hidden, false);
  assert.deepEqual([e.x, e.y], start);
  finish(h);
});
