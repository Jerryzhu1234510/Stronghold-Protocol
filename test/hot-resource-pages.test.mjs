import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { applyResourcePages, digest } from '../tools/hot-resource-pages.mjs';
import { startGateway } from '../server/hot/gateway.mjs';
import { TestClient } from './helpers/wsClient.js';
const root = path.resolve(import.meta.dirname, '..');

test('resource page group preserves immutable modules, pinned imports and a real running match', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, '.cache/resource-page-test-'));
  let gateway, client;
  try {
    for (const dir of ['server', 'shared', 'data']) await cp(path.join(root, dir), path.join(fixture, dir), { recursive: true });
    await cp(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
    await cp(path.join(root, 'HOT-RELEASE.json'), path.join(fixture, 'HOT-RELEASE.json'));
    await writeFile(path.join(fixture, 'MANIFEST.json'), '{"files":{}}');
    const expected = {}, modules = {};
    for (const relative of ['js/resources/client.js', 'js/resources/manifest.js', 'js/versus/app.js', 'js/browser/main.js', 'js/browser/versus.js', 'js/browser/training.js', 'index.html', 'versus.html', 'training.html', 'js/browser/game.html', 'js/browser/versus.html']) {
      const file = path.join(fixture, 'public', relative); await mkdir(path.dirname(file), { recursive: true });
      const body = relative.endsWith('.html') ? '<html><head><script type="importmap">{"imports":{"preact":"/vendor/preact.module.js"}}</script><script src="/js/browser/main.js"></script></head><body>fixture</body></html>' : 'export const old = true;';
      await writeFile(file, body); expected[relative] = digest(body);
      if (relative.endsWith('.js')) modules['/' + relative] = Buffer.from('export const repaired = true;');
    }
    gateway = await startGateway({ releaseRoot: fixture, accountFile: path.join(fixture, '..', path.basename(fixture) + '-accounts.json'), allowCreateAccounts: true, port: 0, log: { info() {} } });
    const id = gateway.active.id, origin = `http://127.0.0.1:${gateway.port}`, prefix = `/_build/${id}`;
    client = await TestClient.connect(`ws://127.0.0.1:${gateway.port}${prefix}/ws`); await client.hello('resrepair');
    assert.equal((await client.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
    assert.equal((await client.request({ t: 'room.start' })).t, 'ok');
    await client.waitFor('m.public', m => m.phase === 'INFO_CHECK');
    await assert.rejects(applyResourcePages({ releaseRoot: fixture, modules, expected: { ...expected, 'training.html': 'bad' } }), /Unexpected published base/);
    const patch = await applyResourcePages({ releaseRoot: fixture, modules, expected });
    for (const page of Object.keys(patch.pages)) {
      const response = await fetch(origin + prefix + '/' + page); assert.match(response.headers.get('cache-control'), /no-store/);
      const html = await response.text(), map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
      assert.match(html, /__SP_LOCAL_RESOURCES_REQUIRED/);
      for (const [name, entry] of Object.entries(patch.published)) assert.equal(map.imports[prefix + name], prefix + entry.alias);
      assert.ok(html.includes('src="' + prefix + patch.published['/js/browser/main.js'].alias + '"'));
    }
    assert.equal(await fetch(origin + prefix + '/js/resources/client.js').then(r => r.text()), 'export const old = true;');
    assert.equal(await fetch(origin + prefix + patch.published['/js/resources/client.js'].alias).then(r => r.text()), 'export const repaired = true;');
    assert.equal(client.isOpen, true); assert.equal(gateway.active.id, id); assert.equal(gateway.releases.size, 1);
    assert.equal((await client.request({ t: 'g.infoReady' })).t, 'ok');
    assert.equal((await fetch(origin + prefix + '/healthz').then(r => r.json())).matches, 1);
  } finally {
    await client?.terminate().catch(() => {}); await gateway?.close();
    if (fixture.startsWith(path.join(root, '.cache/resource-page-test-'))) await rm(fixture, { recursive: true, force: true });
  }
});
