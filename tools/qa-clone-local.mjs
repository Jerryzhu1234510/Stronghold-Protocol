/* global document, window, innerWidth, innerHeight */
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/clone-mode-qa';
mkdirSync(out, { recursive: true });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const base = `http://127.0.0.1:${server.port}`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const results = [], errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function request(page, type, payload = {}) {
  return page.evaluate(async (t, p) => (await import('/js/net.js')).net.request(t, p), type, payload);
}
async function session(name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-screen');
  await page.evaluate(async n => (await import('/js/screens/title.js')).enterSession(n), name);
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async () => (await import('/js/store.js')).store.get().connection.status === 'online');
  await page.waitForSelector('.release-notes');
  assert.ok(await page.$eval('.release-notes', e => e.textContent.includes('由房主在“棋盘外观”右侧')));
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  assert.ok(await page.$eval('[data-testid="loadout-open"]', e => e.textContent.includes('记录/调配')));
  return page;
}
async function metrics(page, selectors) {
  return page.evaluate(sels => ({ width: innerWidth, height: innerHeight, rects: sels.flatMap(selector => [...document.querySelectorAll(selector)].map(e => {
    const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { selector, text: e.textContent.trim().slice(0, 50), x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, disabled: e.disabled,
      reached: !!hit && (e.contains(hit) || hit.contains(e)) };
  })) }), selectors);
}
function reachable(m, tag) {
  for (const r of m.rects) assert.ok(r.reached && r.x >= -1 && r.y >= -1 && r.right <= m.width + 1 && r.bottom <= m.height + 1, `${tag}: ${r.selector} ${r.text}: ${JSON.stringify(r)}`);
}
const sizes = [[1440, 900, false], [960, 432, true], [933, 421, true], [844, 390, true], [667, 375, true], [640, 360, true], [640, 320, true]];
try {
  const host = await session('克隆本地验收房主');
  await request(host, 'room.create', { mode: 'coop', difficulty: 'ABYSS', capacity: 4, visibility: 'public', description: '克隆模式本地验收' });
  await host.waitForSelector('.room-screen');
  assert.equal(await host.$('.room-clone-note'), null);
  await host.select('.room-mode-picker select', 'clone');
  await host.waitForSelector('.room-clone-note');
  const code = await host.evaluate(async () => (await import('/js/store.js')).store.get().room.code);
  const member = await session('克隆本地验收队友');
  await request(member, 'room.join', { code });
  await member.waitForSelector('.room-mode-picker select:disabled');
  const denial = await member.evaluate(async () => {
    try { await (await import('/js/net.js')).net.request('room.setGameMode', { gameMode: 'normal' }); return null; } catch (e) { return e.code; }
  });
  assert.equal(denial, 'NOT_HOST');
  for (const capacity of [4, 8]) {
    await request(host, 'room.setCapacity', { capacity, experimentalAccepted: true });
    for (const [width, height, touch] of sizes) {
      await host.setViewport({ width, height, hasTouch: touch, isMobile: touch });
      await pause(500);
      await host.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
      await pause(120);
      const m = await metrics(host, ['.room-options select', '.room-bar__right button', '.room-clone-note']);
      results.push({ tag: 'room', capacity, ...m });
      await host.screenshot({ path: `${out}/room-${capacity}-${width}x${height}.png` });
      reachable(m, `room ${capacity} ${width}x${height}`);
    }
  }
  await host.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await request(host, 'room.setCapacity', { capacity: 4 });
  await request(host, 'room.addBot');
  await request(host, 'room.addBot');
  await request(member, 'room.ready', { ready: true });
  await request(host, 'room.start');
  const match = server.lobby.rooms.get(code).match;
  match.enterBandDraft();
  match.flush(true);
  await host.waitForSelector('.dband');
  await member.waitForSelector('.dband');
  const band = 'band_ducklord';
  await request(host, 'g.band', { bandId: band });
  await pause(300);
  await host.screenshot({ path: `${out}/clone-vote-844x390.png` });
  assert.equal(match.draft.votes[match.order.find(p => !p.isBot).playerId], band);
  assert.ok(await host.$eval('body', e => e.textContent.includes('策略投票')));
  await member.click(`[data-band="${band}"]`);
  await member.evaluate(() => [...document.querySelectorAll('.draft-detail__btns button')].find(e => e.textContent.includes('确认投票'))?.click());
  await host.waitForFunction(async () => (await import('/js/store.js')).store.get().match.public?.phase === 'BATTLE_CHECK');
  assert.equal(match.phase, 'BATTLE_CHECK');
  assert.ok(match.order.every(p => p.bandId === band));
  match.startRound(1);
  match.enterPrep();
  match.flush(true);
  await host.waitForSelector('.shop-focus select');
  await pause(1300);
  reachable(await metrics(host, ['.shop-focus select', '.gtop__prep-actions .readybtn', '.prep-vote__tools button']), 'clone live prep');
  await host.screenshot({ path: `${out}/clone-live-prep-844x390.png` });
  match.round = 4;
  for (const p of match.order) { p.stats.kills = 15; p.stats.dmgDealt = 12345; p.roundsPassed = 3; }
  match.finish({ victory: false, reason: 'local-qa' });
  await host.waitForSelector('.result');
  await host.waitForFunction(async () => (await import('/js/ui/matchHistory.js')).matchHistory.list().length === 1);
  await host.evaluate(() => [...document.querySelectorAll('.result button')].find(e => e.textContent.includes('返回同盟'))?.click());
  await host.waitForSelector('.room-screen');
  await host.click('[data-testid="loadout-open"]');
  await host.waitForSelector('[data-tab="history"]');
  await host.click('[data-tab="history"]');
  await host.waitForSelector('.history-row');
  await host.screenshot({ path: `${out}/history-list-844x390.png` });
  const identity = await host.evaluate(async () => { const s = (await import('/js/store.js')).store.get(); return { id: s.me.playerId, room: s.room.code, phase: s.match.public?.phase }; });
  await host.click('.history-row');
  await host.waitForSelector('.history-detail .rcard');
  assert.deepEqual(await host.evaluate(async () => { const s = (await import('/js/store.js')).store.get(); return { id: s.me.playerId, room: s.room.code, phase: s.match.public?.phase }; }), identity);
  for (const [width, height, touch] of sizes) {
    await host.setViewport({ width, height, hasTouch: touch, isMobile: touch });
    await pause(400);
    await host.evaluate(async () => {
      (await import('/js/ui/releaseNotes.js')).closeReleaseNotes();
      (await import('/js/ui/loadoutSync.js')).openLoadout('room', null, 'history');
    });
    await host.waitForSelector('.history-row, .history-detail');
    if (await host.$('.history-row')) await host.click('.history-row');
    await host.waitForSelector('.history-detail .rcard');
    await host.screenshot({ path: `${out}/history-detail-${width}x${height}.png` });
    const m = await metrics(host, ['.lo-back', '.history-detail .result__hero button', '[data-tab="history"]']);
    reachable(m, `history ${width}x${height}`);
    results.push({ tag: 'history-detail', ...m });
  }
  await host.evaluate(() => [...document.querySelectorAll('.history-detail button')].find(e => e.textContent.includes('返回记录'))?.click());
  await host.waitForSelector('.history-row');
  const after = await host.evaluate(async () => { const s = (await import('/js/store.js')).store.get(); return { id: s.me.playerId, room: s.room.code, phase: s.match.public?.phase }; });
  assert.equal(after.id, identity.id);
  assert.equal(after.room, identity.room);
  await host.reload({ waitUntil: 'domcontentloaded' });
  await host.waitForSelector('.room-screen');
  assert.equal(await host.evaluate(async () => (await import('/js/ui/matchHistory.js')).matchHistory.list().length), 1);
  for (const capacity of [5, 8]) {
    const page = await session(`正常模式禁用验收${capacity}人`);
    await request(page, 'room.create', { mode: 'coop', difficulty: 'FUNNY', capacity, experimentalAccepted: true });
    await page.waitForSelector('.room-screen');
    for (let i = 1; i < capacity; i++) await request(page, 'room.addBot');
    await request(page, 'room.start');
    await page.waitForSelector('.brief-bond');
    const roomCode = await page.evaluate(async () => (await import('/js/store.js')).store.get().room.code);
    const normal = server.lobby.rooms.get(roomCode).match;
    const expected = [...normal.staticInactiveBonds, ...normal.disabledBonds].sort();
    for (const [width, height, touch] of [[1440, 900, false], [844, 390, true]]) {
      await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
      await pause(400);
      await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
      await page.waitForSelector('.brief-bond');
      const actual = await page.$$eval('.brief-bond.is-off', els => els.map(e => e.dataset.bond).sort());
      assert.deepEqual(actual, expected);
      assert.equal(actual.length, capacity === 5 ? 8 : 6);
      await page.screenshot({ path: `${out}/normal-bans-${capacity}-${width}x${height}.png` });
      results.push({ tag: 'normal-fixed-bans', capacity, width, height, off: actual });
    }
  }
  const mock = await browser.newPage();
  mock.on('pageerror', e => errors.push(e.message));
  for (const [width, height, touch] of sizes) {
    await mock.setViewport({ width, height, hasTouch: touch, isMobile: touch });
    await mock.goto(`${base}/dev/game-mock.html?shot=1`, { waitUntil: 'domcontentloaded' });
    await mock.addStyleTag({ url: `${base}/css/phone-compact.css` });
    await mock.waitForSelector('.prep-vote__tools button');
    await mock.evaluate(() => window.__MOCK__.mutate(s => {
      s.priv.shop.bonusChessSlots = 2;
      s.priv.shop.cloneMode = true;
      s.priv.shop.focusOptions = [];
    }));
    await mock.waitForSelector('.shop-focus select');
    await pause(1400);
    const m = await metrics(mock, ['.gtop__prep-actions .readybtn', '.prep-vote__tools button', '.shop-focus select']);
    reachable(m, `prep ${width}x${height}`);
    const [ready, extend, remind] = m.rects;
    assert.ok(ready.bottom + 2 <= extend.y && ready.bottom + 2 <= remind.y, 'prep controls must not overlap ready');
    results.push({ tag: 'prep', ...m });
    await mock.screenshot({ path: `${out}/prep-${width}x${height}.png` });
    await mock.click('.prep-vote__tools button');
    await mock.waitForSelector('.prep-vote__choices button');
    reachable(await metrics(mock, ['.gtop__prep-actions .readybtn', '.prep-vote__choices button']), `prep panel ${width}x${height}`);
    await mock.screenshot({ path: `${out}/prep-panel-${width}x${height}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, screenshots: out, checks: results.length, errors }));
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  writeFileSync(`${out}/qa.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close(); await server.close();
}
