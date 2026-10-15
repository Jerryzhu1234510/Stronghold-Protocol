import '../ui/compat.js';
import { CACHE_NAME, META_NAME, MAX_BYTES, MANUAL_PRELOAD_BATCH_FILES, MANUAL_PRELOAD_WINDOW_MS, preloadConcurrency, resourceCacheLimit, resourcePath, resourceEntry, rangeResponse, warmResources } from './policy.js';
import { createResourceTransport } from './transport.js';

const base = new URL('../../', self.location.href);
const prefKey = new URL('/__sp_resource_preference', base.origin).href;
const sizeKey = new URL('/__sp_resource_size', base.origin).href;
const epochKey = new URL('/__sp_resource_epoch', base.origin).href;
const lockName = 'sp-resource-write-v1';
let manifest = null, manifestPending = null, retryAt = 0;
let index = null, indexPending = null;
const routes = new Map();
const storageAvailable = () => !!(globalThis.caches && navigator.locks?.request);
let hits = 0, savedBytes = 0;
let cacheBudget = MAX_BYTES;
const inflight = new Map();
const transport = createResourceTransport({ fetchImpl: request => fetch(request) });
let warmPlan = null, warmCursor = 0, warmComplete = 0;
let warmState = 'waiting';
let warmBytes = 0;
const cancelledWarm = new Map();
function stopWarm(id) {
  if (typeof id !== 'string' || id.length > 128) return;
  const now = Date.now();
  for (const [key, at] of cancelledWarm) if (now - at > 60000) cancelledWarm.delete(key);
  cancelledWarm.set(id, now);
  if (cancelledWarm.size > 128) cancelledWarm.delete(cancelledWarm.keys().next().value);
}
async function loadManifest() {
  if (manifest) return manifest;
  if (Date.now() < retryAt) return null;
  return manifestPending ??= fetch(new URL('data/resource-cache.json', base), { cache: 'no-cache' })
    .then(async response => {
      if (!response.ok) throw new Error('Resource manifest unavailable');
      const value = await response.json();
      if (value.version !== 1 || !value.entries || typeof value.entries !== 'object') throw new Error('Invalid resource manifest');
      cacheBudget = resourceCacheLimit(value);
      return manifest = value;
    }).catch(() => { retryAt = Date.now() + 30000; return null; }).finally(() => { manifestPending = null; });
}
async function loadIndex() {
  if (index) return index;
  return indexPending ??= routingDocument(new URL('data/resource-routes/index.json', base))
    .then(value => {
      if (value.version !== 1) throw new Error('Invalid resource index');
      cacheBudget = resourceCacheLimit(value);
      return index = value;
    }).catch(() => null).finally(() => { indexPending = null; });
}
async function routingDocument(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { cache: 'default', signal: controller.signal });
    if (!response.ok) throw new Error('Resource directory unavailable');
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function routeFor(request) {
  if (manifest) return resourceEntry(request, base, manifest);
  const pathname = resourcePath(request, base);
  if (!pathname) return null;
  const directory = pathname.slice(0, pathname.lastIndexOf('/'));
  if (!routes.has(directory)) {
    const pending = (async () => {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(directory)))].map(n => n.toString(16).padStart(2, '0')).join('');
      const value = await routingDocument(new URL('data/resource-routes/' + hash + '.json', base));
      if (value.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('Invalid resource directory');
      return value;
    })().catch(() => { routes.delete(directory); return null; });
    routes.set(directory, pending);
  }
  return resourceEntry(request, base, await routes.get(directory));
}
async function enabled() {
  const pref = await (await caches.open(META_NAME)).match(prefKey);
  return !pref || await pref.text() !== 'off';
}
const cacheKey = item => new URL('/__sp_resource_content/' + item.hash, base.origin).href;
async function summary() {
  const meta = await caches.open(META_NAME), stored = await meta.match(sizeKey);
  if (stored) return stored.json();
  const cache = await caches.open(CACHE_NAME), keys = await cache.keys();
  let bytes = 0;
  for (const key of keys) bytes += Number((await cache.match(key))?.headers.get('x-sp-resource-bytes')) || 0;
  const value = { files: keys.length, bytes };
  await meta.put(sizeKey, new Response(JSON.stringify(value)));
  return value;
}
async function epoch() { return (await (await caches.open(META_NAME)).match(epochKey))?.text() ?? '0'; }
async function stats() {
  const metadata = await loadIndex();
  if (!storageAvailable()) return { enabled: false, files: 0, bytes: 0, hits, savedBytes, limit: cacheBudget, cdn: transport.status(),
    preload: { state: 'disabled', completed: 0, total: metadata?.preload?.total ?? 0, totalBytes: metadata?.preload?.totalBytes ?? 0, completedBytes: 0, downloadedBytes: 0 } };
  const value = manifest;
  if (value) warmPlan ??= warmResources(value);
  const present = new Set((await (await caches.open(CACHE_NAME)).keys()).map(key => key.url));
  warmComplete = warmPlan?.filter(([, item]) => present.has(cacheKey(item))).length ?? 0;
  const totalBytes = warmPlan?.reduce((n, [, item]) => n + item.bytes, 0) ?? metadata?.preload?.totalBytes ?? 0;
  const completedBytes = warmPlan?.reduce((n, [, item]) => n + (present.has(cacheKey(item)) ? item.bytes : 0), 0) ?? 0;
  if (warmPlan?.length && warmComplete === warmPlan.length) warmState = 'complete';
  else if (warmState === 'complete') { warmState = 'waiting'; warmCursor = 0; }
  return navigator.locks.request(lockName, async () => ({ enabled: await enabled(), ...await summary(), hits, savedBytes, limit: cacheBudget, cdn: transport.status(),
    preload: { state: warmState, completed: warmComplete, total: warmPlan?.length ?? metadata?.preload?.total ?? 0, totalBytes, completedBytes, downloadedBytes: warmBytes } }));
}
async function save(key, response, bytes, generation) {
  return navigator.locks.request(lockName, async () => {
    if (!await enabled() || await epoch() !== generation) return;
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match(key)) return;
    const value = await summary(), meta = await caches.open(META_NAME);
    if (value.bytes + bytes > cacheBudget) {
      for (const k of await cache.keys()) {
        const n = Number((await cache.match(k))?.headers.get('x-sp-resource-bytes')) || 0;
        if (await cache.delete(k)) { value.bytes -= n; value.files--; }
        if (value.bytes + bytes <= cacheBudget) break;
      }
    }
    try {
      await cache.put(key, response);
      value.bytes += bytes; value.files++;
      await meta.put(sizeKey, new Response(JSON.stringify(value)));
    } catch (error) {
      await cache.delete(key); await meta.delete(sizeKey);
      throw error;
    }
  });
}
async function fullResponse(request, item, useCache = true) {
  useCache = useCache && storageAvailable();
  const key = cacheKey(item);
  let cached = null;
  if (useCache) try { cached = await (await caches.open(CACHE_NAME)).match(key); } catch { useCache = false; }
  if (cached) {
    const headers = new Headers(cached.headers); headers.set('x-sp-resource-cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }
  if (!inflight.has(key)) {
    const promise = (async () => {
      let generation = null;
      if (useCache) try { generation = await epoch(); } catch { useCache = false; }
      const headers = new Headers(request.headers); headers.delete('range'); headers.delete('if-range');
      const { response, verified } = await transport.fetch(new Request(request, { headers }), item);
      if (!response.ok || response.status !== 200 || response.type === 'opaque') return response;
      const body = await response.clone().arrayBuffer();
      if (!verified) {
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (body.byteLength !== item.bytes || digest !== item.hash) return response;
      }
      const cleanHeaders = new Headers(response.headers);
      cleanHeaders.delete('content-encoding'); cleanHeaders.set('content-length', String(body.byteLength));
      cleanHeaders.set('x-sp-resource-bytes', String(body.byteLength));
      if (!verified) cleanHeaders.set('x-sp-resource-source', 'tencent');
      const clean = new Response(body, { status: 200, headers: cleanHeaders });
      if (useCache) try { await save(key, clean.clone(), body.byteLength, generation); } catch { /* storage denied/full: play from the network */ }
      return clean;
    })().finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return (await inflight.get(key)).clone();
}
async function serve(request, item) {
  try {
    const response = await fullResponse(request, item, storageAvailable() && await enabled().catch(() => false));
    const result = await rangeResponse(request, response);
    if (!result) return fetch(request);
    if (result.headers.get('x-sp-resource-cache') === 'HIT') {
      hits++; savedBytes += Number(result.headers.get('content-length')) || 0;
    }
    return result;
  } catch { return fetch(request); }
}
async function warmOne(concurrency = 1, warmId = null) {
  if (!storageAvailable() || !await enabled()) { warmState = 'disabled'; return; }
  const value = await loadManifest();
  if (!value) { warmState = 'retry'; return; }
  // Only one tab/release may pre-download at a time; actual play requests still have priority.
  await navigator.locks.request('sp-resource-preload-v1', { ifAvailable: true }, async lock => {
    if (!lock) return;
    warmBytes = 0;
    warmPlan ??= warmResources(value);
    const plan = warmPlan;
    const cache = await caches.open(CACHE_NAME);
    // One snapshot avoids thousands of serial CacheStorage reads after a release change.
    const present = new Set((await cache.keys()).map(request => request.url));
    warmState = 'loading';
    const limit = preloadConcurrency(concurrency);
    const queued = typeof warmId === 'string' && warmId.length <= 128;
    // Legacy pages still get their original bounded batch. New pages can stop refill explicitly.
    const maximum = queued ? MANUAL_PRELOAD_BATCH_FILES : limit;
    const until = Date.now() + MANUAL_PRELOAD_WINDOW_MS;
    let cursor = warmCursor, selected = 0, firstMissing = Infinity, failed = false, disabled = false;
    const cancelled = () => warmPlan !== plan || (queued && cancelledWarm.has(warmId));
    function next() {
      if (failed || disabled || cancelled() || selected >= maximum || (queued && Date.now() >= until)) return null;
      while (cursor < plan.length) {
        const index = cursor++, [url, item] = plan[index], key = cacheKey(item);
        if (present.has(key)) continue;
        selected++;
        return { index, url, item, key };
      }
      return null;
    }
    async function download() {
      for (let task; (task = next());) {
        const { index, url, item, key } = task;
        if (cancelled() || !await enabled() || cancelled()) {
          if (!cancelled()) disabled = true;
          firstMissing = Math.min(firstMissing, index);
          return;
        }
        try {
          const request = new Request(new URL(url.slice(1), base), {
            priority: 'low', signal: AbortSignal.timeout(queued ? 25000 : 8000),
          });
          await fullResponse(request, item);
          if (!await cache.match(key)) throw new Error('Resource was not saved');
          warmBytes += item.bytes;
        } catch { failed = true; firstMissing = Math.min(firstMissing, index); }
      }
    }
    // Each completed slot immediately takes the next file instead of waiting for the slowest member.
    await Promise.all(Array.from({ length: limit }, () => download()));
    if (warmPlan !== plan) return; // Clearing the cache starts a new plan; do not overwrite its cursor/state.
    warmCursor = Math.min(firstMissing, cursor);
    warmState = !await enabled() ? 'disabled' : cancelled() ? 'paused' : failed ? 'retry'
      : warmCursor >= warmPlan.length ? 'complete' : 'loading';
  });
}
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  // Frozen release JSON is also used by the combat loader. Its legacy no-cache
  // flag must not download the same chess/enemy records again after room entry.
  // This uses the browser's HTTP cache, never the art CacheStorage or live APIs.
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && event.request.mode !== 'navigate'
    && /^\/_build\/[A-Za-z0-9_-]+\/$/.test(base.pathname)
    && url.origin === base.origin && url.pathname.startsWith(base.pathname + 'data/')
    && /^[A-Za-z0-9_-]+\.json$/.test(url.pathname.slice((base.pathname + 'data/').length))
    && event.request.cache !== 'reload') {
    event.respondWith(fetch(new Request(event.request, { cache: 'default' })));
    return;
  }
  if (resourcePath(event.request, base)) event.respondWith((async () => {
    const item = await routeFor(event.request);
    return item ? serve(event.request, item) : fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  const port = event.ports?.[0];
  if (!port || !['status', 'enable', 'clear', 'warm', 'warm.stop'].includes(event.data?.action)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.action === 'warm.stop') stopWarm(event.data.warmId);
      if (!storageAvailable() && ['enable', 'clear'].includes(event.data.action)) throw new Error('Resource storage unavailable');
      if (event.data.action === 'enable') await (await caches.open(META_NAME)).put(prefKey, new Response(event.data.enabled ? 'on' : 'off'));
      if (event.data.action === 'clear') {
        await navigator.locks.request(lockName, async () => {
          const meta = await caches.open(META_NAME);
          await meta.put(epochKey, new Response(crypto.randomUUID()));
          await caches.delete(CACHE_NAME); hits = 0; savedBytes = 0;
          warmPlan = null; warmCursor = 0; warmComplete = 0; warmState = 'waiting';
          await meta.put(sizeKey, new Response(JSON.stringify({ files: 0, bytes: 0 })));
        });
      }
      // r11 pages also send this message: pause their automatic pack downloads on worker update.
      if (event.data.action === 'warm') {
        if (event.data.manual === true) await warmOne(event.data.concurrency, event.data.warmId);
        else { warmState = 'paused'; warmBytes = 0; }
      }
      port.postMessage({ ok: true, ...await stats() });
    } catch (error) { port.postMessage({ ok: false, error: String(error?.message || error) }); }
  })());
});
