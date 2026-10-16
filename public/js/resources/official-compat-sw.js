/* Classic-worker adapter: keep official ZIP storage authoritative while reading
 * previous v2/full-hash packs without copying or enumerating their contents. */
(function () {
  const origin = self.location.origin;
  const params = new URL(self.location.href).searchParams;
  // Native protocol handlers serve verified bundled files below fetch().
  const only = params.get('native') !== '1' && (self.location.hostname === 'weishuxieyiwangye.cn'
    || params.get('localOnly') === '1');
  const routes = new Map();
  const missingKinds = new Set();
  let importedPaths = null;
  let hits = 0;
  const strip = path => path.replace(/^\/_build\/[A-Za-z0-9_-]+/, '').replace(/\/~[0-9a-f]{16}(?=\/)/, '');
  const isResource = path => /^\/(assets|fonts|media)\//.test(strip(path)) && !strip(path).endsWith('.css');
  const json = async url => {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Resource catalog unavailable');
    return response.json();
  };
  async function entry(url) {
    const prefix = /^\/_build\/[^/]+/.exec(url.pathname)?.[0] || '';
    const pathname = strip(url.pathname);
    const directory = pathname.slice(0, pathname.lastIndexOf('/'));
    const key = prefix + directory;
    if (!routes.has(key)) routes.set(key, (async () => {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(directory))))
        .map(n => n.toString(16).padStart(2, '0')).join('');
      return json(origin + prefix + '/data/resource-routes/' + hash + '.json');
    })().catch(() => { routes.delete(key); return null; }));
    const catalog = await routes.get(key);
    const canonical = pathname.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/');
    const alias = catalog?.aliases?.[canonical] || catalog?.aliases?.[pathname];
    const item = catalog?.entries?.[alias || canonical] || catalog?.entries?.[pathname];
    return /^[a-f0-9]{64}$/.test(item?.hash) ? item : null;
  }
  async function lookup(request, cache) {
    const url = new URL(request.url);
    const unpinned = url.pathname.replace(/^\/_build\/[A-Za-z0-9_-]+/, '');
    let hit = await cache.match(origin + unpinned);
    // Unhashed legacy references (including the room-entry probe) can use the
    // official import's index. Reload that single index after each new import.
    if (!hit && !/\/~[a-f0-9]{16}\//.test(unpinned)) {
      if (!importedPaths) importedPaths = (async () => {
        const index = await cache.match(origin + '/sp-imported-index.json');
        const list = index ? await index.json() : [];
        return new Map(list.filter(p => isResource(p)).map(p => [strip(p), p]));
      })();
      const mapped = (await importedPaths).get(unpinned);
      if (mapped) hit = await cache.match(origin + mapped);
    }
    if (!hit) {
      const item = await entry(url);
      if (item) {
        const key = origin + '/__sp_resource_content/' + item.hash;
        hit = await (await caches.open('sp-resource-content-v2-' + item.hash[0])).match(key)
          || await (await caches.open('sp-resource-content-v1')).match(key);
      }
    }
    if (!hit) return null;
    hits++;
    const headers = new Headers(hit.headers);
    headers.set('X-SP-Resource-Cache', 'HIT');
    const range = request.headers.get('range');
    if (!range) return new Response(hit.body, { status: hit.status, headers });
    const body = await hit.arrayBuffer();
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = match?.[1] ? Number(match[1]) : Math.max(0, body.byteLength - Number(match?.[2]));
    let end = match?.[1] && match[2] ? Math.min(Number(match[2]), body.byteLength - 1) : body.byteLength - 1;
    if (!match || !Number.isSafeInteger(start) || start > end || start >= body.byteLength) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + body.byteLength } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${body.byteLength}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(body.slice(start, end + 1), { status: 206, headers });
  }
  function missing(request) {
    const audio = /\.(mp3|ogg|wav|m4a|opus)$/.test(new URL(request.url).pathname) || request.url.includes('/media/');
    const kind = audio ? 'audio' : 'core';
    if (!missingKinds.has(kind)) {
      missingKinds.add(kind);
      self.clients.matchAll({ type: 'window' }).then(clients => clients.forEach(client => client.postMessage({ type: 'sp-local-resource-missing', kind })));
    }
    if (audio) {
      const body = new Uint8Array(8044), view = new DataView(body.buffer);
      const label = (at, text) => Array.from(text).forEach((c, i) => { body[at + i] = c.charCodeAt(0); });
      label(0, 'RIFF'); view.setUint32(4, 8036, true); label(8, 'WAVEfmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
      view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
      label(36, 'data'); view.setUint32(40, 8000, true); body.fill(128, 44);
      return new Response(body, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-SP-Resource-Cache': 'LOCAL-MISSING' } });
    }
    return new Response('Local resource missing; import the complete v0.3 resource pack.', {
      status: 503, headers: { 'Cache-Control': 'no-store', 'X-SP-Resource-Cache': 'LOCAL-MISSING' },
    });
  }
  self.SPAssetCompat = { only, isResource, lookup, missing, strip };
  self.addEventListener('message', event => {
    if (event.data?.type === 'sp-import-complete') { importedPaths = null; return; }
    const port = event.ports?.[0];
    if (!port || !['local-ready', 'ready', 'status', 'enable', 'warm', 'warm.stop'].includes(event.data?.action)) return;
    port.postMessage({ ok: true, localOnly: only, enabled: true, manifestReady: true,
      hits, networkPreloadAllowed: !only && params.get('noPreload') !== '1',
      preload: { state: only || params.get('noPreload') === '1' ? 'disabled' : 'paused' } });
  });
}());
