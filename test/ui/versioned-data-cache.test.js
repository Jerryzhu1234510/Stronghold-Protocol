import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore } from '../../public/js/data.js';

test('pinned static game data reuses HTTP cache while unversioned data still revalidates', async () => {
  const modes = [];
  const fetch = async (_url, init) => { modes.push(init.cache); return Response.json({ chess: {} }); };
  const previous = globalThis.__SP_GENERATION;
  try {
    delete globalThis.__SP_GENERATION;
    await createDataStore({ fetch }).load('chess');
    globalThis.__SP_GENERATION = 'release-3';
    await createDataStore({ fetch }).load('chess');
    assert.deepEqual(modes, ['no-cache', 'default']);
  } finally {
    if (previous === undefined) delete globalThis.__SP_GENERATION;
    else globalThis.__SP_GENERATION = previous;
  }
});
