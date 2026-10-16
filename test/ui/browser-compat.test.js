import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { installCompat } from '../../public/js/ui/compat.js';

test('older browser: missing allSettled, timeout and UUID use compatible implementations', async () => {
  class OldPromise extends Promise {}
  Object.defineProperty(OldPromise, 'allSettled', { value: undefined, configurable: true });
  const g = { Promise: OldPromise, AbortController, AbortSignal: {}, crypto: { getRandomValues(bytes) { bytes.fill(255); return bytes; } } };
  installCompat(g);
  const failure = new Error('no');
  assert.deepEqual(await g.Promise.allSettled([1, Promise.reject(failure)]), [
    { status: 'fulfilled', value: 1 }, { status: 'rejected', reason: failure },
  ]);
  const signal = g.AbortSignal.timeout(0);
  await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(signal.aborted, true);
  assert.throws(() => g.AbortSignal.timeout(-1), RangeError);
  assert.match(g.crypto.randomUUID(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('boot diagnostics show syntax failures even without import map support', () => {
  const source = readFileSync(new URL('../../public/js/boot.js', import.meta.url), 'utf8');
  const listeners = {};
  const err = { textContent: '', getAttribute() { return this.final; }, setAttribute() { this.final = true; } };
  const button = { hidden: true };
  const boot = { classList: { contains() { return false; } } };
  const window = { addEventListener(name, fn) { listeners[name] = fn; } };
  vm.runInNewContext(source, { window, navigator: { userAgent: 'QQ test' }, location: { hostname: 'localhost' }, setTimeout() {}, document: { addEventListener() {}, getElementById(id) { return { 'boot-err': err, 'boot-retry': button, boot }[id]; } } });
  listeners.error({ message: 'Unexpected token ?' });
  assert.match(err.textContent, /Unexpected token/);
  assert.equal(button.hidden, false);
  assert.equal(window.__SP_BOOT_DIAGNOSTIC.browser, 'QQ test');
});
