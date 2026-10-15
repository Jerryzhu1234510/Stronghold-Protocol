import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { generateDraft } from '../server/match/choices.js';
import { createRng } from '../server/sim/rng.js';
import { makeMatch } from './match/harness.js';

const data = getData();
const highModes = ['mode_single_hard', 'mode_single_abyss', 'mode_multi_hard', 'mode_multi_abyss'];
test('high difficulty enters reward drafts at R3/R9/R11, with the first two fixed to enemies', () => {
  for (const mode of highModes) {
    const gd = new GameData(data, mode);
    assert.deepEqual(gd.spRounds(), [3, 9, 11]);
    assert.deepEqual(data.choices.schedule[mode].spRounds, gd.spRounds());
    assert.deepEqual(Object.keys(data.choices.schedule[mode].rounds), ['3', '9', '11']);
    for (const round of [3, 9]) {
      const rng = createRng(714 + round);
      for (let i = 0; i < 100; i++) {
        const draft = generateDraft(gd, rng, round, { stageId: 'act1autochess_m01' });
        assert.equal(draft.family, 'bounty');
        assert.ok(draft.cards.length);
        assert.ok(draft.cards.every(c => c.enemyKey !== 'enemy_1512_mcmstr'));
      }
    }
  }
});
test('only the last high-difficulty reward draws the three categories with equal weights', () => {
  for (const mode of highModes) {
    const gd = new GameData(data, mode), rng = createRng(724), counts = { bounty: 0, shop: 0, tactic: 0 };
    assert.deepEqual(data.choices.schedule[mode].rounds[11].families,
      ['bounty', 'shop', 'tactic'].map(family => ({ family, weight: 1 })));
    for (let i = 0; i < 1500; i++) {
      const draft = generateDraft(gd, rng, 11, { stageId: 'act1autochess_m01' });
      counts[draft.family]++;
      assert.ok(draft.cards.length);
      assert.ok(draft.cards.every(c => c.enemyKey !== 'enemy_1512_mcmstr'));
    }
    for (const n of Object.values(counts)) assert.ok(n > 400 && n < 600, JSON.stringify({ mode, counts }));
  }
});
test('training, standard and hazardous difficulties retain their distinct rules', () => {
  const rounds = mode => data.choices.schedule[mode].rounds;
  assert.deepEqual(rounds('mode_training_1')[3].families, [{ family: 'supply', weight: 100 }]);
  assert.deepEqual(rounds('mode_single_funny'), {});
  for (const round of [3, 9]) assert.deepEqual(rounds('mode_multi_funny')[round].families,
    [{ family: 'supply', weight: 45 }, { family: 'tactic', weight: 35 }, { family: 'shop', weight: 20 }]);
  assert.deepEqual(rounds('mode_single_normal')[6].families, [{ family: 'supply', weight: 100 }]);
  assert.deepEqual(rounds('mode_single_normal')[9].families, [{ family: 'tactic', weight: 100 }]);
  for (const round of [3, 6, 9]) assert.deepEqual(rounds('mode_multi_normal')[round].families,
    [{ family: 'bounty', weight: 50 }, { family: 'supply', weight: 25 }, { family: 'shop', weight: 10 }, { family: 'tactic', weight: 15 }]);
});
test('custom overlay keeps the corrected schedule and round-11 card pools after rebuilding', () => {
  for (const mode of highModes) {
    const changes = data['custom-overlay'];
    assert.deepEqual(changes.config.find(c => c.path.join('.') === 'modes.' + mode + '.spRounds').value, [3, 9, 11]);
    assert.deepEqual(changes.choices.find(c => c.path.join('.') === 'schedule.' + mode + '.rounds').value,
      data.choices.schedule[mode].rounds);
  }
  for (const key of ['shopDraft', 'tacticDraft']) assert.ok(data.choices[key].rounds.includes(11));
});
test('the match actually opens the fixed rewards when entering rounds 3 and 9, then the random reward at 11', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 1, seed: 42, data, fake: true });
  try {
    h.start();
    for (const round of [3, 9, 11]) {
      assert.ok(h.drive(() => h.m.phase === 'SP_DRAFT' && h.m.round === round, { band: 'band_sarkazb' }));
      if (round !== 11) assert.equal(h.m.sp.family, 'bounty');
      else assert.ok(['bounty', 'shop', 'tactic'].includes(h.m.sp.family));
    }
  } finally { h.m.dispose(); }
});
