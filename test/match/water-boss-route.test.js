import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { compileRoute } from '../../server/sim/ai.js';
import { normalizeRoute } from '../../server/sim/simdata.js';

for (const capacity of [4, 5, 6, 7, 8]) {
  for (const bossId of ['boss_2', 'boss_5', 'boss_9']) {
    test(`water map / ${capacity} players / ${bossId}: leaders cross the upper passage on both patrol legs`, () => {
      const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', clientCombat: true, clients: false, captureFrames: false }).start();
      try {
        h.toPrep(1);
        const m = h.m;
        m.stageId = 'act2autochess_m04'; m.stage = m.gd.stage(m.stageId);
        const hidden = DATA.bosses[bossId].hidden;
        m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
        if (hidden) { m.hiddenBossId = bossId; m.teamLp = 200; } else m.bossId = bossId;
        m._planBossWaves(); m.startFinalAssault(hidden);
        for (const field of m.fields) {
          const spec = structuredClone(field.spec);
          // No defenders: observe the full patrol, rather than a boss held by a blocker.
          for (const p of spec.players) p.units = [];
          const b = createBattleFromSpec(spec, m.ds);
          b.start();
          const crossings = new Map();
          for (let tick = 0; tick < 9000 && !b.finished; tick++) {
            b.step();
            for (const e of b.enemies.filter(e => e.isBoss && e.alive && !e.hidden)) {
              const fence = e.mem.mirror ? 15 : 5;
              const previous = crossings.get(e.id) || { n: 0, side: Math.sign(e.x - fence) };
              const side = Math.sign(e.x - fence);
              if (Math.abs(e.x - fence) < .1) assert.ok(e.y > 4.9, `leader ${e.id} crossed lower passage at ${e.x},${e.y}`);
              if (side && previous.side && side !== previous.side) {
                assert.ok(e.y > 4.9, 'the continuous crossing passes row 5');
                previous.n++;
              }
              if (side) previous.side = side;
              crossings.set(e.id, previous);
            }
          }
          assert.equal(crossings.size, spec.players.length, 'primary and mirrored leaders actually spawned');
          for (const crossing of crossings.values()) assert.ok(crossing.n >= 4, 'outbound and return passages repeat for at least two patrols');
          assert.equal(m.errorCount, 0);
        }
      } finally { h.m.dispose(); }
    });
  }
}

for (const [bossId, boss] of Object.entries(DATA.bosses)) {
  test(`water map / ${bossId}: every random leader uses upper crossings, preserving its own waits and skills`, () => {
    const h = makeMatch({ capacity: 4, humans: 4, difficulty: 'ABYSS', clientCombat: true, clients: false }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      m.stageId = 'act2autochess_m04'; m.stage = m.gd.stage(m.stageId);
      m.round = boss.hidden ? m.gd.hiddenRound : m.gd.bossRound;
      if (boss.hidden) { m.hiddenBossId = bossId; m.teamLp = 200; } else m.bossId = bossId;
      m._planBossWaves(); m.startFinalAssault(boss.hidden);
      const b = createBattleFromSpec(m.fields[0].spec, m.ds);
      b.start();
      for (let i = 0; i < 900; i++) b.step();
      const leaders = b.enemies.filter(e => e.isBoss);
      assert.ok(leaders.length);
      for (const e of leaders) {
        assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
        let c = e.spawnX, r = e.spawnY;
        for (const leg of e.route.legs) {
          if (leg.t === 'move') {
            for (const fence of [5, 15]) {
              if ((c < fence && leg.c > fence) || (c > fence && leg.c < fence)) {
                assert.equal(r, 5, 'crossing starts on upper lane');
                assert.equal(leg.r, 5, 'crossing ends on upper lane');
              }
            }
            c = leg.c; r = leg.r;
          } else if (leg.t === 'appear') { c = leg.c; r = leg.r; }
        }
      }
      assert.equal(m.errorCount, 0);
    } finally { h.m.dispose(); }
  });
}

test('water passage preserves template data, patrol looping and other-map routes', () => {
  const h = makeMatch({ capacity: 4, humans: 4, difficulty: 'ABYSS', clientCombat: true, clients: false }).start();
  try {
    h.toPrep(1);
    const m = h.m;
    const original = JSON.stringify(DATA.waves);
    m.stageId = 'act1autochess_m01'; m.stage = m.gd.stage(m.stageId);
    m.round = m.gd.bossRound; m.bossId = 'boss_5';
    m._planBossWaves(); m.startFinalAssault(false);
    const f = m.fields[0], b = createBattleFromSpec(f.spec, m.ds);
    b.start(); b.step();
    const leader = b.enemies.find(e => e.isBoss);
    assert.ok(leader);
    const tpl = DATA.waves[f.spec.waveId];
    const s = tpl.spawns.find(s => s.tag === 'boss');
    assert.deepEqual(leader.route.legs, compileRoute(normalizeRoute(tpl.routes[s.routeIndex]), b.rect));
    assert.equal(JSON.stringify(DATA.waves), original);
  } finally { h.m.dispose(); }
});
