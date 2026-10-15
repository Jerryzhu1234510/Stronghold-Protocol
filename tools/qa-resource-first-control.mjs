/* global window, location, PIXI, document */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { pinText } from '../server/hot/gateway.mjs';
import { createStaticHandler } from '../server/http/static.js';
import { MIME } from '../server/http/files.js';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';
import { hashedPath, splitHashedPath } from '../shared/assetPaths.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache/resource-first-control');
await fs.mkdir(out, { recursive: true });
const art = JSON.parse(await fs.readFile(path.join(root, 'data/assets.json'), 'utf8'));
const cdnCatalog = JSON.parse(gunzipSync(await fs.readFile(path.join(root, 'deploy/rainyun/resource-cdn.json.gz'))));
const ids = ['char_003_kalts', 'enemy_1000_gopro_2', 'char_010_chen'];
const entries = {}, mapped = new Map();
for (const id of ids) {
  const spine = (art.chars[id] || art.enemies[id]).spine;
  const entry = spine.front || spine;
  for (const pathname of [entry.skel, entry.atlas, ...entry.textures]) {
    const body = await fs.readFile(path.join(root, 'public', pathname));
    const hash = createHash('sha256').update(body).digest('hex');
    const known = cdnCatalog.entries[hash];
    assert.ok(known && known.bytes === body.length, 'model must use an existing verified CDN mapping');
    entries[pathname] = { hash, bytes: body.length, cdn: known.cdn };
    mapped.set(known.cdn, body);
  }
}
const catalog = resourceRoutingCatalog({ version: 1, entries });
const staticHandler = createStaticHandler({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared') });
const requests = [], report = { runs: [], pass: false };
let mode = 'redirect', originMedia = false;
const generation = 'qa-new', oldGeneration = 'qa-old';
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pinned = /^\/_build\/([^/]+)(\/.*)$/.exec(url.pathname);
    const id = pinned?.[1] || generation;
    const pathname = pinned?.[2] || url.pathname;
    requests.push({ url: req.url, mode });
    if (!pinned && ['/', '/index.html', '/game.html'].includes(pathname) && mode === 'redirect') {
      res.writeHead(302, { location: `/_build/${id}${pathname}${url.search}`, 'cache-control': 'no-store' }); res.end(); return;
    }
    if (pathname.startsWith('/data/resource-routes/')) {
      const value = catalog.get(path.posix.basename(pathname));
      res.writeHead(value ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(value || {})); return;
    }
    if (entries[splitHashedPath(pathname).path] && !originMedia) { res.writeHead(503); res.end('origin model deliberately unavailable'); return; }
    if (pathname === '/healthz' || pathname === '/population') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"online":0}'); return;
    }
    if (/\.(?:html|js|css)$/.test(pathname) || ['/data/assets.json', '/data/local-assets.json', '/'].includes(pathname)) {
      const target = ['/', '/index.html', '/game.html'].includes(pathname) ? '/js/browser/game.html' : pathname;
      const folder = /^\/(shared|data)\//.test(target) ? root : target.startsWith('/sim/') ? path.join(root, 'server') : path.join(root, 'public');
      let content = await fs.readFile(path.join(folder, target));
      if (pathname === '/data/assets.json') {
        const hashUrls = value => typeof value === 'string' ? hashedPath(value, entries[value]?.hash.slice(0, 16))
          : Array.isArray(value) ? value.map(hashUrls) : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hashUrls(item)])) : value;
        content = Buffer.from(JSON.stringify(hashUrls(JSON.parse(content))));
      }
      const type = MIME[path.extname(target)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...(pathname === '/js/resources/worker.js' ? { 'service-worker-allowed': '/' } : {}) });
      res.end(pinText(content.toString(), type, pathname, id)); return;
    }
    await staticHandler(req, res, pathname, url.search.slice(1));
  } catch (error) { res.writeHead(404); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--no-proxy-server', '--enable-unsafe-swiftshader'] });
try {
  for (const scenario of ['redirect', 'legacy', 'pinned-old', 'blocked']) {
    mode = scenario === 'redirect' ? 'redirect' : 'legacy'; originMedia = scenario === 'blocked';
    const context = await browser.createBrowserContext();
    const sessions = [], problems = [], cdnRequests = [], navigation = [];
    const attach = async target => {
      if (target.browserContext() !== context || target.type() !== 'service_worker') return;
      const session = await target.createCDPSession(); sessions.push(session);
      await session.send('Fetch.enable', { patterns: [{ urlPattern: 'https://assets.weishuxieyi.icu/*' }] });
      session.on('Fetch.requestPaused', async event => {
        cdnRequests.push(event.request.url);
        const body = mapped.get(event.request.url);
        await session.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: body ? 200 : 404,
          responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/octet-stream' }],
          body: (body || Buffer.from('missing CDN fixture')).toString('base64') }).catch(() => {});
      });
    };
    const attached = [];
    const onTarget = target => { attached.push(attach(target)); };
    browser.on('targetcreated', onTarget);
    try {
      const beforeNavigation = requests.length;
      const page = await context.newPage();
      await page.setViewport(scenario === 'legacy' ? { width: 844, height: 390, hasTouch: true, isMobile: true } : { width: 1440, height: 900 });
      page.on('pageerror', error => problems.push(error.message));
      page.on('console', message => { if (message.type() === 'error') console.log('browser:', message.text()); });
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigation.push(frame.url()); });
      if (scenario === 'blocked') await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'serviceWorker', { value: undefined }));
      const id = scenario === 'pinned-old' ? oldGeneration : generation;
      const entry = scenario === 'pinned-old' ? `/_build/${id}/game.html` : '/game.html';
      await page.goto(origin + entry + '?room=ABCD#resume', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__SP__, { timeout: 30000 }).catch(async error => {
        report.failure = { scenario, problems, navigation, requests: requests.slice(-20), text: await page.evaluate(() => document.body.innerText) };
        throw error;
      });
      await Promise.all(attached);
      const beforeModels = requests.length;
      const result = await page.evaluate(async ids => {
        const base = new URL('.', location.href).pathname;
        const cache = await import(base + 'js/resources/client.js');
        const at = performance.now();
        const controlled = await cache.waitForResourceController();
        const waitMs = performance.now() - at;
        await window.__SP__.data.loadAll('assets', 'local');
        const { ensurePixi } = await import(base + 'js/render/app/pixi.js'); await ensurePixi();
        const { assets } = await import(base + 'js/assets.js');
        assets.seed(window.__SP__.data.get('assets')); assets.seedLocal(window.__SP__.data.get('local'));
        const app = new PIXI.Application({ width: 900, height: 280, backgroundColor: 0x101716 });
        document.body.append(app.view);
        Object.assign(app.view.style, { position: 'fixed', left: '0', bottom: '0', zIndex: 99999, maxWidth: '100%' });
        const models = [];
        for (const [i, id] of ids.entries()) {
          const entry = assets.spineEntry(id);
          const data = await assets.spine.acquire(entry);
          const unit = new PIXI.spine.Spine(data), box = unit.getLocalBounds();
          const scale = Math.min(220 / Math.max(1, box.width), 240 / Math.max(1, box.height));
          unit.scale.set(scale); unit.position.set(i * 300 + 150 - (box.x + box.width / 2) * scale, 140 - (box.y + box.height / 2) * scale);
          unit.state.setAnimation(0, entry.anims?.idle || data.animations[0].name, true); app.stage.addChild(unit);
          app.renderer.render(app.stage);
          const pixels = app.renderer.extract.pixels(unit); let painted = 0;
          for (let p = 3; p < pixels.length; p += 4) if (pixels[p]) painted++;
          models.push({ id, bones: data.bones.length, animations: data.animations.length, painted });
        }
        return { url: location.href, document: performance.getEntriesByType('navigation')[0].name, controller: navigator.serviceWorker?.controller?.scriptURL,
          controlled, waitMs, models };
      }, ids);
      assert.equal(result.url, origin + `/_build/${id}/game.html?room=ABCD#resume`);
      assert.equal(result.document, result.url);
      const documents = requests.slice(beforeNavigation).filter(r => /\/game\.html(?:\?|$)/.test(r.url));
      assert.ok(documents.length <= 2, 'no document reload loop');
      if (scenario === 'blocked') {
        assert.equal(result.controlled, false); assert.ok(result.waitMs < 500); assert.equal(cdnRequests.length, 0);
      } else {
        assert.equal(result.controlled, true); assert.equal(result.controller, origin + `/_build/${id}/js/resources/worker.js`);
        assert.equal(new Set(cdnRequests).size, Object.keys(entries).length);
        assert.equal(requests.slice(beforeModels).some(r => entries[splitHashedPath(r.url.replace(/^\/_build\/[^/]+/, '').split('?')[0]).path]), false, 'models never reach disabled source');
      }
      for (const model of result.models) assert.ok(model.bones > 0 && model.animations > 0 && model.painted > 100);
      assert.deepEqual(problems, []);
      await page.screenshot({ path: path.join(out, scenario + '.png') });
      report.runs.push({ scenario, ...result, navigation, cdnRequests: cdnRequests.length });
      console.log(JSON.stringify(report.runs.at(-1)));
    } finally { browser.off('targetcreated', onTarget); await context.close(); }
  }
  report.pass = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, error: report.error, failure: report.failure, out }));
}
