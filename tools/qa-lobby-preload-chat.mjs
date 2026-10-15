/* global document */
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'D:/Codex/2026-10-10/a/outputs/versus-integrated';
mkdirSync(out, { recursive: true });
const report = { passed: false, errors: [], layouts: [] };
const fixture = Object.fromEntries([1, 2, 3].map(n => [`/assets/preload-qa-${n}.png`, Buffer.alloc(16384 * n, n)]));
const manifest = { version: 1, aliases: {}, totalBytes: 98304, entries: Object.fromEntries(Object.entries(fixture)
  .map(([url, bytes]) => [url, { hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }])) };
const hits = {};
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const [handler] = server.server.listeners('request');
server.server.removeListener('request', handler);
server.server.on('request', (req, res) => {
  const path = new URL(req.url, server.url).pathname.replace(/^\/_build\/[^/]+/, '');
  if (path === '/data/resource-cache.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); }
  else if (fixture[path]) { hits[path] = (hits[path] || 0) + 1; res.setHeader('Cache-Control', 'no-store'); res.end(fixture[path]); }
  else handler(req, res);
});
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
page.on('pageerror', e => report.errors.push(e.message));
const request = (t, fields = {}) => page.evaluate(async (t, fields) => (await import('/js/net.js')).net.request(t, fields), t, fields);
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(server.url + '/game.html', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.title-screen');
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('缓存验收博士'));
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  await page.click('.resource-preload__button');
  await page.waitForFunction(() => !document.querySelector('.resource-preload__start')?.disabled);
  assert.deepEqual(hits, {}, 'no bulk download before explicit consent');
  await page.click('.resource-preload__start');
  await page.waitForFunction(() => document.querySelector('.resource-preload__start')?.textContent.includes('暂停'));
  await page.click('.resource-preload__start');
  await pause(1200);
  const paused = { ...hits }; await pause(1200);
  assert.deepEqual(hits, paused, 'pause stops further batches');
  await page.click('.resource-preload__start');
  await page.waitForFunction(() => document.querySelector('.resource-preload__button')?.textContent.includes('预加载完成'));
  assert.equal(Object.keys(hits).length, 3);
  assert.ok(Object.values(hits).every(n => n === 1));
  const status = await page.evaluate(async () => (await import('/js/resources/client.js')).resourceCacheAction());
  assert.equal(status.preload.completedBytes, manifest.totalBytes);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  await page.waitForFunction(() => document.querySelector('.resource-preload__button')?.textContent.includes('预加载完成'));
  const cached = await page.evaluate(async urls => Promise.all(urls.map(async url => {
    const response = await fetch(url, { cache: 'reload' }); await response.arrayBuffer();
    return response.headers.get('x-sp-resource-cache');
  })), Object.keys(fixture));
  assert.deepEqual(cached, ['HIT', 'HIT', 'HIT']);
  assert.ok(Object.values(hits).every(n => n === 1), 're-entering does not redownload cached content');
  report.preload = { manualOnly: true, pauseResume: true, cachedAfterReload: true, completedBytes: status.preload.completedBytes, hits };
  for (const [width, height] of [[1440, 900], [844, 390], [568, 320]]) {
    await page.setViewport({ width, height }); await pause(300);
    await page.click('.resource-preload__button');
    await page.waitForSelector('.resource-preload__panel');
    const bounds = await page.$eval('.resource-preload__panel', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height);
    await page.screenshot({ path: `${out}/lobby-preload-${width}x${height}.png` });
    await page.click('[aria-label="关闭资源预加载"]');
  }
  await page.setViewport({ width: 1440, height: 900 });
  await request('room.create', { mode: 'coop', capacity: 4, difficulty: 'NORMAL', visibility: 'public', description: '本地聊天验收', mapVersion: 'new' });
  await page.waitForSelector('.room-chat__toggle');
  const folded = await page.$eval('.room-chat', el => ({ width: el.clientWidth, height: el.clientHeight }));
  assert.ok(folded.width <= 130 && folded.height <= 34);
  await page.click('.room-chat__toggle'); await page.waitForSelector('#room-chat-input');
  await page.type('#room-chat-input', '本地聊天测试');
  assert.equal(await page.$eval('.room-chat__count', el => el.textContent), '6/200');
  await page.click('[aria-label="发送消息"]');
  await page.waitForFunction(() => document.querySelector('.room-chat__message p')?.textContent === '本地聊天测试');
  for (const [width, height] of [[1440, 900], [844, 390], [568, 320]]) {
    await page.setViewport({ width, height }); await pause(300);
    const bounds = await page.$eval('.room-chat', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height, JSON.stringify(bounds));
    assert.ok(bounds.width <= 400 && bounds.height <= 220);
    await page.screenshot({ path: `${out}/room-chat-${width}x${height}.png` }); report.layouts.push({ width, height, bounds });
  }
  await page.focus('#room-chat-input'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#room-chat-panel'));
  assert.equal(await page.$eval('.room-chat__toggle', el => el === document.activeElement), true);
  await page.click('.room-chat__toggle');
  await page.waitForSelector('.room-chat__message p');
  assert.equal(await page.$eval('.room-chat__message p', el => el.textContent), '本地聊天测试');
  assert.deepEqual(report.errors, []); report.chat = { compactFold: true, sent: true, counter: true, reopenHistory: true, escapeFocus: true }; report.passed = true;
} catch (error) { report.failure = error.stack; await page.screenshot({ path: `${out}/lobby-chat-failure.png` }); throw error; }
finally { writeFileSync(`${out}/lobby-browser.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
