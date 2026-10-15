/* global document, window */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const live = process.argv.includes('--live');
const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/population-update';
const home = live ? 'https://weishuxieyi.icu' : process.env.SP_PREVIEW_URL || 'http://localhost:8922';
const report = { live, checks: [], errors: [] };
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
let base, inRoom = false;
const state = () => page.evaluate(async url => (await import(url + 'js/store.js')).store.get(), base);
const request = (t, payload = {}) => page.evaluate(async (url, type, p) => (await import(url + 'js/net.js')).net.request(type, p), base, t, payload);
async function check(screen, width, height) {
  await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
  await page.waitForSelector('.population-strip');
  await page.waitForFunction(() => document.querySelector('[data-population="online"] strong')?.textContent.match(/^\d+$/), { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.release-notes', { hidden: true });
  await new Promise(r => setTimeout(r, 400));
  const geometry = await page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const metrics = [...document.querySelectorAll('[data-population]')].map(e => ({ key: e.dataset.population,
      box: box(e), label: box(e.querySelector('small')), value: box(e.querySelector('strong')) }));
    const selectors = document.querySelector('.room-screen')
      ? ['.topbar__left', '.topbar__center', '.topbar__right'] : ['.topbar__left', '.topbar__right'];
    return { viewport: [window.innerWidth, window.innerHeight], strip: box(document.querySelector('.population-strip')),
      metrics, header: selectors.map(s => ({ selector: s, ...box(document.querySelector(s)) })) };
  });
  assert.equal(geometry.metrics.length, 5);
  assert.ok(geometry.strip.x >= 0 && geometry.strip.right <= geometry.viewport[0] + 1);
  for (const metric of geometry.metrics) {
    assert.ok(metric.label.right + 2 <= metric.value.x, JSON.stringify(metric));
    assert.ok(metric.label.x >= metric.box.x - 1 && metric.value.right <= metric.box.right + 1, JSON.stringify(metric));
  }
  for (const [i, a] of geometry.header.entries()) for (const b of geometry.header.slice(i + 1)) {
    const overlap = Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
    assert.ok(!overlap, JSON.stringify({ a, b }));
  }
  await page.screenshot({ path: `${out}/${live ? 'live' : 'local'}-${screen}-${width}x${height}.png` });
  report.checks.push({ screen, width, height, geometry });
}
try {
  page.on('pageerror', e => report.errors.push(e.message));
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.title-screen', { timeout: 90000 });
  base = await page.evaluate(() => location.origin + (window.__SP_GENERATION ? '/_build/' + window.__SP_GENERATION + '/' : '/'));
  await page.evaluate(async url => (await import(url + 'js/screens/title.js')).enterSession('人数布局验收'), base);
  await page.waitForSelector('.lobby-screen');
  assert.equal(await page.$('.player-poll'), null);
  assert.equal(await page.$('.player-poll-entry'), null);
  await page.waitForFunction(async url => (await import(url + 'js/store.js')).store.get().connection.status === 'online', {}, base);
  await page.waitForSelector('.release-notes', { timeout: 5000 }).catch(() => {});
  await page.evaluate(async url => (await import(url + 'js/ui/releaseNotes.js')).closeReleaseNotes(), base);
  await page.waitForSelector('.release-notes', { hidden: true });
  await page.waitForFunction(() => document.querySelector('[data-population="online"] strong')?.textContent.match(/^\d+$/), { timeout: 15000 });
  report.actual = await page.$$eval('[data-population]', els => Object.fromEntries(els.map(e => [e.dataset.population, Number(e.querySelector('strong').textContent)])));
  assert.equal(report.actual.online, report.actual.inGame + report.actual.lobby + report.actual.waiting + report.actual.spectators);
  await check('lobby-real', 844, 390);
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (new URL(r.url()).pathname.endsWith('/healthz')) r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true,
      onlinePlayers: 12345, onlineHumans: 12300, onlineInMatches: 12000, onlineSpectators: 20 }) });
    else r.continue();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelector('[data-population="online"] strong')?.textContent === '12345', { timeout: 15000 });
  for (const [w, h] of [[1920, 1080], [1366, 768], [844, 390], [740, 360], [667, 375], [568, 320]]) await check('lobby', w, h);
  await request('room.create', { mode: 'coop', difficulty: 'ABYSS', capacity: 8, experimentalAccepted: true, visibility: 'private' });
  inRoom = true;
  await page.waitForSelector('.room-screen');
  await page.waitForFunction(() => document.querySelector('[data-population="online"] strong')?.textContent === '12345', { timeout: 15000 });
  for (const [w, h] of [[1920, 1080], [1366, 768], [844, 390], [740, 360], [667, 375], [568, 320]]) await check('room', w, h);
  assert.deepEqual(report.errors, []);
  report.pass = true;
  console.log(JSON.stringify({ pass: true, live, checks: report.checks.length, actual: report.actual }));
} catch (error) {
  report.error = error.stack;
  await page.screenshot({ path: `${out}/${live ? 'live' : 'local'}-failed.png` }).catch(() => {});
  throw error;
} finally {
  if (inRoom) await request('room.leave').catch(() => {});
  await browser.close();
  await writeFile(`${out}/${live ? 'live' : 'local'}-browser.json`, JSON.stringify(report, null, 2));
}
