/* global __SP__, __SP_RUNNER__, __SP_VIEW__, getComputedStyle */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const out = '../../outputs/performance-r18';
const { generation } = JSON.parse(await readFile(`${out}/deployment.json`, 'utf8'));
const base = `/_build/${generation}/`, origin = 'https://weishuxieyi.icu';
const report = { passed: false, generation, errors: [], serverErrors: [], warnings: [], received: {}, compressedHandshake: false };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage(), frames = [];
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'warning') report.warnings.push(msg.text()); });
const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
const requests = new Map();
cdp.on('Network.webSocketFrameSent', e => { try { const m = JSON.parse(e.response.payloadData); if (m.rid != null) requests.set(m.rid, m.t); } catch { /* control */ } });
cdp.on('Network.webSocketHandshakeResponseReceived', e => {
  const extension = Object.entries(e.response.headers).find(([k]) => k.toLowerCase() === 'sec-websocket-extensions')?.[1];
  if (String(extension).includes('permessage-deflate')) report.compressedHandshake = true;
});
cdp.on('Network.webSocketFrameReceived', e => {
  try {
    const m = JSON.parse(e.response.payloadData); report.received[m.t] = (report.received[m.t] || 0) + 1;
    if (m.t === 'error') report.serverErrors.push({ code: m.code, detail: m.detail, request: requests.get(m.rid) });
    frames.push({ t: m.t, seq: m.stateSeq, type: m.type, base: m.base, stateDelta: m.stateDelta, authoritative: m.authoritative });
  } catch { /* control frame */ }
});
let ownMatch = false;
try {
  await page.goto(origin + base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'connected', { timeout: 60000 });
  await page.waitForSelector('.release-notes__changes', { timeout: 60000 });
  report.announcement = await page.$$eval('.release-notes__changes > li', els => els.slice(0, 4).map(el => ({ text: el.textContent, color: getComputedStyle(el).color })));
  assert.ok(report.announcement[0].text.includes('克莱门莎'));
  assert.ok(report.announcement[2].text.includes('联机同步优化'));
  assert.ok(report.announcement[3].text.includes('30 FPS'));
  assert.equal(report.announcement[0].color, 'rgb(255, 170, 170)');
  await page.screenshot({ path: `${out}/live-announcement-844.png` });
  await page.click('.release-notes .modal__actions button');
  await page.evaluate(async base => { const { enterSession } = await import(base + 'js/screens/title.js'); enterSession('R18隔离验证'); }, base);
  await page.waitForFunction(() => __SP__.store.get().connection.status === 'online', { timeout: 30000 });
  assert.ok(frames.some(f => f.t === 'welcome' && f.stateDelta === true));
  await page.evaluate(async () => { await __SP__.net.request('room.create', { mode: 'solo', difficulty: 'FUNNY' }); await __SP__.net.request('room.start'); });
  ownMatch = true;
  await page.waitForFunction(() => __SP__.store.get().match?.public?.phase === 'INFO_CHECK', { timeout: 60000 });
  await page.evaluate(() => __SP__.net.request('g.infoReady'));
  await page.waitForFunction(() => __SP__.store.get().match?.public?.phase === 'BAND_DRAFT', { timeout: 30000 });
  await page.evaluate(() => __SP__.net.request('g.band', { bandId: 'band_sarkazb' }));
  await page.waitForFunction(() => __SP__.store.get().match?.public?.phase === 'PREP', { timeout: 60000 });
  const frozen = await page.evaluate(() => __SP__.store.get().match.private?.shop?.frozen);
  await page.evaluate(() => __SP__.net.request('g.freeze'));
  await page.waitForFunction(frozen => __SP__.store.get().match.private?.shop?.frozen !== frozen, { timeout: 15000 }, frozen);
  assert.ok(report.received['m.delta'] > 0);
  await page.waitForSelector('.gm__gear[aria-label="设置"]', { timeout: 60000 });
  await page.click('.gm__gear[aria-label="设置"]');
  const fpsControl = '[role="radiogroup"][aria-label="画面帧率"]';
  await page.click(fpsControl + ' button:last-child');
  assert.equal(await page.$eval(fpsControl + ' button:last-child', el => el.getAttribute('aria-checked')), 'true');
  report.fpsButton = await page.$eval(fpsControl + ' button:last-child', el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  assert.ok(report.fpsButton.width >= 48 && report.fpsButton.height >= 44);
  await page.screenshot({ path: `${out}/live-settings-844.png` });
  await page.click('.modal__actions .btn--primary');
  const reconnectAt = frames.length;
  await page.evaluate(() => __SP__.net.reconnectNow());
  await page.waitForFunction(() => __SP__.store.get().connection.status === 'online' && __SP__.store.get().match?.public?.phase === 'PREP', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  report.reconnectFullState = frames.slice(reconnectAt).some(f => f.t === 'm.public' && f.seq === 1);
  assert.ok(report.reconnectFullState);
  await page.evaluate(() => __SP__.net.request('g.ready', { ready: true }));
  await page.waitForFunction(() => globalThis.__SP_RUNNER__?.stats().ticks > 10, { timeout: 45000 });
  const before = await page.evaluate(() => __SP_RUNNER__.stats().ticks);
  await new Promise(r => setTimeout(r, 3000));
  report.battle = await page.evaluate(before => ({ ticksDuring3Seconds: __SP_RUNNER__.stats().ticks - before,
    frameRate: __SP_VIEW__?.raw?.debug?.app?.ticker?.maxFPS, runner: __SP_RUNNER__.stats() }), before);
  assert.equal(report.battle.frameRate, 30);
  assert.ok(report.battle.ticksDuring3Seconds >= 100, 'render cap must not cap simulation ticks');
  assert.ok(frames.some(f => f.t === 'b.start' && f.authoritative));
  assert.ok(report.compressedHandshake);
  assert.ok(!report.warnings.some(x => x.includes('invalid state delta')));
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, generation, deltaFrames: report.received['m.delta'], compressed: report.compressedHandshake,
    reconnect: report.reconnectFullState, fpsButton: report.fpsButton, battle: report.battle, errors: report.errors }));
} finally {
  if (ownMatch) {
    try { await page.evaluate(async () => {
      await __SP__.net.request('g.leave');
      // Solo g.leave already removes the room; the pushed UI state may still be in transit.
      if (__SP__.store.get().room) { try { await __SP__.net.request('room.leave'); } catch (e) { if (e.code !== 'NOT_IN_ROOM') throw e; } }
    }); report.ownMatchCleaned = true; }
    catch (e) { report.cleanupError = e.message; }
  }
  await browser.close(); await writeFile(`${out}/browser-live.json`, JSON.stringify(report, null, 2));
}
