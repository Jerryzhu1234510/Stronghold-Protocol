import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinText } from '../../server/hot/gateway.mjs';

test('versus iframe resolves inside its parent release after a hot update', () => {
  const source = readFileSync(new URL('../../public/js/screens/versus.js', import.meta.url), 'utf8');
  const framePath = /const versusFrameUrl = new URL\('([^']+)', import\.meta\.url\)\.href/.exec(source)?.[1];
  assert.ok(framePath);
  assert.match(source, /src=\$\{versusFrameUrl\}/);
  for (const base of ['https://game.test/js/screens/versus.js', 'https://game.test/_build/old-17/js/screens/versus.js']) {
    const pinned = base.includes('/_build/');
    assert.equal(new URL(framePath, base).href, `https://game.test/${pinned ? '_build/old-17/' : ''}versus.html?embedded=1`);
  }
  assert.match(pinText(source, 'application/javascript', '/js/screens/versus.js', 'old-17'), /new URL\('\.\.\/\.\.\/versus\.html\?embedded=1', import\.meta\.url\)/);
});
