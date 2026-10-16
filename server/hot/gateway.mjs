import { pinIdentityHtml, generationBootstrap, htmlCsp } from './identityPin.mjs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access, realpath, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createAccountAuthority } from '../accounts/authority.js';
import { gatewayHeaders } from './proxy.js';
import { t } from '../../shared/i18n.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isId = id => /^[a-zA-Z0-9_-]{1,64}$/.test(id);
const mount = id => `/_build/${id}`;
const uri = (id, p) => mount(id) + p;
const rootPath = /^(?:\/)?(?:assets|vendor|data|media|packs|fonts|sim|shared|js|css)\//;
// Only release-owned game tables are immutable; live APIs and resource routing stay revalidatable.
const gameTablePath = /^\/data\/(?:config|chess|bonds|items|bands|enemies|bosses|stages|tokens|choices|effects|garrisons|factions|backups|waves)\.json(?:\?|$)/;
const entryPaths = new Set(['/', '/index.html', '/game.html', '/versus.html', '/training.html']);

export function pinText(text, type, originalPath, id) {
  const pin = p => {
    if (p.startsWith('/api/') || p.startsWith('/_build/') || /^(?:[a-z]+:|\/\/|#)/i.test(p)) return p;
    if (p.startsWith('.') || p.startsWith('/')) return uri(id, new URL(p, `http://local${originalPath}`).pathname) + (p.includes('?') ? '?' + p.split('?')[1] : '');
    if (rootPath.test(p)) return uri(id, '/' + p.replace(/^\//, ''));
    return p;
  };
  if (type.includes('javascript')) {
    text = text.replace(/(\b(?:from|import)\s*(?:\(\s*)?)(['"])([^'"\n]+)\2/g, (all, pre, q, spec) => pre + q + (spec.startsWith('.') || spec.startsWith('/') ? pin(spec) : spec) + q);
    // Runtime-created script/image/audio URLs and variable dynamic-import bases.
    text = text.replace(/(['"])(\/(?:assets|vendor|data|media|packs|fonts|sim|shared|js|css)\/[^'"\n]*)\1/g, (_, q, p) => q + pin(p) + q);
  } else if (type.includes('css')) {
    text = text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (_, q, p) => `url(${q}${pin(p)}${q})`);
    text = text.replace(/(@import\s+)(['"])([^'"]+)\2/g, (_, pre, q, p) => pre + q + pin(p) + q);
  } else if (type.includes('json')) {
    const walk = v => typeof v === 'string' ? (rootPath.test(v) ? pin(v) : v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, walk(value)])) : v;
    text = JSON.stringify(walk(JSON.parse(text)));
  } else if (type.includes('html')) {
    text = text.replace(/(['"])(\/(?:assets|vendor|data|media|packs|fonts|sim|shared|js|css)\/[^'"\n]*)\1/g, (_, q, p) => q + pin(p) + q);
    const bootstrap = `<script>window.__SP_GENERATION=${JSON.stringify(id)};history.replaceState(null,'',${JSON.stringify(uri(id, originalPath))}+location.search+location.hash);const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{let u=new URL(input instanceof Request?input.url:input,location.href);if(u.origin===location.origin&&!u.pathname.startsWith('/_build/')&&!u.pathname.startsWith('/__hot/')){u.pathname=${JSON.stringify(mount(id))}+u.pathname;input=input instanceof Request?new Request(u,input):u;}return nativeFetch(input,init);};</script>`;
    text = text.replace('<head>', '<head>' + bootstrap);
  }
  return text;
}

export async function startGateway({ releaseRoot, port = 3222, host = '127.0.0.1', workerEnv = {}, accountFile = process.env.SP_ACCOUNTS_FILE, allowCreateAccounts = false, log = console } = {}) {
  const authority = createAccountAuthority({ file: accountFile, allowCreate: allowCreateAccounts, log });
  const releases = new Map();
  let active = null, serial = 0, updating = false, closing = null;
  const sockets = new Set();
  // Cache only transformed text; large art/audio/model responses are streamed.
  const cache = new Map(); let cacheBytes = 0;
  let populationCache = null, populationAt = 0, populationPending = null;
  const population = async () => {
    if (populationCache && Date.now() - populationAt < 1000) return populationCache;
    if (!populationPending) populationPending = Promise.all([...releases.values()].filter(r => r.healthy).map(r => fetch(`http://127.0.0.1:${r.port}/population`, { signal: AbortSignal.timeout(2000) }).then(res => res.json())))
      .then(counts => { populationAt = Date.now(); populationCache = counts.reduce((out, c) => { for (const key of ['online', 'matching', 'inGame']) out[key] += c[key] || 0; return out; }, { online: 0, matching: 0, inGame: 0 }); return populationCache; })
      .finally(() => { populationPending = null; });
    return populationPending;
  };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const select = raw => {
    const u = new URL(raw, 'http://local');
    const found = /^\/_build\/([^/]+)(\/.*)?$/.exec(u.pathname);
    return { release: found ? releases.get(found[1]) : active, pinned: !!found, path: (found ? found[2] || '/' : u.pathname) + u.search };
  };
  async function activate(root) {
    if (updating) throw new Error('已有更新正在启动');
    if ([...releases.values()].filter(r => r.healthy).length >= 3) throw new Error('已有三个版本保留中；请等旧对局结束、玩家载入新版后清理旧版本，再启用下一版');
    updating = true;
    let child;
    let previous = null;
    try {
      root = await realpath(root);
      const marker = JSON.parse(await readFile(path.join(root, 'HOT-RELEASE.json'), 'utf8'));
      if (marker.accountsProtocol !== 1) throw new Error('该包未适配账号热更新协议');
      const relativeAccount = path.relative(root, authority.file);
      if (!relativeAccount.startsWith('..' + path.sep) && relativeAccount !== '..' && !path.isAbsolute(relativeAccount)) throw new Error('账号库必须在发布目录之外');
      if ([...releases.values()].some(r => r.root === root)) throw new Error('新版本必须使用独立目录，不能覆盖正在运行的版本');
      await access(path.join(root, 'server/index.js'));
      await access(path.join(root, 'public/index.html'));
      child = fork(path.join(HERE, 'worker.mjs'), [root], { cwd: root, execArgv: [], env: { ...process.env, ...workerEnv, SP_ACCOUNT_IPC: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      let releaseId = null;
      child.on('message', message => {
        if (message?.type !== 'account.request') return;
        try {
          if (!releaseId) throw new Error('版本尚未就绪');
          const value = authority.rpc(message.method, message.params || {}, releaseId);
          if (child.connected) child.send({ type: 'account.reply', id: message.id, value });
        } catch (error) {
          log.error('[accounts] worker request failed', error.message);
          if (child.connected) child.send({ type: 'account.reply', id: message.id, error: t('账号服务暂不可用') });
        }
      });
      const workerPort = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('新版启动超时')); }, 30000);
        const done = () => clearTimeout(timer);
        child.once('error', e => { done(); reject(e); });
        child.once('exit', code => { done(); reject(new Error(`新版启动失败 (${code})`)); });
        child.once('message', msg => { done(); msg?.type === 'ready' ? resolve(msg.port) : reject(new Error('新版启动响应不正确')); });
      });
      const health = await fetch(`http://127.0.0.1:${workerPort}/healthz`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
      if (!health.ok) throw new Error('新版健康检查失败');
      const id = `${health.build || 'release'}-${++serial}`;
      if (!isId(id)) throw new Error('版本标识不正确');
      const release = { id, root, port: workerPort, child, draining: false, connections: 0, healthy: true, integrity: /^0\.[3-9]\./.test(health.app || '') };
      releaseId = id;
      // Mark old lobby as draining BEFORE advertising the new release. Existing game handlers remain active.
      if (active) {
        previous = active;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { previous.child.off('message', ack); reject(new Error('旧版本未确认停止接待新对局')); }, 5000);
          const ack = msg => { if (msg?.type === 'drained') { clearTimeout(timer); previous.child.off('message', ack); resolve(); } };
          previous.child.on('message', ack); previous.child.send({ type: 'drain' });
        });
        previous.draining = true;
      }
      releases.set(id, release);
      active = release;
      child.once('exit', () => { release.healthy = false; authority.release(id); });
      log.info(`新版 ${id} 已启用；旧版本对局继续运行。`);
      return release;
    } catch (error) {
      child?.kill();
      if (previous?.child.connected) { previous.child.send({ type: 'resume' }); previous.draining = false; }
      throw error;
    }
    finally { updating = false; }
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url?.startsWith('/__hot/status')) return json(res, 200, { stage: 'versioned-hot-update', build: active?.id, versions: [...releases.values()].map(r => ({ id: r.id, draining: r.draining, connections: r.connections, healthy: r.healthy })) });
      let route = select(req.url);
      // A raw ../../shared import from /_build/id/js reaches /_build/shared.
      // Redirect it to the referring generation without changing the module bytes.
      if (!route.release && /^\/_build\/(?:shared|sim|data|vendor|js|css)\//.test(req.url || '')) {
        route = { release: active, pinned: false, path: req.url.slice('/_build'.length) };
      }
      if (!route.pinned && req.headers.referer) {
        try {
          const reference = new URL(req.headers.referer);
          if (reference.host === req.headers.host) {
            const ref = select(reference.pathname);
            if (ref.pinned && ref.release?.integrity) route = { ...route, release: ref.release };
          }
        } catch { /* invalid Referer does not choose a release */ }
      }
      if (route.path.split('?')[0].startsWith('/api/')) {
        req.headers = gatewayHeaders(req);
        const url = new URL(route.path, 'http://local');
        await authority.api(req, res, { rawPath: url.pathname, query: url.search.slice(1) });
        return;
      }
      if (route.path.split('?')[0] === '/population') {
        return json(res, 200, await population());
      }
      const r = route.release;
      if (!r || !r.healthy) return json(res, 503, { error: t('该版本暂不可用，请返回首页'), home: '/' });
      if (!route.pinned && (req.method === 'GET' || req.method === 'HEAD')) {
        const entry = new URL(req.url, 'http://local');
        if (entryPaths.has(entry.pathname)) {
          res.writeHead(302, { Location: uri(r.id, entry.pathname) + entry.search, 'Cache-Control': 'no-store' });
          return res.end();
        }
      }
      if (r.integrity && route.path.split('?')[0] === '/__generation.js') {
        const body = generationBootstrap(r.id);
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      if (r.integrity && !route.pinned && /^(?:\/(?:js|css|shared|sim|data|vendor|assets|media|fonts|cs|vs|p)\/|\/sw\.js)/.test(route.path)) {
        res.writeHead(302, { Location: uri(r.id, route.path), 'Cache-Control': 'no-store' }); return res.end();
      }
      const headers = gatewayHeaders(req);
      const immutableTable = route.pinned && gameTablePath.test(route.path);
      const immutableCode = r.integrity && route.pinned && /^\/(?:js|css|shared|sim|vendor)\//.test(route.path);
      // Rewritten bodies cannot use the worker's validators. Unchanged game tables can.
      if (!immutableTable && !immutableCode) { delete headers['if-none-match']; delete headers['if-modified-since']; }
      const key = r.id + route.path;
      const finishText = item => {
        const useGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        const body = useGzip ? item.gz : item.body;
        res.writeHead(item.status, { ...item.headers, 'content-length': body.length, ...(useGzip ? { 'content-encoding': 'gzip' } : {}), vary: 'Accept-Encoding' });
        res.end(req.method === 'HEAD' ? undefined : body);
      };
      if (req.method === 'GET' && cache.has(key)) return finishText(cache.get(key));
      const upstream = http.request({ host: '127.0.0.1', port: r.port, path: route.path, method: req.method, headers }, reply => {
        if (res.destroyed) { reply.destroy(); return; }
        const type = reply.headers['content-type'] || '';
        const rewrite = r.integrity ? req.method === 'GET' && reply.statusCode === 200 && /text\/html/.test(type) : req.method === 'GET' && reply.statusCode === 200 && /javascript|text\/css|text\/html/.test(type) || req.method === 'GET' && reply.statusCode === 200 && /^\/data\/(assets|local-assets)\.json(?:\?|$)/.test(route.path);
        if (!rewrite) {
          const h = { ...reply.headers };
          if ((immutableTable || immutableCode) && (reply.statusCode === 200 || reply.statusCode === 304)) h['cache-control'] = 'public, max-age=31536000, immutable';
          res.writeHead(reply.statusCode, h); reply.pipe(res); return;
        }
        const chunks = []; let bytes = 0;
        reply.on('data', chunk => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) { reply.destroy(); res.destroy(); } else chunks.push(chunk); });
        reply.on('end', () => {
          if (res.destroyed) return;
          try {
            const body = Buffer.from(r.integrity ? pinIdentityHtml(Buffer.concat(chunks).toString(), r.id) : pinText(Buffer.concat(chunks).toString(), type, route.path.split('?')[0], r.id));
            // Incoming Node headers are lowercase. Mixed casing emits two Cache-Control
            // lines, retaining the worker's no-cache and forcing every script to reload.
            const h = { ...reply.headers, 'cache-control': type.includes('html') ? 'no-store' : 'public, max-age=31536000, immutable' };
            if (r.integrity && h['content-security-policy']) h['content-security-policy'] = htmlCsp(h['content-security-policy'], body.toString());
            delete h['content-length']; delete h['content-encoding']; delete h.etag; delete h['last-modified'];
            const item = { status: reply.statusCode, headers: h, body, gz: gzipSync(body) };
            if (!type.includes('html') && body.length < 4 * 1024 * 1024) {
              const previous = cache.get(key);
              if (previous) { cacheBytes -= previous.body.length + previous.gz.length; cache.delete(key); }
              const size = body.length + item.gz.length;
              while (cacheBytes + size > 20 * 1024 * 1024 && cache.size) { const first = cache.keys().next().value; const old = cache.get(first); cacheBytes -= old.body.length + old.gz.length; cache.delete(first); }
              cache.set(key, item); cacheBytes += size;
            }
            finishText(item);
          } catch { res.destroy(); }
        });
        reply.on('error', () => res.destroy());
      });
      upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: t('版本服务暂不可用') }); else res.destroy(); });
      req.on('aborted', () => upstream.destroy());
      // GET requests have already finished when their response is cancelled. Abort the upstream
      // on response close too, so abandoned downloads cannot retain sockets and rewrite buffers.
      res.once('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
    } catch { if (!res.headersSent) json(res, 400, { error: t('请求无效') }); else res.destroy(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    const route = select(req.url), r = route.release;
    if (!r || !r.healthy || route.path.split('?')[0] !== '/ws') return socket.destroy();
    const peer = net.connect(r.port, '127.0.0.1', () => {
      const h = gatewayHeaders(req);
      peer.write(`${req.method} ${route.path} HTTP/${req.httpVersion}\r\n` + Object.entries(h).map(([k,v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
      if (head.length) peer.write(head);
      socket.pipe(peer); peer.pipe(socket);
    });
    r.connections++;
    socket.once('close', () => { r.connections--; peer.destroy(); });
    peer.once('close', () => socket.destroy());
    peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy());
  });
  try { await activate(releaseRoot); }
  catch (error) { authority.close(); throw error; }
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { for (const r of releases.values()) r.child.kill(); authority.close(); throw error; }
  return {
    server, releases, activate, authority, get active() { return active; }, port: server.address().port,
    // Retirement is explicit: retain result/reconnect state and never terminate a live match automatically.
    async retire(id) {
      const r = releases.get(id);
      if (!r || r === active) throw new Error('不能清理当前版本');
      const h = r.healthy ? await fetch(`http://127.0.0.1:${r.port}/healthz`, { signal: AbortSignal.timeout(5000) }).then(res => res.json()) : {};
      if (h.matches || r.connections) throw new Error('旧版本仍有对局或连接，暂不能清理');
      if (r.healthy) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('旧版本停止超时，未强制终止')), 15000);
        r.child.once('exit', () => { clearTimeout(timer); resolve(); });
        r.child.send({ type: 'stop' });
      });
      releases.delete(id);
      for (const [key, item] of cache) if (key.startsWith(id + '/')) { cacheBytes -= item.body.length + item.gz.length; cache.delete(key); }
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all([...releases.values()].map(r => new Promise(resolve => { if (!r.healthy) return resolve(); r.child.once('exit', resolve); r.child.send({ type: 'stop' }); })));
      await new Promise(resolve => server.close(resolve));
      authority.close();
      })();
      return closing;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = await startGateway({ releaseRoot: process.argv[2] || path.resolve(HERE, '../..'), port: Number(process.env.PORT || 3222), host: process.env.HOST || '127.0.0.1' });
  console.log(`本地验收：http://localhost:${gateway.port}/\n保持窗口开启。更新指令：update 新版本的独立目录`);
  const input = createInterface({ input: process.stdin });
  input.on('line', async line => {
    if (line.startsWith('announce')) { for (const r of gateway.releases.values()) if (r.healthy) r.child.send({ type: 'announce', line }); return; }
    if (line.startsWith('retire ')) { try { await gateway.retire(line.slice(7).trim()); console.log('旧版本已清理'); } catch (e) { console.error(e.message); } return; }
    if (line.trim() === 'versions') { console.log([...gateway.releases.values()].map(r => ({ id: r.id, draining: r.draining, connections: r.connections }))); return; }
    if (!line.startsWith('update ')) return;
    try { await gateway.activate(line.slice(7).trim().replace(/^"|"$/g, '')); } catch (e) { console.error(`更新未启用，当前版本继续运行：${e.message}`); }
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, async () => { input.close(); await gateway.close(); process.exit(0); });
}
