/* global document, window, location */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/player-poll-preview';
await mkdir(out, { recursive: true });
const report = { checks: [], errors: [] };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', error => report.errors.push(error.message));
let base;
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
async function closeNotes() {
  await page.evaluate(async url => (await import(url + 'js/ui/releaseNotes.js')).closeReleaseNotes(), base);
  await page.waitForSelector('.release-notes', { hidden: true });
}
async function openPoll() {
  await closeNotes();
  if (!await page.$('.player-poll')) await page.click('[data-testid="player-poll-open"]');
  await page.waitForSelector('.player-poll');
  await pause();
  await page.mouse.move(0, 0);
  await page.$eval('.player-poll__options', e => { e.tabIndex = -1; e.focus(); e.blur(); });
  await pause();
}
async function capture(name, width, height) {
  await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
  await page.waitForSelector('.lobby-screen');
  await openPoll();
  const geometry = await page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const modal = document.querySelector('.player-poll');
    return { viewport: [window.innerWidth, window.innerHeight], modal: box(modal),
      body: box(modal.querySelector('.modal__body')), footer: box(modal.querySelector('.modal__actions')),
      options: [...modal.querySelectorAll('.player-poll__option')].map(box),
      overflow: [...modal.querySelectorAll('.player-poll__copy')].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => e.textContent),
      clippedButtons: [...modal.querySelectorAll('.btn__label')].filter(e => {
        const a = e.getBoundingClientRect(), b = e.parentElement.getBoundingClientRect();
        return a.left < b.left || a.right > b.right || a.top < b.top || a.bottom > b.bottom;
      }).map(e => e.textContent),
      portrait: modal.querySelector('img')?.naturalWidth || 0 };
  });
  assert.ok(geometry.modal.x >= 0 && geometry.modal.right <= width + 1, JSON.stringify(geometry));
  assert.ok(geometry.modal.y >= 0 && geometry.modal.bottom <= height + 1, JSON.stringify(geometry));
  assert.ok(geometry.body.bottom <= geometry.footer.y + 1, JSON.stringify(geometry));
  assert.deepEqual(geometry.overflow, []);
  assert.deepEqual(geometry.clippedButtons, []);
  assert.ok(geometry.portrait > 0, 'portrait loaded');
  await page.screenshot({ path: `${out}/${name}-${width}x${height}.png` });
  report.checks.push({ name, width, height, geometry });
}
try {
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto('http://localhost:8922', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.title-screen', { timeout: 90000 });
  base = await page.evaluate(() => location.origin + '/');
  await page.evaluate(async url => (await import(url + 'js/screens/title.js')).enterSession('投票本地验收'), base);
  await page.waitForSelector('.lobby-screen');
  await page.waitForSelector('.release-notes');
  assert.equal(await page.$('.player-poll'), null, 'announcement opens before poll');
  await closeNotes();
  await page.waitForSelector('.player-poll');
  assert.equal(await page.$$eval('.player-poll input[type="radio"]', els => els.length), 4);
  assert.equal(await page.$eval('.player-poll__submit', e => e.disabled), true);
  for (const [w, h] of [[1920, 1080], [1366, 768], [844, 390], [740, 360], [667, 375], [568, 320]]) await capture('vote', w, h);
  await page.click('[data-poll-option="tier6"]');
  await page.click('.player-poll__submit');
  await page.waitForFunction(() => document.querySelector('.player-poll__meta')?.textContent === '预览票数 1');
  assert.equal(await page.$eval('[data-poll-option="tier6"] .player-poll__count', e => e.textContent), '1票 · 100%');
  await capture('result', 844, 390);
  await page.click('.player-poll__submit');
  await page.click('[data-poll-option="unchanged"]');
  await page.click('.player-poll__submit');
  assert.equal(await page.$eval('[data-poll-option="unchanged"] .player-poll__count', e => e.textContent), '1票 · 100%');
  assert.equal(await page.$eval('[data-poll-option="tier6"] .player-poll__count', e => e.textContent), '0票 · 0%');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.player-poll', { hidden: true });
  const heading = await page.evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
    return { title: rect(document.querySelector('.lobby-heading h1')), button: rect(document.querySelector('.lobby-poll-entry')) };
  });
  assert.ok(heading.title.right <= heading.button.x, JSON.stringify(heading));
  await page.screenshot({ path: `${out}/lobby-entry-844x390.png` });
  await page.click('[data-testid="player-poll-open"]');
  await page.waitForSelector('.player-poll');
  await page.waitForFunction(() => !!document.activeElement.closest('.player-poll'));
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('.player-poll')), 'keyboard focus stays in modal');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.lobby-screen');
  await closeNotes();
  await page.waitForSelector('.player-poll');
  assert.equal(await page.$eval('[data-poll-option="unchanged"] .player-poll__count', e => e.textContent), '1票 · 100%');
  assert.deepEqual(report.errors, []);
  report.pass = true;
  console.log(JSON.stringify({ pass: true, checks: report.checks.length, persistence: true, changeVote: true, announcementQueue: true }));
} catch (error) {
  report.error = error.stack;
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await writeFile(`${out}/verification.json`, JSON.stringify(report, null, 2));
}
