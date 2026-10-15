import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';
import { resourceManifestLoader } from '../server/http/resourceManifest.js';
import { createStaticHandler } from '../server/http/static.js';
import { writeResourceRoutes } from '../tools/build-resource-routes.mjs';

const key = directory => createHash('sha256').update(directory).digest('hex') + '.json';
const item = { hash: createHash('sha256').update('art').digest('hex'), bytes: 3,
  cdn: 'https://assets.weishuxieyi.icu/pilot/content/a.png' };
const manifest = { version: 1, count: 3, totalBytes: 9, entries: {
  '/assets/model/a.png': item, '/assets/model/a.skel': item, '/assets/audio/a.mp3': item,
}, aliases: { '/media/a': '/assets/audio/a.mp3' } };

test('directory shards preserve CDN identities and audio aliases with a small unique-content summary', () => {
  const catalog = resourceRoutingCatalog(manifest);
  assert.deepEqual(Object.keys(catalog.get(key('/assets/model')).entries), ['/assets/model/a.png', '/assets/model/a.skel']);
  assert.deepEqual(catalog.get(key('/media')).aliases, manifest.aliases);
  assert.deepEqual(catalog.get(key('/media')).entries['/assets/audio/a.mp3'], item);
  assert.deepEqual(catalog.get('index.json').preload, { total: 1, totalBytes: 3 });
  assert.ok(Buffer.byteLength(JSON.stringify(catalog.get('index.json'))) < 256);
});

test('static-host artifacts include the tiny index and gzip counterparts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-route-artifacts-'));
  try {
    const result = await writeResourceRoutes(manifest, root);
    assert.equal(result.files, 4);
    const plain = await readFile(path.join(root, key('/assets/model')));
    assert.deepEqual(gunzipSync(await readFile(path.join(root, key('/assets/model') + '.gz'))), plain);
    assert.equal(JSON.parse(plain).entries['/assets/model/a.png'].cdn, item.cdn);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('R2 release binding also writes directory routing artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-route-binding-'));
  try {
    const source = path.join(root, 'source.json'), uploaded = path.join(root, 'uploaded.json');
    const output = path.join(root, 'data/resource-cache.json');
    await writeFile(source, JSON.stringify(manifest));
    await writeFile(uploaded, JSON.stringify({ version: 1, base: 'https://assets.weishuxieyi.icu/', id: 'b'.repeat(64),
      entries: Object.entries(manifest.entries).map(([pathname, value]) => ({ path: pathname, hash: value.hash, bytes: value.bytes,
        key: 'pilot/content/' + value.hash + '.png' })) }));
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../tools/build-r2-resource-manifest.mjs', import.meta.url)), source, uploaded, output]);
    const routes = JSON.parse(await readFile(path.join(root, 'data/resource-routes', key('/assets/model')), 'utf8'));
    assert.equal(routes.entries['/assets/model/a.png'].cdn, 'https://assets.weishuxieyi.icu/pilot/content/' + item.hash + '.png');
    const index = JSON.parse(await readFile(path.join(root, 'data/resource-routes/index.json'), 'utf8'));
    assert.equal(index.preload.total, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP directory routes use the prebuilt CDN manifest without scanning installed art', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-route-http-'));
  let server;
  try {
    await mkdir(path.join(root, 'data'));
    await writeFile(path.join(root, 'data/resource-cache.json'), JSON.stringify(manifest));
    assert.deepEqual(await resourceManifestLoader(root)(), manifest);
    const serve = createStaticHandler({ publicDir: root, dataDir: root, sharedDir: root });
    server = http.createServer((req, res) => serve(req, res, req.url.split('?')[0], ''));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/data/resource-routes/`;
    const index = await (await fetch(base + 'index.json')).json();
    assert.equal(index.count, 3); assert.equal(index.entries, undefined);
    const response = await fetch(base + key('/assets/model'), { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal((await response.json()).entries['/assets/model/a.png'].cdn, item.cdn);
    assert.equal((await fetch(base + key('/assets/model'), { headers: { 'if-none-match': response.headers.get('etag') } })).status, 304);
    const head = await fetch(base + key('/assets/model'), { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(base + key('/assets/missing'))).status, 404);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('a corrupt prebuilt manifest is not silently replaced with non-CDN identities', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-route-invalid-'));
  try {
    await mkdir(path.join(root, 'data'));
    await writeFile(path.join(root, 'data/resource-cache.json'), JSON.stringify({ version: 2, entries: {} }));
    await assert.rejects(resourceManifestLoader(root)(), /Invalid resource manifest/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CDN worker registration is independent of Web Locks and persistent cache support', async () => {
  const source = (await readFile(new URL('../public/js/resources/client.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/^export /gm, '');
  let registered = 0;
  const context = { isSecureContext: true, crypto: { subtle: {} }, URL, isBundledClient:()=>false,
    navigator: { serviceWorker: { register() { registered++; return Promise.resolve({ active: {} }); } } } };
  const runtime = vm.createContext(context);
  vm.runInContext(source.replace(/import\.meta\.url/g, JSON.stringify('https://game.test/_build/a/js/resources/client.js')), runtime);
  assert.equal(vm.runInContext('cacheSupported()', runtime), false);
  await vm.runInContext('startResourceCache()', runtime);
  assert.equal(registered, 1);
});
