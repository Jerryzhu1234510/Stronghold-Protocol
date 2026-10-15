import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResourceManifest } from '../server/http/resourceManifest.js';
import { resourceCdnUrl } from '../public/js/resources/transport.js';

export const RAINYUN_CDN_CATALOG = 'deploy/rainyun/resource-cdn.json.gz';

export function validateCdnCatalog(catalog) {
  assert.equal(catalog?.version, 1, 'Invalid CDN catalog version');
  assert.equal(catalog.provider, 'r2', 'Invalid CDN provider');
  assert.match(catalog.manifestId, /^[a-f0-9]{64}$/);
  assert.ok(catalog.entries && typeof catalog.entries === 'object' && !Array.isArray(catalog.entries));
  assert.ok(Object.keys(catalog.entries).length > 0, 'CDN catalog is empty');
  for (const [hash, entry] of Object.entries(catalog.entries)) {
    assert.ok(Number.isSafeInteger(entry.bytes), 'Invalid CDN byte count');
    assert.equal(resourceCdnUrl({ ...entry, hash }), entry.cdn, 'Invalid CDN content URL: ' + hash);
    assert.ok(typeof entry.cdn === 'string', 'Missing CDN content URL');
  }
  return catalog;
}

export function cdnCatalogFromManifest(manifest) {
  assert.equal(manifest?.version, 1);
  assert.ok(manifest.entries && typeof manifest.entries === 'object' && !Array.isArray(manifest.entries));
  assert.equal(manifest.cdn?.provider, 'r2');
  const entries = {};
  for (const entry of Object.values(manifest.entries)) {
    if (!entry.cdn) continue;
    assert.equal(resourceCdnUrl(entry), entry.cdn, 'Invalid source CDN URL');
    const previous = entries[entry.hash];
    assert.ok(!previous || previous.bytes === entry.bytes, 'Conflicting CDN content size');
    entries[entry.hash] ??= { bytes: entry.bytes, cdn: entry.cdn };
  }
  return validateCdnCatalog({ version: 1, provider: 'r2', manifestId: manifest.cdn.manifestId, entries });
}

export function restoreCdnMappings(manifest, catalog) {
  validateCdnCatalog(catalog);
  let mappedResources = 0, mappedBytes = 0;
  const entries = {};
  for (const [url, item] of Object.entries(manifest.entries)) {
    const { cdn: _staleCdn, ...entry } = item;
    const known = Object.hasOwn(catalog.entries, entry.hash) ? catalog.entries[entry.hash] : null;
    if (known && known.bytes === entry.bytes) {
      entry.cdn = known.cdn;
      mappedResources++; mappedBytes += entry.bytes;
    }
    entries[url] = entry;
  }
  const result = { ...manifest, entries, cdn: { provider: 'r2', manifestId: catalog.manifestId, mappedResources, mappedBytes } };
  return result;
}

export async function buildRainyunResourceManifest(publicDir, catalogFile) {
  // The catalog is required: never silently publish an origin-only release after a packaging mistake.
  const catalog = validateCdnCatalog(JSON.parse(gunzipSync(await readFile(catalogFile)).toString('utf8')));
  const manifest = restoreCdnMappings(await buildResourceManifest(publicDir), catalog);
  assert.ok(manifest.cdn.mappedResources > 0, 'No resources match the verified CDN catalog');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error('Usage: node tools/rainyun-resource-cdn.mjs <verified-resource-cache.json> <catalog.json.gz>');
  const catalog = cdnCatalogFromManifest(JSON.parse(await readFile(source, 'utf8')));
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const body = gzipSync(JSON.stringify(catalog), { level: 9 });
  await writeFile(output, body);
  console.log(JSON.stringify({ output: path.resolve(output), uniqueContents: Object.keys(catalog.entries).length,
    catalogBytes: body.length, manifestId: catalog.manifestId }));
}
