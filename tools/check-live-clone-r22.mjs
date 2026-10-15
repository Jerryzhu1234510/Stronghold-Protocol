/* global document, window */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { TestClient } from '../test/helpers/wsClient.js';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/clone-r22-deploy';
const reportFile = `${out}/deployment.json`;
const deployment = JSON.parse(await readFile(reportFile, 'utf8'));
const generation = deployment.generation;
const home = 'https://weishuxieyi.icu';
const base = `${home}/_build/${generation}/`;
const report = { generation, checks: [], errors: [], pass: false };
const pause = ms => new Promise(r => setTimeout(r, ms));

if (process.argv.includes('--announcement')) {
  assert.ok(deployment.announcementSent);
  for (const id of [...Object.keys(deployment.healthBefore), generation]) {
    const client = await TestClient.connect(`${home.replace('https:', 'wss:')}/_build/${id}/ws`, { timeout: 15000, wsOptions: { origin: home } });
    try {
      await client.hello('滚动公告核验');
      const frame = await client.waitFor('server.announcement', f => f.announcement?.text === deployment.announcement, 15000);
      report.checks.push({ generation: id, announcement: frame.announcement });
    } finally { await client.close(); }
  }
  deployment.announcementVerified = true;
  report.pass = true;
  await writeFile(reportFile, JSON.stringify(deployment, null, 2));
  await writeFile(`${out}/announcement-verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ announcementVerified: true, versions: report.checks.map(c => c.generation) }));
} else {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage();
  let inRoom = false;
  const request = (t, p = {}) => page.evaluate(async (url, type, payload) => (await import(url + 'js/net.js')).net.request(type, payload), base, t, p);
  const state = () => page.evaluate(async url => (await import(url + 'js/store.js')).store.get().match.public, base);
  try {
    page.on('pageerror', e => report.errors.push(e.message));
    await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.title-screen', { timeout: 90000 });
    assert.ok(page.url().includes(generation));
    assert.equal(await page.evaluate(() => window.__SP_GENERATION), generation);
    assert.equal(await page.$('.integration-stage-label'), null);
    await page.evaluate(async url => (await import(url + 'js/screens/title.js')).enterSession('克隆上线核验'), base);
    await page.waitForSelector('.lobby-screen');
    await page.waitForFunction(async url => (await import(url + 'js/store.js')).store.get().connection.status === 'online', {}, base);
    await page.waitForSelector('.release-notes');
    assert.ok(await page.$eval('.release-notes', e => e.textContent.includes('由房主在“棋盘外观”右侧')));
    await page.evaluate(async url => (await import(url + 'js/ui/releaseNotes.js')).closeReleaseNotes(), base);
    assert.ok(await page.$eval('[data-testid="loadout-open"]', e => e.textContent.includes('记录/调配')));
    await page.click('[data-testid="loadout-open"]');
    await page.waitForSelector('[data-tab="history"]');
    await page.click('[data-tab="history"]');
    await page.waitForSelector('.match-history__empty');
    assert.ok(await page.evaluate(() => [...document.styleSheets].some(s => s.href?.includes('match-history.css'))));
    await page.screenshot({ path: `${out}/live-history-844x390.png` });
    await page.evaluate(async url => (await import(url + 'js/ui/loadoutSync.js')).closeLoadout(), base);
    report.checks.push('new entry, announcement, history tab and history CSS');
    for (const capacity of [5, 8]) {
      await request('room.create', { mode: 'coop', difficulty: 'FUNNY', capacity, experimentalAccepted: true, visibility: 'private' });
      inRoom = true;
      for (let i = 1; i < capacity; i++) await request('room.addBot');
      await request('room.start');
      await page.waitForSelector('.brief-bond');
      const pub = await state();
      assert.equal(pub.gameMode, 'normal');
      assert.equal(pub.staticInactiveBonds.length, capacity === 5 ? 8 : 6);
      assert.equal(pub.drawnDisabledBonds.length, 0);
      assert.deepEqual(await page.$$eval('.brief-bond.is-off', els => els.map(e => e.dataset.bond).sort()), [...pub.staticInactiveBonds].sort());
      await page.screenshot({ path: `${out}/live-normal-${capacity}-844x390.png` });
      report.checks.push(`normal ${capacity} capacity fixed bans match server`);
      await page.evaluate(async url => (await import(url + 'js/ui/matchChrome.js')).quitMatch(), base);
      inRoom = false;
      await page.waitForSelector('.lobby-screen');
    }
    await request('room.create', { mode: 'coop', difficulty: 'ABYSS', capacity: 4, visibility: 'private' });
    inRoom = true;
    await page.waitForSelector('.room-screen');
    await page.select('.room-mode-picker select', 'clone');
    await page.waitForSelector('.room-clone-note');
    await page.screenshot({ path: `${out}/live-clone-room-844x390.png` });
    for (let i = 0; i < 3; i++) await request('room.addBot');
    await request('room.start');
    await page.waitForSelector('.brief-bond');
    await request('g.infoReady');
    await page.waitForSelector('.dband');
    await page.waitForFunction(async url => Object.keys((await import(url + 'js/store.js')).store.get().match.public?.draft?.votes || {}).length === 3, {}, base);
    await page.screenshot({ path: `${out}/live-clone-vote-844x390.png` });
    await page.click('[data-band="band_ducklord"]');
    await page.evaluate(() => [...document.querySelectorAll('.draft-detail__btns button')].find(e => e.textContent.includes('确认投票'))?.click());
    await page.waitForFunction(async url => (await import(url + 'js/store.js')).store.get().match.public?.phase === 'BATTLE_CHECK', { timeout: 5000 }, base);
    const pub = await state();
    assert.equal(pub.gameMode, 'clone');
    assert.equal(new Set(pub.players.map(p => p.bandId)).size, 1);
    await page.waitForSelector('.shop-focus select', { timeout: 30000 });
    await page.waitForFunction(async url => ['SP_DRAFT', 'PREP'].includes((await import(url + 'js/store.js')).store.get().match.public?.phase), { timeout: 30000 }, base);
    if ((await state()).phase === 'SP_DRAFT') {
      await page.waitForFunction(async url => {
        const s = (await import(url + 'js/store.js')).store.get();
        return s.match.public?.sp?.turn === s.me.playerId;
      }, { timeout: 30000 }, base);
      const sp = (await state()).sp;
      await request('g.choice', { idx: sp.cards.find(c => sp.taken[c.idx] == null).idx });
    }
    await page.waitForSelector('.gtop__prep-actions .readybtn', { timeout: 30000 });
    await page.waitForSelector('.prep-vote__tools button');
    await pause(1200);
    const controls = await page.$$eval('.gtop__prep-actions .readybtn, .prep-vote__tools button', els => els.map(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: e.textContent, y: r.y, bottom: r.bottom, right: r.right, reached: !!hit && e.contains(hit) };
    }));
    assert.ok(controls.length >= 2, 'single-human untimed rooms omit the add-time button');
    for (const c of controls) assert.ok(c.reached && c.bottom <= 391 && c.right <= 845, JSON.stringify(c));
    assert.ok(controls.slice(1).every(c => controls[0].bottom + 2 <= c.y));
    await page.screenshot({ path: `${out}/live-clone-prep-844x390.png` });
    report.checks.push('clone selection, simultaneous bot votes, immediate all-confirm finish, shared strategy, mobile prep controls');
    assert.deepEqual(report.errors, []);
    report.pass = true;
    deployment.liveVerified = true;
    await writeFile(reportFile, JSON.stringify(deployment, null, 2));
    console.log(JSON.stringify(report));
  } catch (e) {
    report.error = e.stack;
    throw e;
  } finally {
    if (inRoom) {
      await page.evaluate(async url => (await import(url + 'js/ui/matchChrome.js')).quitMatch(), base).catch(() => {});
    }
    await browser.close();
    await writeFile(`${out}/live-verification.json`, JSON.stringify(report, null, 2));
  }
}
