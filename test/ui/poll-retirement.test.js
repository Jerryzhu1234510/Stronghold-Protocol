import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('next release lobby no longer imports, renders or automatically opens the concluded poll', async () => {
  const lobby = await readFile(new URL('../../public/js/screens/lobby.js', import.meta.url), 'utf8');
  const entry = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(lobby, /PlayerPoll|playerPoll|pollOpen/);
  assert.doesNotMatch(entry, /player-poll\.css/);
  assert.match(lobby, /PopulationStrip/);
  assert.match(entry, /population-details\.css/);
});
