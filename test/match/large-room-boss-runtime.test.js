import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { PHASE, roomBossHp } from '../../shared/constants.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';

// Production data and the real simulator, including the unpaired last seat in 5/7-player rooms.
for (const capacity of [5, 6, 7, 8]) {
  for (const [bossId, boss] of Object.entries(DATA.bosses)) {
    test(`${capacity} players / ${bossId}: every field starts, mirrors its partner, and uses the same full-sized leader pool`, () => {
      const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', clientCombat: true, clients: false, captureFrames: false }).start();
      try {
        h.toPrep(1);
        const m = h.m;
        m.round = boss.hidden ? m.gd.hiddenRound : m.gd.bossRound;
        if (boss.hidden) { m.hiddenBossId = bossId; m.teamLp = 200; }
        else m.bossId = bossId;
        m._planBossWaves();
        const initialLp = m.order.reduce((sum, ps) => sum + ps.lp, 0);
        m.startFinalAssault(boss.hidden);
        assert.equal(m.phase, boss.hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT);
        assert.equal(m.teamLp, boss.hidden ? 200 : initialLp);
        assert.equal(m.fields.length, Math.ceil(capacity / 2));
        assert.deepEqual(m.fields.flatMap(f => f.players).sort(), m.order.map(ps => ps.playerId).sort());
        assert.deepEqual(m.fields.map(f => f.players), m.bossPairs);
        assert.equal(m.bossPool.maxHp, Math.round(bossPoolHp(m.gd, bossId, capacity) * roomBossHp(capacity)));
        for (const f of m.fields) {
          assert.equal(f.spec.boss.poolMax, m.bossPool.maxHp);
          const replica = createBattleFromSpec(f.spec, m.ds);
          assert.deepEqual(replica.players.map(p => p.playerId), f.players);
          if (f.players.length === 2) assert.deepEqual(f.spec.players.map(p => p.side), ['L', 'R']);
          else assert.equal(f.spec.players[0].side, 'L');
          replica.start();
          for (let tick = 0; tick < 600 && !replica.finished; tick++) replica.step();
          assert.ok(replica.enemies.some(e => e.isBoss), `leader actually spawned on ${f.fieldId}`);
          for (const e of replica.enemies) {
            assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${f.fieldId}: finite enemy position`);
            assert.ok(Number.isFinite(e.hp) && Number.isFinite(e.s.maxHp), `${f.fieldId}: finite enemy HP`);
          }
        }
        assert.equal(m.errorCount, 0);
      } finally { h.m.dispose(); }
    });
  }

  test(`${capacity} players: actual client simulations report leaks and settle a defeat without hanging`, () => {
    const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', clientCombat: true, captureFrames: false }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      m.round = m.gd.bossRound; m.bossId = 'boss_8';
      for (const ps of m.order) ps.lp = 10;
      m._planBossWaves(); m.startFinalAssault(false);
      const fieldCount = m.fields.length;
      assert.equal(m.teamLp, capacity * 10);
      const result = h.runToEnd({ maxSteps: 1000000 });
      assert.equal(result.victory, false);
      assert.equal(m.phase, PHASE.RESULT);
      assert.equal(h.endedCount, 1);
      assert.equal(m.errorCount, 0, h.logs.error.join('\n'));
      assert.equal(m.verifyStats.rejected, 0);
      const authorities = [...h.clients.values()].flatMap(c => c.starts.filter(s => s.authoritative));
      assert.equal(new Set(authorities.map(s => s.fieldId)).size, fieldCount);
    } finally { h.m.dispose(); }
  });

  test(`${capacity} players: real autoplay lineups clear a reduced-HP fixture and every pair receives the victory`, () => {
    // Only this flow fixture reduces HP, to exercise a kill quickly. The 40 cases above check unchanged production HP.
    const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', clientCombat: true, captureFrames: false, seed: 12 });
    try {
      const m = h.m;
      m.bossId = 'boss_1';
      m.gd.bossHpMul = () => .0005;
      h.autoHumans(); m.start();
      let last = '';
      h.run(() => {
        const key = `${m.round}:${m.phase}`;
        if (last !== key) {
          last = key;
          if (m.round === 1 && m.phase === PHASE.PREP) for (const ps of m.order) ps.lp = 500;
        }
        return h.ended != null || m.phase === PHASE.FINAL_ASSAULT;
      }, { maxSteps: 8000000 });
      assert.equal(m.phase, PHASE.FINAL_ASSAULT, 'real match reached the final round');
      assert.equal(m.alivePlayers().length, capacity);
      assert.equal(m.fields.length, Math.ceil(capacity / 2));
      const result = h.runToEnd({ maxSteps: 8000000 });
      assert.equal(result.victory, true);
      assert.equal(m.bossPool.hp, 0);
      assert.equal(h.endedCount, 1);
      assert.equal(m.errorCount, 0, h.logs.error.join('\n'));
      assert.equal(m.verifyStats.rejected, 0);
      for (const pid of m.order.map(ps => ps.playerId)) assert.ok(h.lastTo(pid, 'm.result'), `${pid}: result received`);
    } finally { h.m.dispose(); }
  });
}
