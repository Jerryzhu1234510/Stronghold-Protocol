/* global document, window */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPlayerPollService, PlayerPollStore } from '../server/playerPollService.js';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/player-poll-deploy';
await mkdir(out, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'stronghold-poll-browser-'));
const file = join(dir, 'votes.json');
const service = await startPlayerPollService({ file, port: 0, origin: 'http://localhost:8922' });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const report = { errors: [], checks: [] };
let fail = false;
async function enter(width, height) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async req => {
    if (new URL(req.url()).pathname !== '/api/player-poll') { await req.continue(); return; }
    if (fail) { await req.respond({ status: 503, contentType: 'application/json', body: '{}' }); return; }
    const response = await fetch(service.url + '/api/player-poll', { method: req.method(),
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8922' }, body: req.postData() });
    await req.respond({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  await page.goto('http://localhost:8922', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-screen');
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('正式投票验收'));
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(async () => {
    window.__SP_GENERATION = 'poll-browser-qa';
    (await import('/js/ui/releaseNotes.js')).closeReleaseNotes();
  });
  await page.waitForSelector('.player-poll');
  await page.waitForFunction(() => document.querySelector('.player-poll__status')?.textContent === '尚未投票');
  return { context, page };
}
try {
  const a = await enter(844, 390);
  await a.page.click('[data-poll-option="tier5"]');
  await a.page.click('.player-poll__submit');
  await a.page.waitForFunction(() => document.querySelector('.player-poll__status')?.textContent === '已提交');
  assert.equal(service.store.snapshot().total, 1);
  await a.page.click('.player-poll__submit');
  await a.page.click('[data-poll-option="unchanged"]');
  await a.page.click('.player-poll__submit');
  await a.page.waitForFunction(() => document.querySelector('[data-poll-option="unchanged"] .player-poll__count')?.textContent === '1票 · 100%');
  assert.equal(service.store.snapshot().total, 1);
  report.checks.push('submit and replacement count exactly one ballot');
  const b = await enter(1366, 768);
  await b.page.click('[data-poll-option="tier6"]');
  await b.page.click('.player-poll__submit');
  await b.page.waitForFunction(() => document.querySelector('.player-poll__meta')?.textContent === '累计票数 2');
  assert.equal(service.store.snapshot().total, 2);
  await b.page.screenshot({ path: `${out}/server-result-desktop.png` });
  await a.page.click('.player-poll__close');
  await a.page.click('[data-testid="player-poll-open"]');
  await a.page.waitForFunction(() => document.querySelector('.player-poll__meta')?.textContent === '累计票数 2');
  await a.page.mouse.move(0, 0);
  await a.page.$eval('.player-poll__close', e => e.blur());
  await a.page.screenshot({ path: `${out}/server-result-mobile.png` });
  report.checks.push('independent browser sees aggregated real counts');
  const restarted = new PlayerPollStore(file); await restarted.load();
  assert.deepEqual(restarted.snapshot(), service.store.snapshot());
  report.checks.push('accepted ballots survive store restart');
  fail = true;
  await a.page.click('.player-poll__submit');
  await a.page.click('[data-poll-option="tier4"]');
  await a.page.click('.player-poll__submit');
  await a.page.waitForSelector('.player-poll__status.is-error');
  assert.equal(service.store.snapshot().options.find(o => o.id === 'tier4').votes, 0);
  report.checks.push('failed request is not acknowledged as a submitted vote');
  fail = false;
  await a.page.click('.player-poll .btn--secondary');
  await a.page.waitForFunction(() => !document.querySelector('.player-poll__status.is-error'));
  report.checks.push('retry restores authoritative server choice');
  assert.deepEqual(report.errors, []);
  report.pass = true;
  console.log(JSON.stringify(report));
} catch (error) { report.error = error.stack; throw error; }
finally {
  await browser.close(); await service.close();
  await rm(dir, { recursive: true, force: true });
  await writeFile(`${out}/server-browser-verification.json`, JSON.stringify(report, null, 2));
}
