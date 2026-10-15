import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceDocumentUrl, waitForResourceController } from '../public/js/resources/client.js';

test('history-only entry pinning requests a real canonical document before boot', () => {
  const current = 'https://weishuxieyi.icu/_build/new-1/game.html?room=ABCD#join';
  assert.equal(resourceDocumentUrl(current, 'https://weishuxieyi.icu/game.html?room=ABCD', 'new-1'), current);
  assert.equal(resourceDocumentUrl(current, current, 'new-1'), null, 'canonical navigation never loops');
  assert.equal(resourceDocumentUrl(current, 'https://weishuxieyi.icu/_build/old-1/game.html', 'new-1'), null, 'never migrate a pinned game');
  assert.equal(resourceDocumentUrl(current, 'https://evil.test/game.html', 'new-1'), null);
  assert.equal(resourceDocumentUrl(current, 'https://weishuxieyi.icu/stats', 'new-1'), null);
  assert.equal(resourceDocumentUrl(current, undefined, 'new-1'), null);
  assert.equal(resourceDocumentUrl(current, 'https://weishuxieyi.icu/game.html', '../bad'), null);
  assert.equal(resourceDocumentUrl('file:///game.html', 'file:///game.html', 'new-1'), null);
});

function worker() {
  const listeners = new Set();
  return { controller: null, listeners, addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn), change(url) {
      this.controller = { scriptURL: url }; for (const fn of listeners) fn();
    } };
}

test('model loading waits for this release controller, not just worker activation', async () => {
  const sw = worker(); let registrations = 0;
  const pending = waitForResourceController({ serviceWorker: sw, expectedUrl: 'current', timeoutMs: 100,
    register: async () => { registrations++; return { active: { scriptURL: 'current' } }; } });
  let resolved = false; pending.then(() => { resolved = true; });
  await new Promise(r => setTimeout(r, 1));
  assert.equal(resolved, false); sw.change('old'); await new Promise(r => setTimeout(r, 1));
  assert.equal(resolved, false); sw.change('current'); assert.equal(await pending, true);
  assert.equal(registrations, 1); assert.equal(sw.listeners.size, 0);
  assert.equal(await waitForResourceController({ serviceWorker: sw, expectedUrl: 'current', register: () => { throw new Error('do not re-register'); } }), true);
});

test('blocked or unavailable service workers never block the source fallback indefinitely', async () => {
  for (const register of [async () => null, async () => { throw new Error('denied'); }, () => new Promise(() => {})]) {
    const sw = worker();
    assert.equal(await waitForResourceController({ serviceWorker: sw, expectedUrl: 'current', timeoutMs: 5, register }), false);
    assert.equal(sw.listeners.size, 0);
  }
  assert.equal(await waitForResourceController({ serviceWorker: null }), false);
});
