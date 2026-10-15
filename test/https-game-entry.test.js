import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pinText } from '../server/hot/gateway.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="https-game-entry">([\s\S]*?)<\/script>/)[1];
function enter(url, code = script) {
  const parsed = new URL(url), replacements = [];
  const window = { location: {
    protocol: parsed.protocol, hostname: parsed.hostname, search: parsed.search, hash: parsed.hash,
    replace(url) { replacements.push(url); },
  } };
  vm.runInNewContext(code, { window });
  return { replacements, redirecting: !!window.__SP_HTTPS_REDIRECTING };
}
for (const url of [
  'http://43.161.201.122:14517/',
  'http://43.161.201.122:14517/_build/old/?room=ABCD&lang=zh-CN',
  'http://weishuxieyi.icu/',
  'http://www.weishuxieyi.icu:14517/?room=ABCD',
]) test(`HTTP entry redirects to the active HTTPS home: ${url}`, () => {
  const result = enter(url);
  assert.deepEqual(result.replacements, ['https://weishuxieyi.icu/game.html' + new URL(url).search]);
  assert.equal(result.redirecting, true);
});
for (const url of [
  'https://weishuxieyi.icu/_build/new/', 'https://www.weishuxieyi.icu/',
  'http://localhost:3231/', 'http://127.0.0.1:3231/', 'http://192.168.1.5:14517/',
  'http://other.example:14517/',
]) test(`HTTPS and local previews do not redirect: ${url}`, () => {
  assert.deepEqual(enter(url), { replacements: [], redirecting: false });
});
test('gateway HTML rewriting preserves the canonical redirect and invitation query', () => {
  const pinned = pinText(html, 'text/html', '/', 'new');
  const code = pinned.match(/<script id="https-game-entry">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(enter('http://43.161.201.122:14517/_build/new/?room=ABCD', code).replacements,
    ['https://weishuxieyi.icu/game.html?room=ABCD']);
  assert.ok(pinned.indexOf('id="https-game-entry"') < pinned.indexOf('rel="modulepreload"'));
  const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(!globalThis\.__SP_HTTPS_REDIRECTING\) boot\(\)/);
});
