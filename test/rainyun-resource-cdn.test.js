import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cdnCatalogFromManifest, restoreCdnMappings, buildRainyunResourceManifest } from '../tools/rainyun-resource-cdn.mjs';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';

const hash = body => createHash('sha256').update(body).digest('hex');
const body = 'verified asset', digest = hash(body);
const entry = { hash: digest, bytes: Buffer.byteLength(body), cdn: `https://assets.weishuxieyi.icu/pilot/content/${digest}.png` };
const source = { version: 1, entries: { '/assets/a.png': entry, '/assets/duplicate.png': entry },
  cdn: { provider: 'r2', manifestId: 'a'.repeat(64), mappedResources: 2 } };

test('verified mapping import deduplicates content without changing the uploaded identity', () => {
  const catalog = cdnCatalogFromManifest(source);
  assert.equal(Object.keys(catalog.entries).length, 1);
  assert.deepEqual(catalog.entries[digest], { bytes: entry.bytes, cdn: entry.cdn });
  assert.equal(catalog.manifestId, source.cdn.manifestId);
});

test('only matching content is mapped; changed/new files and stale URLs remain origin-only', () => {
  const catalog = cdnCatalogFromManifest(source);
  const original = { version: 1, count: 4, totalBytes: 100, entries: {
    '/assets/renamed.png': { hash: digest, bytes: entry.bytes },
    '/assets/changed.png': { hash: hash('changed'), bytes: 7, cdn: entry.cdn },
    '/assets/wrong-size.png': { hash: digest, bytes: entry.bytes + 1, cdn: entry.cdn },
    '/assets/new.png': { hash: hash('new'), bytes: 3 },
  }, aliases: { '/media/a': '/assets/renamed.png' } };
  const mapped = restoreCdnMappings(original, catalog);
  assert.equal(mapped.entries['/assets/renamed.png'].cdn, entry.cdn);
  for (const name of ['changed', 'wrong-size', 'new']) assert.equal(mapped.entries[`/assets/${name}.png`].cdn, undefined);
  assert.equal(mapped.cdn.mappedResources, 1);
  assert.equal(mapped.cdn.mappedBytes, entry.bytes);
  assert.equal(mapped.count, original.count);
  assert.equal(mapped.totalBytes, original.totalBytes);
  assert.deepEqual(mapped.aliases, original.aliases);
  assert.equal(original.entries['/assets/changed.png'].cdn, entry.cdn, 'input is not mutated');
  const routes = resourceRoutingCatalog(mapped);
  const shard = [...routes.values()].find(v => v.entries?.['/assets/renamed.png']);
  assert.equal(shard.entries['/assets/renamed.png'].cdn, entry.cdn);
});

test('untrusted URLs, invalid identities, missing catalogs and conflicting sizes are refused', async () => {
  for (const override of [{ cdn: 'https://foreign.test/pilot/a.png' }, { cdn: entry.cdn + '?token=secret' },
    { hash: 'bad' }, { bytes: 0 }, { bytes: 1.5 }, { bytes: 33 * 1048576 }]) {
    assert.throws(() => cdnCatalogFromManifest({ ...source, entries: { '/assets/a.png': { ...entry, ...override } } }));
  }
  assert.throws(() => cdnCatalogFromManifest({ ...source, entries: { a: entry, b: { ...entry, bytes: entry.bytes + 1 } } }));
  assert.throws(() => cdnCatalogFromManifest({ ...source, entries: {} }));
  await assert.rejects(buildRainyunResourceManifest('/unused', '/missing-cdn-catalog.json.gz'), /ENOENT/);
});

test('the actual package manifest builder retains CDN mappings across repeated builds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-rainyun-cdn-'));
  try {
    const pub = path.join(root, 'public'), file = path.join(root, 'catalog.json.gz');
    await mkdir(path.join(pub, 'assets'), { recursive: true });
    await writeFile(path.join(pub, 'assets/a.png'), body);
    await writeFile(path.join(pub, 'assets/new.png'), 'new');
    await writeFile(file, gzipSync(JSON.stringify(cdnCatalogFromManifest(source))));
    const first = await buildRainyunResourceManifest(pub, file);
    const next = await buildRainyunResourceManifest(pub, file);
    assert.deepEqual(first, next);
    assert.equal(first.entries['/assets/a.png'].cdn, entry.cdn);
    assert.equal(first.entries['/assets/new.png'].cdn, undefined);
    assert.equal(first.cdn.mappedResources, 1);
    await writeFile(path.join(pub, 'assets/a.png'), 'changed');
    await assert.rejects(buildRainyunResourceManifest(pub, file), /No resources match/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
