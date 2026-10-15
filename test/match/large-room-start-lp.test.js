import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { roomStartLp, roomScaling } from '../../shared/constants.js';
import { attachAudit } from '../../server/match/audit.js';

const ratios = [[4, 10], [5, 11], [6, 12], [7, 13], [8, 14]];

test('initial LP: every extra seat adds 10% of the four-seat base without floating-point extra HP', () => {
  for (const [capacity, numerator] of ratios) {
    for (let base = 1; base <= 100; base++) {
      assert.equal(roomStartLp(base, capacity), Math.ceil(base * numerator / 10));
      if (capacity > 4) assert.ok(roomStartLp(base, capacity) > base);
    }
    assert.deepEqual(roomScaling(capacity), { cards: capacity / 4, enemyHp: Math.min(1.5, capacity / 4) });
  }
  assert.deepEqual(ratios.map(([capacity]) => roomStartLp(28, capacity)), [28, 31, 34, 37, 40]);
  for (const capacity of [null, undefined, 0, 1, 3, 9, '8']) assert.equal(roomStartLp(28, capacity), 28);
});

for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
  test(`${difficulty}: all strategies and fallback have identical reduced LP in normal and clone rooms`, () => {
    const base = new GameData(DATA, `mode_multi_${difficulty.toLowerCase()}`);
    for (const [capacity, numerator] of ratios) {
      for (const cloneMode of [false, true]) {
        const gd = new GameData(DATA, base.modeId, { capacity, cloneMode });
        for (const id of [...base.bandIds(), 'unknown']) {
          const expected = Math.ceil(base.startLp(id) * numerator / 10);
          assert.equal(gd.startLp(id), expected, `${capacity}:${cloneMode}:${id}`);
          if (capacity > 4) assert.ok(expected > base.startLp(id));
        }
      }
    }
    const solo = new GameData(DATA, `mode_single_${difficulty.toLowerCase()}`, { capacity: 8 });
    for (const id of solo.bandIds()) assert.equal(solo.startLp(id), DATA.bands[id].totalHp);
  });
}

for (const [capacity, numerator] of ratios) for (const gameMode of ['normal', 'clone']) {
  test(`${gameMode}/${capacity}: actual draft assignment, public state and audit agree on initial LP`, () => {
    const h = makeMatch({ humans: 1, bots: capacity - 1, capacity, gameMode, fake: true });
    const audit = attachAudit(h.m);
    try {
      h.start();
      h.toPrep(1);
      for (const ps of h.m.order) {
        assert.equal(ps.lp, Math.ceil(DATA.bands[ps.bandId].totalHp * numerator / 10));
        assert.equal(h.m.publicView().players.find(p => p.playerId === ps.playerId).lp, ps.lp);
      }
      assert.deepEqual(audit.violations, []);
      h.invariants();
    } finally { h.m.dispose(); }
  });
}
