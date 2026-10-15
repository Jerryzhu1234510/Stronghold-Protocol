import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, legalTileFor, chessOfTier } from './harness.js';
import { planUnite } from '../../server/match/unite.js';
import { Battle } from '../../server/sim/Battle.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';

const quiet = { warn() {}, error() {} };

for (const stage of Object.values(DATA.stages).filter(s => s.active !== false)) for (const elite of [false, true]) {
  test(`8-player ${stage.id}: one Touch holder grants all three helpers their own ${elite ? 'Touch' : 'reserve medic'}`, () => {
    const h = makeMatch({ capacity: 8, humans: 8, fake: true, clients: false, instant: false }).start();
    const m = h.m;
    try {
      h.toPrep(1); h.setStage(stage.id);
      // The grant holder is a leaker, outside the three helpers' BattleSpec.
      for (const ps of m.order) ps.bandId = null;
      m.order[7].bandId = 'band_amedic';
      const ids = chessOfTier(1, c => c.position === 'MELEE').filter(id => m.pool.has(id)).slice(0, 2);
      assert.equal(ids.length, 2);
      for (const ps of m.order.slice(0, 3)) for (const base of ids) {
        const id = elite ? m.gd.chess(base).goldenId : base;
        give(m, ps, id, 'board', legalTileFor(m, ps, id));
      }
      const enemyKey = Object.keys(DATA.enemies).find(k => DATA.enemies[k].motion !== 'FLY');
      m.lastResults = new Map(m.order.map((ps, i) => [ps.playerId, {
        perfect: i < 3, leaked: i < 3 ? [] : [{ enemyKey, counted: true, lpr: 1 }],
        unitsEnd: ps.allChess().map(p => ({ uid: p.uid, alive: true, hpPct: .4, sp: 12 })),
      }]));
      const plan = planUnite(m, m.lastResults);
      assert.equal(plan.helpers.length, 3);
      assert.ok(!plan.helpers.includes(m.order[7]));
      const opts = m._uniteOpts(plan, 96);
      const spec = buildBattleSpec({ ...opts, battleId: 'touch-trio-feedback' });
      const direct = new Battle({ ...opts, data: m.ds, content: 'full', logger: quiet });
      const replica = createBattleFromSpec(spec, new DataSource(DATA), { logger: quiet });
      for (const b of [direct, replica]) {
        b.step();
        const tokenId = elite ? 'char_613_acmedc' : 'char_605_cmedic';
        const expected = [[10, 10], [10, 2], [3, 10]];
        for (const [i, ps] of opts.players.entries()) {
          const medic = b.allyUnits.find(u => u.ownerId === ps.playerId && u.defId === tokenId);
          assert.ok(medic, `${ps.playerId}: match-wide Touch grant survives the JSON spec`);
          assert.deepEqual([medic.tileR, medic.tileC], expected[i]);
          assert.equal(medic.dir, 'RIGHT');
          assert.ok(b.onOwnBoard(b.getPlayer(ps.playerId), medic.tileR, medic.tileC));
        }
        assert.equal(b.errorCount, 0);
      }
      assert.deepEqual(direct.snapshot(), replica.snapshot());
    } finally { m.dispose(); }
  });
}
