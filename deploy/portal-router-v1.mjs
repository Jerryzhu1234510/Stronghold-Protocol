import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { acceptsGzip } from './proxy-transfer-r01.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
const integer = n => Number.isSafeInteger(n) && n >= 0 ? n : undefined;
const pick = h => ({ online: integer(h.onlinePlayers), rooms: integer(h.roomsOnline), matches: integer(h.matchesOnline), waiting: integer(h.waitingRooms) });
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

async function publicJson(url, fetcher) {
  const r = await fetcher(url, { signal: AbortSignal.timeout(3500), redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) { await r.body?.cancel(); throw new Error('Unavailable public JSON'); }
  const chunks = []; let size = 0;
  for await (const chunk of r.body) { size += chunk.length; if (size > 131072) { await r.body.cancel().catch(() => {}); throw new Error('Status response too large'); } chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createPortalRouter({ portalRoot, gatewayOrigin = 'http://127.0.0.1:27527', icuOrigin = 'https://weishuxieyi.icu', fetcher = fetch, statusTtl = 15000, pointerTtl = 1000 } = {}) {
  if (!portalRoot) throw new Error('Portal root is required');
  let page, pointerAt = 0, pointerPending, stats, statsAt = 0, statsPending;
  async function getPage() {
    if (Date.now() - pointerAt < pointerTtl) return page;
    if (!pointerPending) pointerPending = (async () => {
      try {
        const pointer = JSON.parse(await fs.readFile(path.join(portalRoot, 'current.json'), 'utf8'));
        if (pointer.enabled === false) { page = undefined; return; }
        if (!/^l\d{2,5}$/.test(pointer.version) || !/^[a-f0-9]{64}$/.test(pointer.sha256)) throw new Error('Invalid portal pointer');
        if (page?.version === pointer.version && page?.hash === pointer.sha256) return;
        const body = await fs.readFile(path.join(portalRoot, 'releases', pointer.version, 'index.html'));
        if (body.length > 262144 || hash(body) !== pointer.sha256) throw new Error('Portal integrity check failed');
        const source = body.toString('utf8');
        const hashes = tag => [...source.matchAll(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi'))].map(m => "'sha256-" + createHash('sha256').update(m[1]).digest('base64') + "'").join(' ');
        const csp = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; style-src " + hashes('style') + '; script-src ' + hashes('script') + "; connect-src 'self' https://weishuxieyiwangye.cn:8443 https://weishuxieyi.icu; font-src 'none'";
        page = { version: pointer.version, hash: pointer.sha256, body, gzip: gzipSync(body, { level: 6 }), csp };
      } catch { /* Keep a validated last good page. On first failure, the existing game remains reachable. */ }
      finally { pointerAt = Date.now(); }
    })().finally(() => { pointerPending = undefined; });
    await pointerPending; return page;
  }
  async function nodeStatus(origin) {
    const [rootResult, hotResult] = await Promise.allSettled([
      publicJson(origin + '/healthz', fetcher), publicJson(origin + '/__hot/status', fetcher)
    ]);
    const root = rootResult.status === 'fulfilled' && rootResult.value?.ok === true ? rootResult.value : undefined;
    const hot = hotResult.status === 'fulfilled' ? hotResult.value : undefined;
    if (hot && Array.isArray(hot.versions)) {
      const versions = hot.versions.filter(v => v.healthy === true && /^[A-Za-z0-9_-]{1,80}$/.test(v.id)).slice(0, 8);
      const rows = await Promise.all(versions.map(async v => {
        try { const h = await publicJson(origin + '/_build/' + v.id + '/healthz', fetcher); return h.ok === true ? { id: v.id, h } : null; } catch { return null; }
      }));
      // The unpinned health route describes the current version if its pinned probe failed.
      if (root && !rows.some(r => r?.id === hot.build)) { const i = versions.findIndex(v => v.id === hot.build); if (i >= 0) rows[i] = { id: hot.build, h: root }; }
      const good = rows.filter(Boolean);
      if (good.length) {
        const result = { state: 'online', partial: good.length !== versions.length };
        for (const key of ['online', 'rooms', 'matches']) {
          const values = good.map(r => pick(r.h)[key]);
          if (values.every(n => n !== undefined)) result[key] = values.reduce((a,b) => a+b,0);
        }
        result.waiting = pick(good.find(r => r.id === hot.build)?.h || {}).waiting;
        return result;
      }
    }
    if (root) return { state: 'online', ...pick(root), partial: true };
    return { state: 'unknown' };
  }
  async function getStats() {
    if (stats && Date.now() - statsAt < statusTtl) return stats;
    if (!statsPending) statsPending = Promise.allSettled([nodeStatus(gatewayOrigin), nodeStatus(icuOrigin)])
      .then(results => {
        statsAt = Date.now();
        stats = { at: new Date(statsAt).toISOString(), nodes: Object.fromEntries(['8443','icu'].map((id,i) => [id, results[i].status === 'fulfilled' ? results[i].value : { state: 'unknown' }])) };
        return stats;
      }).finally(() => { statsPending = undefined; });
    return statsPending;
  }
  function json(req,res,status,data,headers = {}) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, { ...jsonHeaders, ...headers, 'Content-Length': body.length }); res.end(req.method === 'HEAD' ? undefined : body);
  }
  return async function portal(req, res) {
    let url;
    try { url = new URL(req.url, 'http://portal.local'); } catch { return false; }
    const pathname = url.pathname;
    const read = ['GET','HEAD'].includes(req.method);
    if (pathname === '/game.html' || pathname === '/index.html' && url.searchParams.has('room')) {
      if (!read) { json(req,res,405,{error:'Method not allowed'},{Allow:'GET, HEAD'}); return true; }
      req.url = '/' + url.search; return false;
    }
    if (pathname.startsWith('/lobby/')) {
      if (!['/lobby/ping','/lobby/status.json'].includes(pathname)) { json(req,res,404,{error:'Not found'}); return true; }
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...jsonHeaders, 'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS', 'Access-Control-Max-Age':'3600' }); res.end(); return true; }
      if (!read) { json(req,res,405,{error:'Method not allowed'},{Allow:'GET, HEAD, OPTIONS'}); return true; }
      if (pathname === '/lobby/ping') { res.writeHead(204,jsonHeaders); res.end(); return true; }
      const status = await getStats(); if (!res.destroyed) json(req,res,200,status); return true;
    }
    if (!read || !['/','/index.html'].includes(pathname) || url.searchParams.has('room')) return false;
    const current = await getPage(); if (!current || res.destroyed) return false;
    const gzip = acceptsGzip(req.headers['accept-encoding']) && !/\bno-transform\b/i.test(req.headers['cache-control'] || '');
    const body = gzip ? current.gzip : current.body;
    res.writeHead(200, {
      'Content-Type':'text/html; charset=utf-8', 'Content-Length':body.length, 'Cache-Control':'no-store', Vary:'Accept-Encoding',
      'X-Portal-Version':current.version, 'Content-Security-Policy':current.csp, 'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', ...(gzip ? {'Content-Encoding':'gzip'} : {})
    });
    res.end(req.method === 'HEAD' ? undefined : body); return true;
  };
}
