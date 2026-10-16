import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildResourceManifest } from '../server/http/resourceManifest.js';
import { resourceEntry } from '../public/js/resources/policy.js';

test('scene JSON and BIN share the immutable resource cache while ordinary JSON remains outside its allowlist', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'v025-scene-resource-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const dir = path.join(root, 'assets/local/scene/act2autochess_m01');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'scene.json'), '{"version":1}');
  await writeFile(path.join(dir, 'scene.bin'), Buffer.from([1, 2, 3, 4]));
  await writeFile(path.join(dir, 'device.obj'), 'v 0 0 0\n');
  await writeFile(path.join(root, 'assets/runtime.json'), '{"private":true}');
  const manifest = await buildResourceManifest(root);
  const base = 'https://example.test/_build/compatible/';
  for (const file of ['scene.json', 'scene.bin', 'device.obj']) {
    const url = `/assets/local/scene/act2autochess_m01/${file}`;
    assert.ok(manifest.entries[url]);
    assert.match(manifest.entries[url].hash, /^[a-f0-9]{64}$/);
    assert.equal(resourceEntry(new Request(new URL(url.slice(1), base)), base, manifest), manifest.entries[url]);
  }
  assert.equal(manifest.entries['/assets/runtime.json'], undefined);
  assert.equal(resourceEntry(new Request(new URL('data/config.json', base)), base, manifest), null);
});
