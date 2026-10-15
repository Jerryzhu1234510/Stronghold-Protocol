// Controlled localhost comparison and real lobby controls. No production downloads or players.
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = path.resolve('../../outputs/resource-preload-fast-20261013');
mkdirSync(out, { recursive: true });
const root = process.cwd(), before = path.join(out, 'before');
const fixture = Object.fromEntries(Array.from({ length: 64 }, (_, n) => [`/assets/preload-speed-${String(n).padStart(2, '0')}.png`, Buffer.alloc(128 * 1024, n)]));
const manifest = { version: 1, aliases: {}, totalBytes: 64 * 128 * 1024,
  entries: Object.fromEntries(Object.entries(fixture).map(([url, body]) => [url,
    { hash: createHash('sha256').update(body).digest('hex'), bytes: body.length }])) };
const report = { passed: false, errors: [], traffic: {} };
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const [handler] = server.server.listeners('request');
server.server.removeListener('request', handler);
server.server.on('request', (req, res) => {
  const pathname = new URL(req.url, server.url).pathname;
  const variant = /^\/(before|after)\//.exec(pathname)?.[1] || 'ui';
  const rel = variant === 'ui' ? pathname : pathname.slice(variant.length + 1);
  if (rel === '/data/resource-cache.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); }
  else if (fixture[rel]) {
    const data = report.traffic[variant] ||= { active: 0, peak: 0, hits: {}, starts: {}, ends: {} };
    data.hits[rel] = (data.hits[rel] || 0) + 1; data.starts[rel] ||= Date.now();
    data.active++; data.peak = Math.max(data.peak, data.active);
    setTimeout(() => {
      data.active--; data.ends[rel] = Date.now();
      res.setHeader('Cache-Control', 'no-store'); res.end(fixture[rel]);
    }, rel.endsWith('-00.png') ? 1500 : 80);
  } else if (variant !== 'ui' && rel.startsWith('/js/resources/')) {
    const name = 'public' + rel;
    const old = path.join(before, name), file = variant === 'before' && existsSync(old) ? old : path.join(root, name);
    res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Service-Worker-Allowed', '/'); res.end(readFileSync(file));
  } else if (variant !== 'ui' && rel === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>Local preload comparison</title><script type="module">
      import { resourceCacheAction } from './js/resources/client.js';
      import { startResourcePreload } from './js/resources/preload.js';
      window.begin = async () => {
        await resourceCacheAction('clear');
        const start = performance.now();
        let stop;
        stop = startResourcePreload({ enabled: true, manual: true, concurrency: 16,
          onError: error => { window.failure = error.message; },
          onStatus: value => { if(value.preload.state === 'complete') { window.result = { ms: performance.now()-start, value }; stop(); } }
        });
      };
    </script>`);
  } else handler(req, res);
});
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let page;
try {
  report.comparison = {};
  for (const variant of ['before', 'after']) {
    const ctx = await browser.createBrowserContext(); page = await ctx.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(`${server.url}/${variant}/`); await page.waitForFunction(() => typeof window.begin === 'function');
    await page.evaluate(() => window.begin());
    await page.waitForFunction(() => window.result || window.failure, { timeout: 30000 });
    const result = await page.evaluate(() => ({ result: window.result, failure: window.failure }));
    assert.equal(result.failure, undefined); assert.equal(result.result.value.preload.completedBytes, manifest.totalBytes);
    report.comparison[variant] = { elapsedMs: Math.round(result.result.ms), mbPerSecond: +(8 / (result.result.ms / 1000)).toFixed(2),
      peakHttpRequests: report.traffic[variant].peak };
    assert.ok(Object.values(report.traffic[variant].hits).every(n => n === 1));
    await ctx.close();
  }
  const old = report.traffic.before, next = report.traffic.after;
  assert.ok(old.starts['/assets/preload-speed-04.png'] >= old.ends['/assets/preload-speed-00.png'], 'old batch waits for its slowest file');
  assert.ok(next.starts['/assets/preload-speed-16.png'] < next.ends['/assets/preload-speed-00.png'], 'new queue refills while the first file is still slow');
  report.comparison.localSpeedup = +(report.comparison.before.elapsedMs / report.comparison.after.elapsedMs).toFixed(2);
  // HTTP/1.1 in this localhost fixture may impose its own connection cap; the queue limit is tested separately.

  const ctx = await browser.createBrowserContext(); page = await ctx.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.setViewport({ width: 844, height: 390 });
  await page.goto(server.url + '/game.html', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.title-screen');
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('高速预加载验收'));
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  await page.click('.resource-preload__button');
  await page.waitForFunction(() => document.querySelector('.resource-preload__start')?.disabled === false);
  assert.equal(report.traffic.ui, undefined, 'no automatic full-pack download');
  await page.click('.resource-preload__start');
  await page.waitForFunction(() => document.querySelector('.resource-preload__start')?.textContent.includes('暂停'));
  await pause(30); await page.click('.resource-preload__start');
  await pause(1800); const paused = { ...report.traffic.ui?.hits }; await pause(250);
  assert.deepEqual(report.traffic.ui?.hits, paused); assert.ok(Object.keys(paused).length <= 16);
  await page.click('.resource-preload__start'); await pause(30);
  await page.evaluate(async () => (await import('/js/net.js')).net.request('room.create', { mode: 'coop', capacity: 4, difficulty: 'NORMAL' }));
  await page.waitForSelector('.room-screen'); await pause(1800);
  const inRoom = { ...report.traffic.ui.hits }; await pause(250);
  assert.deepEqual(report.traffic.ui.hits, inRoom, 'room entry stops refill'); assert.ok(Object.keys(inRoom).length < 64);
  await page.click('[aria-label="离开同盟"]'); await page.waitForSelector('.lobby-screen');
  await page.click('.resource-preload__button');
  await page.waitForFunction(() => document.querySelector('.resource-preload__start')?.disabled === false);
  await page.click('.resource-preload__start');
  await page.waitForFunction(() => document.querySelector('.resource-preload__button')?.textContent.includes('预加载完成'), { timeout: 30000 });
  assert.equal(Object.keys(report.traffic.ui.hits).length, 64); assert.ok(Object.values(report.traffic.ui.hits).every(n => n === 1));
  report.ui = { pauseResume: true, roomEntryStopsRefill: true, pausedDownloads: Object.keys(paused).length,
    inRoomDownloads: Object.keys(inRoom).length, allDownloadedOnce: true };
  for (const [width, height] of [[844, 390], [1440, 900]]) {
    await page.setViewport({ width, height }); await pause(200);
    await page.screenshot({ path: path.join(out, `preload-${width}.png`) });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.resource-preload__button')?.textContent.includes('预加载完成'));
  assert.ok(Object.values(report.traffic.ui.hits).every(n => n === 1));
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (e) {
  report.failure = e.stack; process.exitCode = 1;
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
  console.log(JSON.stringify({ passed: report.passed, comparison: report.comparison, ui: report.ui, failure: report.failure }));
}
