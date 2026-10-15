import { splitHashedPath } from '../../../shared/assetPaths.js';

export const CACHE_NAME = 'sp-resource-content-v1';
export const META_NAME = 'sp-resource-preference-v1';
export const MAX_BYTES = 1024 * 1024 * 1024;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MANUAL_PRELOAD_CONCURRENCY = 16;
export const MANUAL_PRELOAD_BATCH_FILES = 128;
export const MANUAL_PRELOAD_WINDOW_MS = 1500;
export function preloadConcurrency(value) {
  return Number.isFinite(value) ? Math.max(1, Math.min(MANUAL_PRELOAD_CONCURRENCY, Math.floor(value))) : 1;
}

// A content hash has one download even when several URLs or releases use it.
export function warmResources(manifest) {
  const seen = new Set();
  return Object.entries(manifest?.entries ?? {}).filter(([url, item]) => {
    if (!/^\/(assets|fonts)\//.test(url) || !/^[a-f0-9]{64}$/.test(item?.hash)
      || !(item.bytes > 0 && item.bytes <= MAX_FILE_BYTES) || seen.has(item.hash)) return false;
    seen.add(item.hash); return true;
  }).sort(([a, x], [b, y]) => {
    // Small visible art first, large audio last. No decoding or GPU allocation.
    const priority = url => url.startsWith('/assets/audio/') ? 2 : url.startsWith('/fonts/') ? 0 : 1;
    return priority(a) - priority(b) || x.bytes - y.bytes || a.localeCompare(b);
  });
}

// The downloadable, uncompressed resource bundle determines the cache capacity.
export function resourceCacheLimit(manifest) {
  const total = Number(manifest?.totalBytes);
  return Number.isSafeInteger(total) && total > 0
    ? Math.max(MAX_FILE_BYTES, Math.ceil(total / 1048576) * 1048576) : MAX_BYTES;
}

export function resourcePath(request, base) {
  if (request.method !== 'GET' || request.mode === 'navigate') return null;
  const url = new URL(request.url), scope = new URL(base);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const pathname = '/' + url.pathname.slice(scope.pathname.length);
  // Only the art/audio/font allowlist. Never cache scripts, pages, data, APIs or sockets.
  if (!/^\/(assets|fonts|media)\//i.test(pathname)) return null;
  return canonicalResourcePath(splitHashedPath(pathname).path);
}

// File manifests encode each segment, while image/atlas loaders may leave [] or
// other URL-safe characters literal. Both spellings must address the same hash.
function canonicalResourcePath(pathname) {
  try { return pathname.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/'); }
  catch { return null; }
}

const foldedManifests = new WeakMap();
function foldedManifest(manifest) {
  if (foldedManifests.has(manifest)) return foldedManifests.get(manifest);
  const entries = new Map(), aliases = new Map();
  for (const [path, item] of Object.entries(manifest.entries || {})) {
    const key = canonicalResourcePath(path)?.toLowerCase();
    if (!key) continue;
    const old = entries.get(key);
    // Windows serves unique case aliases; never guess between distinct files.
    entries.set(key, !entries.has(key) ? item : old?.hash === item?.hash && old?.bytes === item?.bytes ? old : null);
  }
  for (const [path, target] of Object.entries(manifest.aliases || {})) {
    const key = canonicalResourcePath(path)?.toLowerCase();
    if (key) aliases.set(key, !aliases.has(key) || aliases.get(key) === target ? target : null);
  }
  const result = { entries, aliases }; foldedManifests.set(manifest, result); return result;
}

export function resourceEntry(request, base, manifest) {
  const pathname = resourcePath(request, base);
  if (!pathname || !manifest?.entries) return null;
  let item = manifest.entries[manifest.aliases?.[pathname] ?? pathname];
  if (!item) {
    const folded = foldedManifest(manifest), key = pathname.toLowerCase();
    const target = folded.aliases.get(key);
    item = target ? manifest.entries[target] || folded.entries.get(canonicalResourcePath(target)?.toLowerCase()) : folded.entries.get(key);
  }
  return item && /^[a-f0-9]{64}$/.test(item.hash) && item.bytes > 0 && item.bytes <= MAX_FILE_BYTES ? item : null;
}

export async function rangeResponse(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const bytes = await response.arrayBuffer(), length = bytes.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), length - 1) : length - 1) : length - 1;
  const headers = new Headers(response.headers);
  headers.delete('content-encoding'); headers.set('accept-ranges', 'bytes');
  if (start >= length || end < start) {
    headers.set('content-range', `bytes */${length}`); headers.set('content-length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-range', `bytes ${start}-${end}/${length}`); headers.set('content-length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
