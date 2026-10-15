import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { acceptsGzip } from '../proxy-transfer-r01.mjs';

export const POLICY_REV = 'resource-desktop-r01';
export function coreResources(manifest, build) {
  if (manifest?.version !== 1 || !manifest.entries || !/^[A-Za-z0-9_-]{1,80}$/.test(build)) throw Error('Invalid manifest');
  const seen = new Map();
  for (const [url, item] of Object.entries(manifest.entries)) {
    if (!/^\/(assets|fonts)\//.test(url) || /\.(mp3|ogg|wav|m4a|aac|flac|opus|mp4|webm)$/i.test(url)) continue;
    if (!/^[a-f0-9]{64}$/.test(item?.hash) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > 33554432) throw Error('Invalid core resource');
    if (seen.has(item.hash) && seen.get(item.hash).bytes !== item.bytes) throw Error('Conflicting resource sizes');
    if (!seen.has(item.hash)) seen.set(item.hash, { hash: item.hash, bytes: item.bytes });
  }
  const entries = [...seen.values()].sort((a,b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
  if (!entries.length) throw Error('Empty core resource manifest');
  return { version: 1, policy: POLICY_REV, build, count: entries.length, bytes: entries.reduce((sum,item) => sum + item.bytes, 0),
    digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), entries };
}
async function jsonFetch(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'accept-encoding': 'identity' } });
  if (!response.ok) { await response.body?.cancel(); throw Error('Game status unavailable'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 8388608) { await response.body.cancel().catch(() => {}); throw Error('Manifest too large'); } chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function createResourcePolicyRouter({ gatewayOrigin, budget, cap, metrics, admission, publicOrigin, variants = {}, downloads = {}, assetsRoot = new URL('./', import.meta.url), variantsRoot = assetsRoot }) {
  const manifests = new Map(), pending = new Map(), files = new Map();
  async function manifest(build) {
    if (manifests.has(build)) return manifests.get(build);
    if (!pending.has(build)) pending.set(build, jsonFetch(gatewayOrigin + '/_build/' + build + '/data/resource-cache.json')
      .then(value => { const result = coreResources(value, build); if (manifests.size >= 16) manifests.delete(manifests.keys().next().value); manifests.set(build, result); return result; })
      .finally(() => pending.delete(build)));
    return pending.get(build);
  }
  function send(req,res,body,type,headers={}) {
    const zipped = acceptsGzip(req.headers['accept-encoding']); const bytes = zipped ? gzipSync(body) : body;
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', Vary:'Accept-Encoding', ...(zipped ? {'Content-Encoding':'gzip'} : {}), ...headers });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }
  return async function resourcePolicy(req,res) {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith('/resource-policy/')) return false;
    try {
      if (url.pathname === '/resource-policy/admission') {
        const active = await admission.currentBuild(async () => (await jsonFetch(gatewayOrigin + '/__hot/status')).build);
        if (req.method === 'GET') {
          const build = url.searchParams.get('build') || active;
          send(req,res,Buffer.from(JSON.stringify({allowed:build === active && admission.valid(req.headers.cookie,build),build:active})), 'application/json; charset=utf-8'); return true;
        }
        if (req.method !== 'POST') { res.writeHead(405,{Allow:'GET, POST'});res.end();return true; }
        if (req.headers.origin !== publicOrigin || req.headers['x-sp-resource-entry'] !== '1' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
          res.writeHead(403);res.end();return true;
        }
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>2048){res.writeHead(413);res.end();return true;}chunks.push(chunk);}
        const value=JSON.parse(Buffer.concat(chunks).toString());
        const expected=await manifest(active);
        if(value.build!==active||value.digest!==expected.digest||!['web-cache','native'].includes(value.source)){
          res.writeHead(409,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'服务器版本已变化，请重新检查资源。'}));return true;
        }
        const receipt=admission.issue(active,expected.digest,value.source);
        send(req,res,Buffer.from(JSON.stringify({allowed:true,build:active})), 'application/json; charset=utf-8',{'Set-Cookie':receipt.cookie});return true;
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, { Allow:'GET, HEAD' }); res.end(); return true; }
      if (url.pathname === '/resource-policy/status.json') {
        const status = await jsonFetch(gatewayOrigin + '/__hot/status');
        send(req,res,Buffer.from(JSON.stringify({ policy:POLICY_REV, build:status.build, download:budget.status(), capacity:cap?.status(), traffic:metrics?.snapshot(), coreRequired:true, checkLocation:'portal-only', audioOptional:true, mode:'local-first', optimizedImages:Object.keys(variants).length })), 'application/json; charset=utf-8'); return true;
      }
      if (url.pathname === '/resource-policy/manifest.json') {
        const build = url.searchParams.get('build');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(build || '')) throw Error('Invalid build');
        send(req,res,Buffer.from(JSON.stringify(await manifest(build))), 'application/json; charset=utf-8', {'Cache-Control':'public, max-age=31536000, immutable'}); return true;
      }
      const name = url.pathname.slice('/resource-policy/'.length);
      if (url.pathname.startsWith('/resource-policy/variants/')) {
        const hash = /^\/resource-policy\/variants\/([a-f0-9]{64})\.webp$/.exec(url.pathname)?.[1];
        const item = hash && Object.values(variants).find(value => value.hash === hash);
        if (!item) { res.writeHead(404); res.end(); return true; }
        const file = new URL('variants/' + hash + '.webp', variantsRoot);
        const stat = await fs.stat(file); const headers = { 'Content-Type':'image/webp', 'Content-Length':stat.size, 'Cache-Control':'public, max-age=31536000, immutable', 'X-Content-Type-Options':'nosniff', 'X-SP-Download-Budget':String(budget.rate) };
        if (req.method === 'HEAD') { res.writeHead(200,headers);res.end();return true; }
        const limited = budget.open(req.socket.remoteAddress);
        if (!limited) { res.writeHead(503,{'Retry-After':'3','Cache-Control':'no-store'}); res.end(); return true; }
        res.writeHead(200,headers); pipeline(createReadStream(file,{highWaterMark:32768}),limited,res,()=>{});return true;
      }
      if (['client.js','entry.mjs','style.css','cache-store.mjs','compat.mjs'].includes(name)) {
        if (!files.has(name)) files.set(name, await fs.readFile(new URL(name, assetsRoot)));
        send(req,res,files.get(name), name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'); return true;
      }
      if (url.pathname.startsWith('/resource-policy/download/')) {
        const key = url.pathname.slice('/resource-policy/download/'.length), file = downloads[key];
        if (!file) { res.writeHead(404); res.end(); return true; }
        const stat = await fs.stat(file); let start = 0, end = stat.size - 1, status = 200;
        const headers = { 'Content-Type':'application/zip', 'Accept-Ranges':'bytes', 'Cache-Control':'public, max-age=3600', 'X-Content-Type-Options':'nosniff', 'Content-Disposition':`attachment; filename="${key}"` };
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!match || (!match[1] && !match[2])) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); res.end(); return true; }
          start = match[1] ? Number(match[1]) : Math.max(0,stat.size-Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]),end) : end;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); res.end(); return true; }
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        }
        headers['Content-Length'] = end-start+1;
        if (req.method === 'HEAD') { res.writeHead(status,headers); res.end(); return true; }
        const limited = budget.open(req.socket.remoteAddress);
        if (!limited) { res.writeHead(429,{'Retry-After':'15','Cache-Control':'no-store'}); res.end('下载人数较多，请稍后重试或从QQ群获取资源包。'); return true; }
        res.writeHead(status,headers); pipeline(createReadStream(file,{start,end,highWaterMark:32768}), limited, res, () => {}); return true;
      }
      res.writeHead(404); res.end(); return true;
    } catch {
      if (!res.headersSent && !res.destroyed) { res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'10'}); res.end(JSON.stringify({error:'资源检查暂不可用，请稍后重试。'})); }
      return true;
    }
  };
}

export function injectResourceEntry(source, uri) {
  const match = /^\/_build\/([A-Za-z0-9_-]{1,80})\/(?:index\.html)?$/.exec(new URL(uri, 'http://local').pathname);
  if (!match) return source;
  const build = match[1]; let changed = false;
  const next = source.replace(/(<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'])[^"']*\/js\/main\.js(["'][^>]*>)/, (whole,a,b) => { changed = true; return a + '/resource-policy/entry.mjs?build=' + build + '&rev=' + POLICY_REV + b; });
  if (!changed) throw Error('Game entry could not be protected');
  // The frozen gateway pins fetch() calls to a release. Policy endpoints belong to
  // the outer HTTPS entry and must stay outside that rewrite, like /__hot/.
  const protectedSource = next.replace("&&!u.pathname.startsWith('/__hot/')", "&&!u.pathname.startsWith('/__hot/')&&!u.pathname.startsWith('/resource-policy/')");
  if (next.includes('window.fetch=(input,init)') && protectedSource === next) throw Error('Unsupported gateway fetch wrapper');
  return protectedSource.replace('</head>', '<link rel="stylesheet" href="/resource-policy/style.css?rev=' + POLICY_REV + '"></head>');
}
