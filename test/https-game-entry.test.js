import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pinText } from '../server/hot/gateway.mjs';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/js/compat030/index-html-2.js', import.meta.url), 'utf8');
function enter(url) {
  const parsed = new URL(url), replacements = [];
  const window = { location: { protocol: parsed.protocol, hostname: parsed.hostname, search: parsed.search, hash: parsed.hash,
    replace(url) { replacements.push(url); } } };
  vm.runInNewContext(script, { window });
  return { replacements, redirecting: !!window.__SP_HTTPS_REDIRECTING };
}
test('8443 HTTP entry keeps query and fragment when upgrading to HTTPS', () => {
  assert.deepEqual(enter('http://weishuxieyiwangye.cn/?room=ABCD#entry'), {
    replacements: ['https://weishuxieyiwangye.cn:8443/game.html?room=ABCD#entry'], redirecting: true });
});
for (const url of ['https://weishuxieyiwangye.cn:8443/', 'https://weishuxieyi.icu/', 'http://weishuxieyi.icu/',
  'http://localhost:27630/', 'http://127.0.0.1:27630/', 'http://192.168.1.5:27630/']) test('origin preserved: ' + url, () => {
  assert.deepEqual(enter(url), { replacements: [], redirecting: false });
});
test('gateway pins the external redirect script before the app', () => {
  const pinned = pinText(html, 'text/html', '/', 'new');
  assert.match(pinned, /compat030\/index-html-2\.js/);
  assert.ok(pinned.indexOf('compat030/index-html-2.js') < pinned.indexOf('rel="modulepreload"'));
});
