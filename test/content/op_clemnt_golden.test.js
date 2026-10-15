// Fixed real-wave scenario: twelve Clementia loadouts through the production BattleSpec path.
// Separate from the old DIY corpus, whose baseline already differs from the current workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBattle } from '../../tools/golden.mjs';

test('Clementia twelve-loadout production battle matches its isolated golden result', () => {
  const fixture = JSON.parse(readFileSync(new URL('../golden/clementia.json', import.meta.url), 'utf8'));
  assert.deepEqual(runBattle(fixture.scenario), fixture.digest);
});
