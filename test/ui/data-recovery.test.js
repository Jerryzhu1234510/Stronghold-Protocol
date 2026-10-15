import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore } from '../../public/js/data.js';

test('missing bond data recovers after a transient outage without hiding the current UI or duplicate requests', async () => {
  let calls = 0, online = false, resolve;
  const store = createDataStore({ retryDelays: [], fetch: async () => {
    calls++;
    if (!online) throw new Error('offline');
    return new Promise(r => { resolve = r; });
  } });
  await store.load('bonds');
  assert.equal(store.status('bonds'), 'missing');
  online = true;
  const pending = store.retryMissing('bonds');
  assert.equal(store.status('bonds'), 'missing', 'keep the match on screen during recovery');
  const same = store.retryMissing('bonds');
  assert.equal(same, pending);
  assert.equal(calls, 2);
  resolve(Response.json({ egirShip: { bondId: 'egirShip', name: '阿戈尔' } }));
  await pending;
  assert.equal(store.lookup('bonds', 'egirShip').name, '阿戈尔');
  assert.equal(store.status('bonds'), 'ready');
});

test('definite 404s are not repeatedly requested in the background', async () => {
  let calls = 0;
  const store = createDataStore({ retryDelays: [], fetch: async () => { calls++; return new Response('', { status: 404 }); } });
  await store.load('optional');
  await store.retryMissing('optional');
  assert.equal(calls, 1);
});
