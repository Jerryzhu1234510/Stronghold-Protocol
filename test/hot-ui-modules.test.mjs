import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUiModules } from '../tools/hot-ui-modules.mjs';
import { startGateway, pinText } from '../server/hot/gateway.mjs';
import { TestClient } from './helpers/wsClient.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
test('UI patch changes new HTML imports while cached old modules and an existing real match keep working', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, '.cache/ui-hot-test-'));
  let gateway, client;
  const oldModule = 'export const zoom = 1;';
  const newModule = Buffer.from('export const zoom = 1.2;');
  try {
    for (const dir of ['server', 'shared', 'data']) await cp(path.join(root, dir), path.join(fixture, dir), { recursive: true });
    await mkdir(path.join(fixture, 'public/js/render'), { recursive: true });
    await mkdir(path.join(fixture, 'public/js/ui'), { recursive: true });
    await writeFile(path.join(fixture, 'public/js/ui/fieldHost.js'), 'export const band = 144;');
    await writeFile(path.join(fixture, 'public/js/render/projection.js'), oldModule);
    await writeFile(path.join(fixture, 'public/index.html'), '<html><head><script type="importmap">{"imports":{"preact":"/vendor/preact.module.js"}}</script></head><body>camera</body></html>');
    await cp(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
    gateway = await startGateway({ releaseRoot: fixture, port: 0, log: { info() {} } });
    const id = gateway.active.id, origin = `http://127.0.0.1:${gateway.port}`, prefix = `/_build/${id}`;
    const published = await fetch(origin + prefix + '/js/render/projection.js').then(r => r.text());
    client = await TestClient.connect(`ws://127.0.0.1:${gateway.port}${prefix}/ws`);
    await client.hello('ui-hot-match');
    assert.equal((await client.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
    assert.equal((await client.request({ t: 'room.start' })).t, 'ok');
    await client.waitFor('m.public', message => message.phase === 'INFO_CHECK');
    await assert.rejects(applyUiModules({ releaseRoot: fixture, modules: { '/js/render/projection.js': newModule }, expectedCameraSha256: 'bad' }), /Unexpected base/);
    const patch = await applyUiModules({ releaseRoot: fixture, modules: { '/js/render/projection.js': newModule, '/js/ui/fieldHost.js': Buffer.from('export const band = 108;') }, expectedCameraSha256: sha(oldModule) });
    const page = await fetch(origin + prefix + '/');
    assert.match(page.headers.get('cache-control'), /\bno-store\b/);
    const html = await page.text();
    const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    assert.equal(imports[prefix + '/js/render/projection.js'], prefix + patch.modules['/js/render/projection.js'].alias);
    assert.match(html, /sp-ui-revision/);
    assert.equal(await fetch(origin + imports[prefix + '/js/render/projection.js']).then(r => r.text()), newModule.toString());
    assert.equal(await fetch(origin + imports[prefix + '/js/ui/fieldHost.js']).then(r => r.text()), 'export const band = 108;');
    assert.equal(await readFile(path.join(fixture, 'public/js/ui/fieldHost.js'), 'utf8'), 'export const band = 144;', 'published HUD module remains unchanged');
    assert.equal(await fetch(origin + prefix + '/js/render/projection.js').then(r => r.text()), published, 'old immutable module is unchanged');
    assert.equal(await readFile(path.join(fixture, 'public/js/render/projection.js'), 'utf8'), oldModule);
    assert.equal(gateway.active.id, id);
    assert.equal(gateway.releases.size, 1, 'no new worker or generation');
    assert.equal(client.isOpen, true);
    await assert.rejects(applyUiModules({ releaseRoot: fixture, modules: { '/sim/Battle.js': newModule }, expectedCameraSha256: sha(oldModule) }), /Only approved client/);
    await assert.rejects(applyUiModules({ releaseRoot: fixture, modules: { '/js/render/app.js': newModule }, expectedCameraSha256: sha(oldModule) }), /requires both/);
    const perfModules = {
      '/js/render/app.js': Buffer.from('import { level } from "./adaptiveLoad.js"; export { level };'),
      '/js/render/adaptiveLoad.js': Buffer.from('export const level = 3;'),
      '/js/battle/runner.js': Buffer.from('export const budgetMs = 12;'),
    };
    await mkdir(path.join(fixture, 'public/js/battle'), { recursive: true });
    const priorEntry = await readFile(path.join(fixture, 'public/index.html'), 'utf8');
    const perfPatch = await applyUiModules({ releaseRoot: fixture, modules: perfModules, expectedCameraSha256: sha(oldModule) });
    const patchedHtml = await fetch(origin + prefix + '/').then(r => r.text());
    const perfImports = JSON.parse(patchedHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    assert.equal(perfImports[prefix + '/js/render/projection.js'], imports[prefix + '/js/render/projection.js'], 'retain the existing camera patch');
    for (const [name, bytes] of Object.entries(perfModules)) {
      const alias = prefix + perfPatch.modules[name].alias;
      assert.equal(perfImports[prefix + name], alias);
      assert.equal(await fetch(origin + alias).then(r => r.text()), pinText(bytes.toString(), 'text/javascript', perfPatch.modules[name].alias, id));
    }
    assert.equal(await readFile(perfPatch.backup, 'utf8'), priorEntry, 'backup preserves the previous entry');
    assert.equal(client.isOpen, true, 'performance patch preserves the live match connection');
    assert.equal(gateway.active.id, id);
    assert.equal((await client.request({ t: 'g.infoReady' })).t, 'ok');
    assert.equal((await fetch(origin + prefix + '/healthz').then(r => r.json())).matches, 1);
  } finally {
    await client?.terminate().catch(() => {});
    await gateway?.close();
    if (fixture.startsWith(path.join(root, '.cache/ui-hot-test-'))) await rm(fixture, { recursive: true, force: true });
  }
});
