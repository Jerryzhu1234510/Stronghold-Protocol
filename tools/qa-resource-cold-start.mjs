/* global createImageBitmap, window, document, PIXI */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';
import { createStaticHandler } from '../server/http/static.js';
import { versusCatalog } from '../server/versus/http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = process.env.RESOURCE_MANIFEST;
if (!manifestFile) throw new Error('Set RESOURCE_MANIFEST to the uploaded resource-cache.json');
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const catalog = resourceRoutingCatalog(manifest);
const out = path.resolve(process.env.RESOURCE_QA_OUT || path.join(root, 'test/e2e/out/resource-cold'));
await fs.mkdir(out, { recursive: true });
const liveCdn = process.argv.includes('--live-cdn');
const mapped = new Map(Object.entries(manifest.entries).filter(([, item]) => item.cdn).map(([pathname, item]) => [item.cdn, pathname]));
const publicDir = path.join(root, 'public');
const staticHandler = createStaticHandler({ publicDir, dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared') });
const requests = [], timers = new Set();
let allowOrigin = null;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/^\/_build\/[^/]+/, '');
  requests.push(pathname);
  if (pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
  if (pathname === '/versus/catalog') { versusCatalog(req, res); return; }
  if (pathname === '/data/resource-cache.json') {
    const timer = setTimeout(() => { timers.delete(timer); res.writeHead(503); res.end('full catalog deliberately stalled'); }, 30000);
    timers.add(timer); return;
  }
  if (pathname.startsWith('/data/resource-routes/')) {
    const value = catalog.get(path.posix.basename(pathname));
    res.writeHead(value ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
    res.end(JSON.stringify(value || {})); return;
  }
  if (manifest.entries[pathname] && pathname !== allowOrigin) {
    res.writeHead(503); res.end('origin media deliberately unavailable'); return;
  }
  try { await staticHandler(req, res, pathname, url.search.slice(1)); }
  catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const map = '/assets/local/map/autochess/TX_autochessi_D.png';
const bg = '/assets/local/map/autochess/TX_autochessi_BG.png';
const skel = '/assets/spine/op/char_4202_haruka/front/char_4202_haruka.skel';
const report = { liveCdn, runs: [], pass: false };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-proxy-server', '--enable-unsafe-swiftshader'] });
try {
  if (liveCdn) {
    // Use the allowed game origin without loading or changing its deployed application.
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (new URL(request.url()).origin === 'https://weishuxieyi.icu') {
          request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Resource QA</title>' });
        } else request.continue();
      });
      await page.goto('https://weishuxieyi.icu/resource-cold-start-qa');
      const files = [map, bg, skel, skel.replace(/\.skel$/, '.atlas'), skel.replace(/\.skel$/, '.png')];
      report.liveDownloads = await page.evaluate(async files => {
        const results = [];
        for (const [pathname, item] of files) {
          const started = performance.now();
          const response = await fetch(item.cdn, { credentials: 'omit', cache: 'reload', signal: AbortSignal.timeout(30000) });
          const body = await response.arrayBuffer();
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(n => n.toString(16).padStart(2, '0')).join('');
          const row = { pathname, status: response.status, bytes: body.byteLength, correct: hash === item.hash,
            seconds: (performance.now() - started) / 1000 };
          if (pathname.endsWith('.png')) {
            const bitmap = await createImageBitmap(new Blob([body]));
            row.dimensions = [bitmap.width, bitmap.height]; bitmap.close();
          }
          results.push(row);
        }
        return results;
      }, files.map(name => [name, manifest.entries[name]]));
      for (const row of report.liveDownloads) {
        assert.equal(row.status, 200); assert.equal(row.bytes, manifest.entries[row.pathname].bytes); assert.ok(row.correct);
      }
      console.log(JSON.stringify({ liveDownloads: report.liveDownloads }));
    } finally { await context.close(); }
  }
  for (const [name, viewport, noLocks] of [
    ['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 844, height: 390, isMobile: true, hasTouch: true }, false],
    ['no-web-locks', { width: 844, height: 390 }, true],
  ]) {
    const context = await browser.createBrowserContext();
    const problems = [];
    let page;
    try {
      page = await context.newPage(); await page.setViewport(viewport);
      page.on('pageerror', error => problems.push(error.message));
      page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
      const first = requests.length;
      const start = Date.now();
      await page.goto(origin + '/healthz');
      const registration = await page.evaluate(async noLocks => {
        if (noLocks) Object.defineProperty(navigator, 'locks', { get: () => undefined });
        const mod = await import('/js/resources/client.js'); await mod.startResourceCache(); await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        return { cacheSupported: mod.cacheSupported(), controller: navigator.serviceWorker.controller.scriptURL };
      }, noLocks);
      const activationSeconds = (Date.now() - start) / 1000;
      assert.ok(activationSeconds < 5, 'activation does not wait on the full catalog');
      assert.equal(requests.slice(first).includes('/data/resource-cache.json'), false);
      const target = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url() === origin + '/js/resources/worker.js' && t.browserContext() === context);
      const cdp = await target.createCDPSession();
      const cdnRequests = [];
      if (noLocks) await cdp.send('Runtime.evaluate', { expression: "Object.defineProperty(navigator, 'locks', {get: () => undefined})" });
      {
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://assets.weishuxieyi.icu/*' }] });
        cdp.on('Fetch.requestPaused', async e => {
          cdnRequests.push(e.request.url);
          try {
            assert.equal(Object.keys(e.request.headers).some(k => ['authorization', 'cookie'].includes(k.toLowerCase())), false);
            const pathname = mapped.get(e.request.url);
            const body = pathname && await fs.readFile(path.join(publicDir, decodeURIComponent(pathname.slice(1))));
            await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: body ? 200 : 404,
              responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/octet-stream' }],
              body: (body || Buffer.from('missing fixture')).toString('base64') });
          } catch { await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' }).catch(() => {}); }
        });
      }
      const resource = await page.evaluate(async map => {
        const start = performance.now(); const response = await fetch(map); const bytes = await response.arrayBuffer();
        const bitmap = await createImageBitmap(new Blob([bytes]));
        return { seconds: (performance.now() - start) / 1000, bytes: bytes.byteLength, width: bitmap.width,
          height: bitmap.height, source: response.headers.get('x-sp-resource-source') };
      }, map);
      assert.equal(resource.source, 'r2'); assert.equal(resource.bytes, manifest.entries[map].bytes);
      assert.ok(resource.width > 0 && resource.height > 0);
      if (!noLocks) {
        const reused = await page.evaluate(async map => (await fetch(map)).headers.get('x-sp-resource-cache'), map);
        assert.equal(reused, 'HIT');
        await page.goto(origin + '/versus.html?embedded=1');
        await page.waitForFunction(() => !!window.__versusView, { timeout: 30000 });
        await page.evaluate(() => window.__versusView.setBoardMode('3d'));
        await page.waitForFunction(() => window.__versusView.stats().board3d.on, { timeout: 30000 });
        const model = await page.evaluate(async skel => {
          const { loadSpineData } = await import('/js/assets.js');
          const data = await loadSpineData({ skel });
          const app = new PIXI.Application({ width: 200, height: 200, backgroundAlpha: 0 });
          Object.assign(app.view.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '9999', pointerEvents: 'none' });
          document.body.append(app.view);
          const unit = new PIXI.spine.Spine(data); app.stage.addChild(unit);
          const box = unit.getLocalBounds(); const scale = Math.min(160 / Math.max(1, box.width), 160 / Math.max(1, box.height));
          unit.scale.set(scale); unit.position.set(100 - (box.x + box.width / 2) * scale, 100 - (box.y + box.height / 2) * scale);
          unit.state.setAnimation(0, data.animations[0].name, true); app.renderer.render(app.stage);
          const pixels = app.renderer.extract.pixels(app.stage); let painted = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
          return { bones: data.bones.length, animations: data.animations.length, painted, board: window.__versusView.stats().board3d };
        }, skel);
        assert.ok(model.bones > 0 && model.animations > 0 && model.painted > 100);
        await page.screenshot({ path: path.join(out, name + '.png') });
        resource.model = model;
      }
      const status = await page.evaluate(async () => (await import('/js/resources/client.js')).resourceCacheAction('status'));
      assert.equal(requests.slice(first).includes('/data/resource-cache.json'), false);
      assert.equal(requests.slice(first).some(p => Object.hasOwn(manifest.entries, p)), false, 'no origin media downloads');
      if (noLocks) assert.equal(status.files, 0);
      report.runs.push({ name, activationSeconds, registration, resource, status, cdnRequests: cdnRequests.length });
      console.log(JSON.stringify(report.runs.at(-1)));
    } catch (error) {
      report.failure = { name, problems, recentRequests: requests.slice(-25), text: await page?.evaluate(() => document.body.innerText).catch(() => '') };
      await page?.screenshot({ path: path.join(out, name + '-failure.png') }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  report.pass = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  await browser.close(); for (const timer of timers) clearTimeout(timer);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(out, 'report' + (liveCdn ? '-live' : '') + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, error: report.error, failure: report.failure, out }));
}
