import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'D:/Codex/2026-10-10/a/outputs/lobby-preload-speed';
mkdirSync(out, { recursive: true });
const fixture = Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`/assets/preload-speed-${n}.png`, Buffer.alloc(256 * 1024, n)]));
const manifest = { version: 1, aliases: {}, totalBytes: 20 * 256 * 1024,
  entries: Object.fromEntries(Object.entries(fixture).map(([url, body]) => [url,
    { hash: createHash('sha256').update(body).digest('hex'), bytes: body.length }])) };
const report = { passed: false, errors: [], hits: {} };
let active = 0, peak = 0;
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const [handler] = server.server.listeners('request');
server.server.removeListener('request', handler);
server.server.on('request', (req, res) => {
  const path = new URL(req.url, server.url).pathname;
  if (path === '/data/resource-cache.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); }
  else if (fixture[path]) {
    report.hits[path] = (report.hits[path] || 0) + 1; active++; peak = Math.max(peak, active);
    setTimeout(() => { active--; res.setHeader('Cache-Control', 'no-store'); res.end(fixture[path]); }, 200);
  } else handler(req, res);
});
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (type, fields = {}) => page.evaluate(async (type, fields) => (await import('/js/net.js')).net.request(type, fields), type, fields);
const begin = async () => {
  await page.click('.resource-preload__button');
  await page.waitForFunction(() => document.querySelector('.resource-preload__start')?.disabled === false);
  await page.click('.resource-preload__start');
};
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.setViewport({ width: 844, height: 390 });
  await page.goto(server.url + '/game.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-screen');
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('预加载限速验收'));
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  await begin();
  await page.waitForFunction(() => document.querySelector('.resource-preload__start')?.textContent.includes('暂停'));
  await pause(50); await page.click('.resource-preload__start');
  await pause(500); const paused = { ...report.hits }; await pause(500);
  assert.deepEqual(report.hits, paused, 'pause stops scheduling new batches');
  assert.ok(Object.keys(paused).length < 20);
  await page.click('.resource-preload__start');
  await request('room.create', { mode: 'coop', capacity: 4, difficulty: 'NORMAL' });
  await page.waitForSelector('.room-screen'); await pause(500);
  const inRoom = { ...report.hits }; await pause(500);
  assert.deepEqual(report.hits, inRoom, 'entering a room stops lobby preloading');
  await page.click('[aria-label="离开同盟"]'); await page.waitForSelector('.lobby-screen');
  const start = Date.now(); await begin();
  await page.waitForFunction(() => document.querySelector('.resource-preload__button')?.textContent.includes('预加载完成'), { timeout: 15000 });
  report.resumeMs = Date.now() - start;
  assert.equal(Object.keys(report.hits).length, 20);
  assert.ok(Object.values(report.hits).every(n => n === 1));
  assert.equal(peak, 4); report.peakConcurrent = peak;
  report.status = await page.evaluate(async () => (await import('/js/resources/client.js')).resourceCacheAction());
  assert.equal(report.status.preload.completedBytes, manifest.totalBytes);
  for (const [width, height] of [[844, 390], [1440, 900]]) {
    await page.setViewport({ width, height }); await pause(200);
    await page.screenshot({ path: `${out}/preload-${width}x${height}.png` });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.resource-preload__button')?.textContent.includes('预加载完成'));
  assert.ok(Object.values(report.hits).every(n => n === 1), 'cache survives reload');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) {
  report.failure = error.stack; await page.screenshot({ path: out + '/failure.png' }); process.exitCode = 1;
} finally {
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
  console.log(JSON.stringify({ passed: report.passed, peak, resumeMs: report.resumeMs, failure: report.failure }));
}
