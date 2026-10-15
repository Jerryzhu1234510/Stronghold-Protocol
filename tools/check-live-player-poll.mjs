/* global document, window, location */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CLEMENTIA_POLL } from '../shared/playerPoll.js';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/player-poll-deploy';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
const report = { errors: [], checks: [], votesSubmitted: 0 };
let base;
page.on('pageerror', e => report.errors.push(e.message));
await page.setRequestInterception(true);
page.on('request', async req => {
  if (new URL(req.url()).pathname.endsWith('/api/player-poll') && req.postData()) {
    const body = JSON.parse(req.postData());
    if (body.action === 'vote') {
      report.votesSubmitted++;
      await req.abort(); return;
    }
  }
  await req.continue();
});
async function open() {
  await page.evaluate(async url => (await import(url + 'js/ui/releaseNotes.js')).closeReleaseNotes(), base);
  await page.waitForSelector('.release-notes', { hidden: true });
  if (!await page.$('.player-poll')) await page.click('.lobby-poll-entry');
  await page.waitForFunction(() => document.querySelector('.player-poll__status')?.textContent === '尚未投票');
  await page.waitForFunction(() => document.querySelector('.player-poll img')?.naturalWidth > 0, { timeout: 30000 });
  await page.mouse.move(0, 0);
  await page.$eval('.player-poll__close', e => e.blur());
  await new Promise(resolve => setTimeout(resolve, 250));
}
try {
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await page.goto('https://weishuxieyi.icu/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.title-screen', { timeout: 90000 });
  base = await page.evaluate(() => location.origin + '/_build/' + window.__SP_GENERATION + '/');
  report.generation = await page.evaluate(() => window.__SP_GENERATION);
  await page.evaluate(async url => (await import(url + 'js/screens/title.js')).enterSession('投票上线验收'), base);
  await page.waitForSelector('.lobby-screen');
  await page.waitForSelector('.release-notes');
  assert.equal(await page.$('.player-poll'), null);
  await open();
  assert.equal(await page.$$eval('.player-poll input[type="radio"]', els => els.length), 4);
  const five = await page.$eval('[data-poll-option="tier5"]', e => e.textContent);
  assert.ok(five.includes('阿戈尔 / 迅捷 / 不屈') && five.includes('击杀2个'));
  assert.ok(await page.$eval('[data-poll-option="unchanged"]', e => e.textContent.includes('不该')));
  assert.equal(await page.$eval('.player-poll__submit', e => e.disabled), true);
  for (const [width, height] of [[1920, 1080], [1366, 768], [844, 390], [740, 360], [667, 375], [568, 320]]) {
    await page.setViewport({ width, height, isMobile: true, hasTouch: true });
    await page.waitForSelector('.lobby-screen');
    await open();
    const geometry = await page.evaluate(() => {
      const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      const modal = document.querySelector('.player-poll');
      return { viewport: [window.innerWidth, window.innerHeight], modal: box(modal),
        body: box(modal.querySelector('.modal__body')), footer: box(modal.querySelector('.modal__actions')),
        overflow: [...modal.querySelectorAll('.player-poll__copy')].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => e.textContent),
        portrait: modal.querySelector('img')?.naturalWidth || 0 };
    });
    assert.ok(geometry.modal.x >= 0 && geometry.modal.right <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.modal.y >= 0 && geometry.modal.bottom <= height + 1, JSON.stringify(geometry));
    assert.ok(geometry.body.bottom <= geometry.footer.y + 1, JSON.stringify(geometry));
    assert.deepEqual(geometry.overflow, []);
    assert.ok(geometry.portrait > 0);
    await page.screenshot({ path: `${out}/live-poll-${width}x${height}.png` });
    await page.click('.player-poll__close');
    await page.waitForSelector('.player-poll', { hidden: true });
    const header = await page.evaluate(() => {
      const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width }; };
      return { title: box(document.querySelector('.lobby-heading h1')), button: box(document.querySelector('.lobby-poll-entry')),
        groups: ['.topbar__left', '.topbar__center', '.topbar__right'].map(s => ({ selector: s, ...box(document.querySelector(s)) })) };
    });
    assert.ok(header.title.width > 0 && header.title.right <= header.button.x, JSON.stringify(header));
    for (const [index, a] of header.groups.entries()) for (const b of header.groups.slice(index + 1)) {
      const overlap = Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
      assert.ok(!overlap, JSON.stringify(header));
    }
    await page.screenshot({ path: `${out}/live-lobby-${width}x${height}.png` });
    report.checks.push({ width, height, geometry, header });
  }
  await open();
  await page.click('.player-poll .btn--secondary');
  await page.waitForSelector('.player-poll__count');
  const tally = await page.evaluate(async url => {
    const { requestPlayerPoll } = await import(url + 'js/ui/playerPollClient.js');
    return requestPlayerPoll('read');
  }, base);
  assert.equal(tally.pollId, CLEMENTIA_POLL.id);
  assert.equal(tally.choice, null);
  assert.equal(tally.options.reduce((sum, option) => sum + option.votes, 0), tally.total);
  report.tally = tally;
  assert.equal(report.votesSubmitted, 0, 'acceptance must never submit a real ballot');
  assert.deepEqual(report.errors, []);
  report.pass = true;
  console.log(JSON.stringify({ pass: true, generation: report.generation, checks: report.checks.length, total: tally.total, votesSubmitted: 0 }));
} catch (error) {
  report.error = error.stack;
  await page.screenshot({ path: `${out}/live-failed.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await writeFile(`${out}/live-browser-verification.json`, JSON.stringify(report, null, 2));
}
