import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import * as policy from '../public/js/resources/policy.js';
import { createResourceTransport } from '../public/js/resources/transport.js';
import { buildResourceManifest } from '../server/http/resourceManifest.js';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';
import { createStaticHandler } from '../server/http/static.js';
import http from 'node:http';

const code = (await readFile(new URL('../public/js/resources/worker.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const hash = body => createHash('sha256').update(body).digest('hex');

test('cache capacity follows the whole uncompressed asset package, including packages above 256 MiB', async () => {
  const totalBytes = 686 * 1048576 + 123;
  const manifest = { version: 1, entries: {}, aliases: {}, totalBytes };
  assert.equal(policy.resourceCacheLimit(manifest), 687 * 1048576);
  assert.equal(policy.resourceCacheLimit({ totalBytes: 1500 * 1048576 }), 1500 * 1048576);
  assert.equal(policy.resourceCacheLimit({ totalBytes: -1 }), policy.MAX_BYTES);
  const h = runtime({ manifest }); await h.ready();
  assert.equal((await h.message('status')).limit, 687 * 1048576);
});
function storage() {
  const stores = new Map(); let failPut = false;
  return {
    get failPut() { return failPut; }, set failPut(v) { failPut = v; },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name), key = v => typeof v === 'string' ? v : v.url;
      return {
        async keys() { return [...store.keys()].map(url => new Request(url)); },
        async match(req) { return store.get(key(req))?.clone(); },
        async put(req, response) { if (failPut && name === policy.CACHE_NAME) throw new Error('quota'); store.set(key(req), response.clone()); },
        async delete(req) { return store.delete(key(req)); },
      };
    },
    async delete(name) { return stores.delete(name); },
  };
}
function locks() {
  const tails = new Map();
  return { request(name, options, callback) {
    if (callback && options.ifAvailable && tails.has(name)) return Promise.resolve(callback(null));
    const fn = callback ? () => callback({ name }) : options;
    const tail = tails.get(name) ?? Promise.resolve(), next = tail.then(fn, fn);
    const done = next.catch(() => {}).finally(() => { if (tails.get(name) === done) tails.delete(name); });
    tails.set(name, done); return next;
  } };
}
function runtime({ id = 'a', caches = storage(), sharedLocks = locks(), bodies = {}, manifest = null, maxBytes = null,
  assetNetwork = async () => {}, manifestNetwork = async () => {}, routeNetwork = async () => {}, localOnly = false,
  hostname = 'game.test', noPreload = false } = {}) {
  const handlers = {}, counts = new Map(), modes = new Map();
  manifest ??= { version: 1, entries: Object.fromEntries(Object.entries(bodies).map(([url, body]) => [url, { hash: hash(body), bytes: Buffer.byteLength(body) }])), aliases: {} };
  const catalog = resourceRoutingCatalog(manifest);
  const network = async input => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const p = url.pathname.replace(/^\/_build\/[^/]+/, '');
    counts.set(p, (counts.get(p) || 0) + 1);
    modes.set(p, input.cache);
    if (p === '/data/resource-cache.json') { await manifestNetwork(); return Response.json(manifest); }
    if (p.startsWith('/data/resource-routes/')) {
      await routeNetwork(p);
      const value = catalog.get(p.slice('/data/resource-routes/'.length));
      return value ? Response.json(value) : new Response('not found', { status: 404 });
    }
    await assetNetwork(p);
    return new Response(bodies[p] ?? 'network', { headers: { 'content-type': p.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream' } });
  };
  const workerUrl = new URL(`https://${hostname}/_build/${id}/js/resources/worker.js`);
  if (localOnly) workerUrl.searchParams.set('localOnly','1');
  if (noPreload) workerUrl.searchParams.set('noPreload','1');
  const self = { location: workerUrl, skipWaiting() {}, clients: { async claim() {} }, addEventListener(name, fn) { handlers[name] = fn; } };
  vm.runInNewContext(code, { ...policy, MAX_BYTES: maxBytes ?? policy.MAX_BYTES, createResourceTransport, resourceCacheLimit: value => maxBytes ?? policy.resourceCacheLimit(value), self, navigator: { locks: sharedLocks }, caches, crypto: webcrypto, fetch: network, URL, Request, Response, Headers, AbortSignal, AbortController, TextEncoder, setTimeout, clearTimeout, Uint8Array, Date, Promise, Map, Error, Number, String });
  async function emit(name, extra = {}) {
    const waits = []; let response;
    handlers[name]({ ...extra, waitUntil(p) { waits.push(p); }, respondWith(p) { response = p; } });
    await Promise.all(waits); return response;
  }
  return {
    counts, caches, modes,
    ready: () => emit('install'),
    async get(p, headers, cache = 'default') { const request = new Request(`https://${hostname}/_build/${id}${p}`, { headers, cache }); return await emit('fetch', { request }) ?? network(request); },
    async message(action, extra = {}) { let reply; await emit('message', { data: { action, ...extra }, ports: [{ postMessage(v) { reply = v; } }] }); return reply; },
  };
}

test('8443 native and explicit no-preload workers refuse legacy bulk commands without metadata or asset downloads', async () => {
  for (const options of [{hostname:'weishuxieyiwangye.cn'}, {noPreload:true}]) {
    const h=runtime({...options,bodies:{'/assets/a.png':'present'}});
    const warm=await h.message('warm',{manual:true,concurrency:16,warmId:'old-page'});
    assert.equal(warm.networkPreloadAllowed,false);assert.equal(warm.preload.state,'disabled');
    assert.equal(warm.preload.downloadedBytes,0);
    assert.equal((await h.message('status')).preload.state,'disabled');
    assert.equal(h.counts.size,0,'not even the full resource catalogue is downloaded');
    const origin='https://'+(options.hostname||'game.test'),cache=await h.caches.open(policy.CACHE_NAME);
    await cache.put(origin+'/__sp_resource_content/'+hash('present'),new Response('present'));
    const response=await h.get('/assets/a.png');
    assert.equal(response.headers.get('x-sp-resource-cache'),'HIT');assert.equal(await response.text(),'present');
    assert.equal(h.counts.get('/assets/a.png'),undefined,'disabling bulk downloads retains existing cached bytes');
  }
});

test('local-only play reuses imported bytes with cache preference off and never redownloads missing media', async () => {
  const bodies = { '/assets/art.png': 'imported art', '/assets/audio/bgm/music.mp3': 'imported music' };
  const h = runtime({ bodies, localOnly: true });
  const cache = await h.caches.open(policy.CACHE_NAME);
  for (const [path, body] of Object.entries(bodies)) await cache.put('https://game.test/__sp_resource_content/'+hash(body), new Response(body));
  await h.message('enable', { enabled: false });
  for (const path of Object.keys(bodies)) {
    const response = await h.get(path);
    assert.equal(response.headers.get('x-sp-resource-cache'), 'HIT');
    assert.equal(await response.text(), bodies[path]);
    assert.equal(h.counts.get(path), undefined);
  }
  const invalidRange = await h.get('/assets/art.png', { range: 'bytes=0-1,3-4' });
  assert.equal(invalidRange.status, 416);
  assert.equal(h.counts.get('/assets/art.png'), undefined, 'invalid range never falls back to the server');
  const missing = await h.get('/assets/audio/bgm/missing.mp3');
  assert.equal(missing.headers.get('x-sp-resource-cache'), 'LOCAL-MISSING');
  assert.equal(missing.headers.get('content-type'), 'audio/wav');
  const wave = Buffer.from(await missing.arrayBuffer());
  assert.equal(wave.subarray(0,4).toString(), 'RIFF');
  assert.equal(wave.length, wave.readUInt32LE(4)+8);
  assert.equal(wave.subarray(44).every(byte=>byte===128), true);
  assert.equal(h.counts.get('/assets/audio/bgm/missing.mp3'), undefined);
  const art = await h.get('/assets/missing.png');
  assert.equal(art.status, 503);
  assert.equal(h.counts.get('/assets/missing.png'), undefined);
  await h.message('warm', {manual:true,concurrency:16});
  assert.equal(h.counts.get('/assets/art.png'), undefined);
  const ready = await h.message('local-ready');
  assert.equal(ready.localOnly,true);
  assert.equal(ready.localMisses,2);
});

test('local-only metadata/storage failure cannot silently turn into an asset download', async () => {
  const broken = runtime({localOnly:true,routeNetwork:async()=>{throw Error('metadata offline')}});
  assert.equal((await broken.get('/assets/a.png')).status,503);
  assert.equal(broken.counts.get('/assets/a.png'),undefined);
  const cacheDenied=storage();cacheDenied.open=async()=>{throw Error('storage unavailable')};
  const h=runtime({localOnly:true,caches:cacheDenied,bodies:{'/assets/a.png':'not cached'}});
  assert.equal((await h.get('/assets/a.png')).status,503);
  assert.equal(h.counts.get('/assets/a.png'),undefined);
});

test('same art is downloaded once and reused after a hot generation change; changed art downloads again', async () => {
  const caches = storage(), sharedLocks = locks();
  const a = runtime({ caches, sharedLocks, bodies: { '/assets/a.png': 'original' } });
  await a.ready(); assert.equal(await (await a.get('/assets/a.png')).text(), 'original');
  await a.get('/assets/a.png'); assert.equal(a.counts.get('/assets/a.png'), 1);
  const b = runtime({ id: 'b', caches, sharedLocks, bodies: { '/assets/a.png': 'original' } });
  await b.ready(); assert.equal(await (await b.get('/assets/a.png')).text(), 'original');
  assert.equal(b.counts.get('/assets/a.png'), undefined, 'zero asset requests in the new generation');
  const changed = runtime({ id: 'c', caches, sharedLocks, bodies: { '/assets/a.png': 'updated' } });
  await changed.ready(); assert.equal(await (await changed.get('/assets/a.png')).text(), 'updated');
  assert.equal(await (await a.get('/assets/a.png')).text(), 'original', 'old game keeps its old content');
  assert.equal((await changed.message('status')).files, 2);
});

test('cold activation, status and play never download the full catalog, even when it would never finish', async () => {
  const body = 'cdn-map', digest = hash(body), cdnPath = '/pilot/content/' + digest + '.png';
  const h = runtime({ bodies: { [cdnPath]: body }, manifestNetwork: () => new Promise(() => {}),
    manifest: { version: 1, entries: { '/assets/maps/a.png': { hash: digest, bytes: body.length, cdn: 'https://assets.weishuxieyi.icu' + cdnPath } }, aliases: {} } });
  await h.ready();
  assert.equal((await h.message('status')).preload.total, 1);
  const response = await h.get('/assets/maps/a.png');
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get('x-sp-resource-source'), 'r2');
  assert.equal(h.counts.get('/data/resource-cache.json'), undefined);
  assert.equal(h.counts.get('/assets/maps/a.png'), undefined);
});

test('concurrent model files coalesce one directory lookup and retry failed metadata', async () => {
  let failures = 1;
  const bodies = { '/assets/model/a.skel': 'skeleton', '/assets/model/a.atlas': 'atlas' };
  const h = runtime({ bodies, routeNetwork: async p => {
    if (!p.endsWith('/index.json') && failures-- > 0) throw new Error('temporary metadata error');
  } });
  await h.ready();
  assert.equal(await (await h.get('/assets/model/a.skel')).text(), 'skeleton');
  await Promise.all([h.get('/assets/model/a.skel'), h.get('/assets/model/a.atlas')]);
  const key = [...h.counts.keys()].find(p => p.startsWith('/data/resource-routes/') && !p.endsWith('/index.json'));
  assert.equal(h.counts.get(key), 2);
});

test('browsers without Web Locks still use CDN and audio ranges without persistent caching', async () => {
  const body = '0123456789', digest = hash(body), cdnPath = '/pilot/content/' + digest + '.mp3';
  const h = runtime({ sharedLocks: null, bodies: { [cdnPath]: body }, manifest: {
    version: 1, entries: { '/assets/audio/a.mp3': { hash: digest, bytes: body.length, cdn: 'https://assets.weishuxieyi.icu' + cdnPath } }, aliases: { '/media/a': '/assets/audio/a.mp3' },
  } });
  await h.ready();
  const response = await h.get('/media/a', { range: 'bytes=2-5' });
  assert.equal(response.status, 206); assert.equal(await response.text(), '2345');
  assert.equal(response.headers.get('x-sp-resource-source'), 'r2');
  const status = await h.message('status');
  assert.equal(status.files, 0); assert.equal(status.cdn.downloads, 1);
  assert.equal(h.counts.get('/media/a'), undefined);
});

test('denied browser storage does not send an otherwise valid CDN resource back to the origin', async () => {
  const body = 'public-art', digest = hash(body), cdnPath = '/pilot/content/' + digest + '.png';
  const h = runtime({ caches: { async open() { throw new Error('storage denied'); } }, bodies: { [cdnPath]: body },
    manifest: { version: 1, entries: { '/assets/a.png': { hash: digest, bytes: body.length, cdn: 'https://assets.weishuxieyi.icu' + cdnPath } } } });
  await h.ready(); const response = await h.get('/assets/a.png');
  assert.equal(await response.text(), body); assert.equal(response.headers.get('x-sp-resource-source'), 'r2');
  assert.equal(h.counts.get('/assets/a.png'), undefined);
});

test('range audio is cached once, then valid ranges, suffixes and unsatisfiable ranges are handled locally', async () => {
  const h = runtime({ bodies: { '/assets/audio/test.mp3': '0123456789' } }); await h.ready();
  const first = await h.get('/assets/audio/test.mp3', { range: 'bytes=2-5' });
  assert.equal(first.status, 206); assert.equal(await first.text(), '2345');
  assert.equal(first.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await (await h.get('/assets/audio/test.mp3', { range: 'bytes=-3' })).text(), '789');
  assert.equal((await h.get('/assets/audio/test.mp3', { range: 'bytes=99-' })).status, 416);
  assert.equal(h.counts.get('/assets/audio/test.mp3'), 1);
});

test('identical content at different asset URLs stores one file and concurrent requests download once', async () => {
  const caches = storage(), sharedLocks = locks();
  const bodies = { '/assets/a.png': 'same-content', '/assets/copy.png': 'same-content' };
  const a = runtime({ caches, sharedLocks, bodies }); await a.ready();
  const replies = await Promise.all([a.get('/assets/a.png'), a.get('/assets/copy.png'), a.get('/assets/a.png')]);
  for (const reply of replies) assert.equal(await reply.text(), 'same-content');
  assert.equal((a.counts.get('/assets/a.png') || 0) + (a.counts.get('/assets/copy.png') || 0), 1);
  assert.equal((await a.message('status')).files, 1);
  const b = runtime({ id: 'next', caches, sharedLocks, bodies }); await b.ready();
  assert.equal(await (await b.get('/assets/copy.png')).text(), 'same-content');
  assert.equal(b.counts.get('/assets/copy.png'), undefined, 'new release reuses cached content');
  assert.equal((await b.message('status')).files, 1);
});

test('explicit warm downloads one missing hash per batch, skips existing art and survives release changes', async () => {
  const caches = storage(), sharedLocks = locks();
  const bodies = { '/assets/a.png': 'a', '/assets/copy.png': 'a', '/assets/b.png': 'bb', '/assets/audio/a.mp3': 'ccc' };
  const a = runtime({ caches, sharedLocks, bodies }); await a.ready();
  await a.get('/assets/a.png');
  const first = await a.message('warm', { manual: true });
  assert.equal(first.preload.total, 3);
  assert.equal(first.preload.completed, 2);
  assert.equal(first.preload.completedBytes, 3);
  assert.equal(first.preload.totalBytes, 6);
  assert.equal(a.counts.get('/assets/copy.png'), undefined);
  assert.equal(a.counts.get('/assets/b.png'), 1);
  assert.equal(a.counts.get('/assets/audio/a.mp3'), undefined);
  await a.message('warm', { manual: true });
  assert.equal((await a.message('warm', { manual: true })).preload.state, 'complete');
  assert.equal((await a.message('status')).files, 3);
  await a.get('/assets/audio/a.mp3'); assert.equal(a.counts.get('/assets/audio/a.mp3'), 1);
  const b = runtime({ id: 'next', caches, sharedLocks, bodies }); await b.ready();
  assert.equal((await b.message('warm', { manual: true })).preload.state, 'complete');
  assert.equal((await b.message('status')).preload.completedBytes, 6);
  assert.equal([...b.counts.keys()].filter(x => x.startsWith('/assets/')).length, 0);
  await b.message('clear');
  assert.equal((await b.message('status')).preload.completedBytes, 0);
  assert.equal((await b.message('warm', { manual: true })).preload.completed, 1);
});

test('warm stops when storage cannot persist data or cache is disabled', async () => {
  const h = runtime({ bodies: { '/assets/a.png': 'a', '/assets/b.png': 'b' } }); await h.ready();
  await h.message('enable', { enabled: false });
  assert.equal((await h.message('warm', { manual: true })).preload.state, 'disabled');
  assert.equal(h.counts.get('/assets/a.png'), undefined);
  await h.message('enable', { enabled: true }); h.caches.failPut = true;
  const result = await h.message('warm', { manual: true });
  assert.equal(result.preload.state, 'retry'); assert.equal(result.preload.completed, 0);
  assert.equal(h.counts.get('/assets/b.png'), undefined);
});

test('lobby warm batches allow sixteen hashes concurrently and do not overlap across tabs', async () => {
  let active = 0, peak = 0, release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const slotsStarted = new Promise(resolve => { started = resolve; });
  const bodies = Object.fromEntries(Array.from({ length: 22 }, (_, n) => [`/assets/${n}.png`, `unique-${String(n).padStart(2, '0')}`]));
  const caches = storage(), sharedLocks = locks();
  const a = runtime({ caches, sharedLocks, bodies, assetNetwork: async () => {
    active++; peak = Math.max(peak, active);
    if (active === 16) started();
    await gate; active--;
  } });
  const b = runtime({ id: 'other-tab', caches, sharedLocks, bodies });
  await a.ready(); await b.ready();
  const batch = a.message('warm', { manual: true, concurrency: 999 });
  await slotsStarted;
  await b.message('warm', { manual: true, concurrency: 4 });
  assert.equal([...b.counts.keys()].filter(p => p.startsWith('/assets/')).length, 0);
  release();
  const first = await batch;
  assert.equal(peak, 16); assert.equal(first.preload.completed, 16);
  assert.equal(first.preload.downloadedBytes, 16 * 'unique-00'.length);
  assert.equal(first.preload.state, 'loading');
  const next = await a.message('warm', { manual: true, concurrency: 16 });
  assert.equal(next.preload.state, 'complete'); assert.equal(next.preload.completed, 22);
  for (const path of Object.keys(bodies)) assert.equal(a.counts.get(path), 1);
});

test('failed parallel preload retries only the missing file and preserves successful batch members', async () => {
  let failed = true;
  const bodies = { '/assets/a.png': 'aa', '/assets/b.png': 'bb', '/assets/c.png': 'cc', '/assets/d.png': 'dd' };
  const h = runtime({ bodies, assetNetwork: async path => {
    if (failed && path === '/assets/b.png') throw new Error('temporary network failure');
  } });
  await h.ready();
  const first = await h.message('warm', { manual: true, concurrency: 4 });
  assert.equal(first.preload.state, 'retry'); assert.equal(first.preload.completed, 3);
  failed = false;
  const next = await h.message('warm', { manual: true, concurrency: 4 });
  assert.equal(next.preload.state, 'complete'); assert.equal(next.preload.completed, 4);
  assert.equal(h.counts.get('/assets/b.png'), 2);
  for (const path of ['/assets/a.png', '/assets/c.png', '/assets/d.png']) assert.equal(h.counts.get(path), 1);
});

test('continuous preload refills slots while an earlier slow file is still downloading', async () => {
  let releaseSlow, slotRefilled, slowDone = false, active = 0, peak = 0;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const refill = new Promise(resolve => { slotRefilled = resolve; });
  const bodies = Object.fromEntries(Array.from({ length: 48 }, (_, n) => [`/assets/${String(n).padStart(3, '0')}.png`, `art-${String(n).padStart(3, '0')}`]));
  const h = runtime({ bodies, assetNetwork: async p => {
    active++; peak = Math.max(peak, active);
    if (p === '/assets/000.png') { await slow; slowDone = true; }
    if (p === '/assets/016.png') slotRefilled();
    active--;
  } });
  await h.ready();
  const work = h.message('warm', { manual: true, concurrency: 16, warmId: 'refill-test' });
  await refill;
  assert.equal(slowDone, false, 'file 17 starts without waiting for file 1');
  releaseSlow();
  const result = await work;
  assert.equal(result.preload.state, 'complete'); assert.equal(result.preload.completed, 48);
  assert.ok(peak <= 16);
  for (const p of Object.keys(bodies)) assert.equal(h.counts.get(p), 1);
});

test('pause stops queue refill, keeps in-flight saves and resumes only missing files with a fresh ticket', async () => {
  let release, slotsReady, active = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { slotsReady = resolve; });
  const bodies = Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`/assets/${String(n).padStart(3, '0')}.png`, `art-${String(n).padStart(3, '0')}`]));
  const h = runtime({ bodies, assetNetwork: async () => {
    active++; if (active === 16) slotsReady(); await gate; active--;
  } });
  await h.ready();
  const work = h.message('warm', { manual: true, concurrency: 16, warmId: 'pause-test' });
  await started;
  await h.message('warm.stop', { warmId: 'another-tab-ticket' });
  await h.message('warm.stop', { warmId: 'pause-test' });
  release();
  const paused = await work;
  assert.equal(paused.preload.state, 'paused'); assert.equal(paused.preload.completed, 16);
  assert.equal([...h.counts.keys()].filter(p => p.startsWith('/assets/')).length, 16);
  const resumed = await h.message('warm', { manual: true, concurrency: 16, warmId: 'resume-test' });
  assert.equal(resumed.preload.state, 'complete'); assert.equal(resumed.preload.completed, 40);
  for (const p of Object.keys(bodies)) assert.equal(h.counts.get(p), 1);
});

test('continuous windows stay bounded and do not rescan successful files on the next message', async () => {
  const bodies = Object.fromEntries(Array.from({ length: 140 }, (_, n) => [`/assets/${String(n).padStart(3, '0')}.png`, `art-${String(n).padStart(3, '0')}`]));
  const h = runtime({ bodies }); await h.ready();
  const first = await h.message('warm', { manual: true, concurrency: 16, warmId: 'bounded-first' });
  assert.equal(first.preload.completed, 128); assert.equal(first.preload.state, 'loading');
  const second = await h.message('warm', { manual: true, concurrency: 16, warmId: 'bounded-second' });
  assert.equal(second.preload.completed, 140); assert.equal(second.preload.state, 'complete');
  for (const p of Object.keys(bodies)) assert.equal(h.counts.get(p), 1);
});

test('clearing during continuous preload does not let the old queue overwrite the new cache plan', async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const first = new Promise(resolve => { started = resolve; });
  const bodies = Object.fromEntries(Array.from({ length: 24 }, (_, n) => [`/assets/${String(n).padStart(3, '0')}.png`, `art-${String(n).padStart(3, '0')}`]));
  const h = runtime({ bodies, assetNetwork: async () => { started(); await gate; } });
  await h.ready();
  const work = h.message('warm', { manual: true, concurrency: 16, warmId: 'clear-old' });
  await first; await h.message('clear'); release(); await work;
  const result = await h.message('warm', { manual: true, concurrency: 16, warmId: 'clear-new' });
  assert.equal(result.preload.completed, 24); assert.equal(result.preload.state, 'complete');
});

test('scripts, APIs, JSON, navigation, other generations and foreign origins never enter the resource cache', async () => {
  const h = runtime({ bodies: { '/js/main.js': 'code', '/data/chess.json': 'data', '/healthz': 'health' } }); await h.ready();
  for (const p of ['/js/main.js', '/data/chess.json', '/healthz', '/ws', '/']) { await h.get(p); await h.get(p); assert.equal(h.counts.get(p), 2); }
  assert.equal((await h.message('status')).files, 0);
  const manifest = { entries: { '/assets/a.png': { hash: hash('a'), bytes: 1 } } };
  assert.equal(policy.resourceEntry(new Request('https://other.test/_build/a/assets/a.png'), 'https://game.test/_build/a/', manifest), null);
  assert.equal(policy.resourceEntry(new Request('https://game.test/_build/b/assets/a.png'), 'https://game.test/_build/a/', manifest), null);
});

test('disable is shared by generations; clear removes only game art; storage failure falls back to network', async () => {
  const caches = storage(), sharedLocks = locks();
  await (await caches.open('unrelated-user-cache')).put('https://game.test/other', new Response('keep'));
  const h = runtime({ caches, sharedLocks, bodies: { '/assets/a.png': 'a' } }); await h.ready(); await h.get('/assets/a.png');
  await h.message('enable', { enabled: false }); await h.get('/assets/a.png');
  assert.equal(h.counts.get('/assets/a.png'), 2);
  const b = runtime({ id: 'b', caches, sharedLocks, bodies: { '/assets/a.png': 'a' } }); await b.ready(); await b.get('/assets/a.png');
  assert.equal(b.counts.get('/assets/a.png'), 1);
  assert.equal((await h.message('clear')).files, 0);
  assert.equal(await (await (await caches.open('unrelated-user-cache')).match('https://game.test/other')).text(), 'keep');
  await h.message('enable', { enabled: true }); caches.failPut = true;
  assert.equal(await (await h.get('/assets/a.png')).text(), 'a');
  assert.equal((await h.message('status')).files, 0);
});

test('hash mismatch is never saved; bounded cache evicts oldest art and concurrent requests coalesce', async () => {
  const wrong = runtime({ bodies: { '/assets/a.png': 'wrong' }, manifest: { version: 1, entries: { '/assets/a.png': { hash: hash('right'), bytes: 5 } } } });
  await wrong.ready(); await wrong.get('/assets/a.png'); assert.equal((await wrong.message('status')).files, 0);
  const h = runtime({ bodies: { '/assets/a.png': '1234', '/assets/b.png': '5678' }, maxBytes: 6 }); await h.ready();
  await Promise.all([h.get('/assets/a.png'), h.get('/assets/a.png')]);
  assert.equal(h.counts.get('/assets/a.png'), 1);
  await h.get('/assets/b.png'); const status = await h.message('status');
  assert.equal(status.bytes, 4); assert.equal(status.files, 1);
  await h.get('/assets/a.png'); assert.equal(h.counts.get('/assets/a.png'), 2);
});

test('manifest hashes eligible public art only, supplies audio aliases, and HTTP gzip / worker scope headers work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-resource-test-'));
  await mkdir(path.join(root, 'assets/audio'), { recursive: true }); await mkdir(path.join(root, 'js/resources'), { recursive: true });
  await writeFile(path.join(root, 'assets/audio/a.mp3'), 'audio'); await writeFile(path.join(root, 'assets/code.js'), 'secret');
  await writeFile(path.join(root, 'assets/meta.json'), '{}'); await writeFile(path.join(root, 'js/resources/worker.js'), '/* worker */');
  const manifest = await buildResourceManifest(root);
  assert.equal(manifest.count, 1); assert.equal(manifest.aliases['/media/a'], '/assets/audio/a.mp3');
  assert.equal(manifest.entries['/assets/audio/a.mp3'].hash, hash('audio'));
  const serve = createStaticHandler({ publicDir: root, dataDir: root, sharedDir: root });
  const server = http.createServer((req, res) => serve(req, res, req.url.split('?')[0], ''));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(origin + '/data/resource-cache.json', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(response.headers.get('content-encoding'), 'gzip'); assert.equal((await response.json()).count, 1);
    assert.equal((await fetch(origin + '/data/resource-cache.json', { headers: { 'if-none-match': response.headers.get('etag') } })).status, 304);
    assert.equal((await fetch(origin + '/js/resources/worker.js')).headers.get('service-worker-allowed'), '/');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('r11 automatic warm messages pause without downloading, while game requests still cache', async () => {
  const h = runtime({ bodies: { '/assets/a.png': 'a' } }); await h.ready();
  const result = await h.message('warm');
  assert.equal(result.preload.state, 'paused');
  assert.equal(h.counts.get('/assets/a.png'), undefined);
  await h.get('/assets/a.png'); await h.get('/assets/a.png');
  assert.equal(h.counts.get('/assets/a.png'), 1);
  assert.equal((await h.message('status')).files, 1);
});

test('versioned static JSON reuses HTTP cache for legacy loaders without caching live APIs', async () => {
  const h = runtime(); await h.ready();
  await h.get('/data/chess.json', {}, 'no-cache');
  assert.equal(h.modes.get('/data/chess.json'), 'default');
  await h.get('/data/chess.json', {}, 'reload');
  assert.equal(h.modes.get('/data/chess.json'), 'reload');
  await h.get('/healthz', {}, 'no-cache');
  assert.equal(h.modes.get('/healthz'), 'no-cache');
  assert.equal((await h.message('status')).files, 0);
});

test('R2 downloads enter the shared hash cache and a later release makes no media request', async () => {
  const body='r2-operator-art', digest=hash(body), cdnPath='/pilot/content/'+digest+'.png';
  const manifest={version:1,entries:{'/assets/a.png':{hash:digest,bytes:body.length,cdn:'https://assets.weishuxieyi.icu'+cdnPath}},aliases:{}};
  const caches=storage(),sharedLocks=locks();
  const a=runtime({caches,sharedLocks,manifest,bodies:{[cdnPath]:body}});await a.ready();
  const first=await a.get('/assets/a.png');assert.equal(await first.text(),body);
  assert.equal(first.headers.get('x-sp-resource-source'),'r2');assert.equal(a.counts.get('/assets/a.png'),undefined);
  assert.equal(a.counts.get(cdnPath),1);
  const b=runtime({id:'next',caches,sharedLocks,manifest});await b.ready();
  assert.equal((await b.get('/assets/a.png')).headers.get('x-sp-resource-cache'),'HIT');
  assert.equal(b.counts.get('/assets/a.png'),undefined);assert.equal(b.counts.get(cdnPath),undefined);
});

test('disabling local cache still uses R2, and range audio is synthesized from verified CDN bytes', async () => {
  const body='0123456789', digest=hash(body), cdnPath='/pilot/content/'+digest+'.mp3';
  const manifest={version:1,entries:{'/assets/audio/a.mp3':{hash:digest,bytes:body.length,cdn:'https://assets.weishuxieyi.icu'+cdnPath}},aliases:{'/media/a':'/assets/audio/a.mp3'}};
  const h=runtime({manifest,bodies:{[cdnPath]:body}});await h.ready();await h.message('enable',{enabled:false});
  const response=await h.get('/media/a',{range:'bytes=2-5'});
  assert.equal(response.status,206);assert.equal(await response.text(),'2345');
  await h.get('/media/a');assert.equal(h.counts.get(cdnPath),2);assert.equal((await h.message('status')).files,0);
});

test('invalid R2 bytes fall back to Tencent and cannot poison the content cache', async () => {
  const body='correct-original',digest=hash(body),cdnPath='/pilot/content/'+digest+'.png';
  const manifest={version:1,entries:{'/assets/a.png':{hash:digest,bytes:body.length,cdn:'https://assets.weishuxieyi.icu'+cdnPath}},aliases:{}};
  const h=runtime({manifest,bodies:{[cdnPath]:'corrupt-r2', '/assets/a.png':body}});await h.ready();
  const result=await h.get('/assets/a.png');assert.equal(await result.text(),body);
  assert.equal(result.headers.get('x-sp-resource-source'),'tencent');
  const cache=await h.caches.open(policy.CACHE_NAME),saved=await cache.match('https://game.test/__sp_resource_content/'+digest);
  assert.equal(await saved.text(),body);assert.equal((await h.message('status')).cdn.failures,1);
});
