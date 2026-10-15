// Real local WebSocket server + two isolated browser identities; no production players or clipboard touched.
/* global document, window, getComputedStyle, innerWidth, innerHeight */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { TestClient } from '../test/helpers/wsClient.js';

const out = path.resolve('../../outputs/public-room-lobby');
mkdirSync(out, { recursive: true });
const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const base = `http://127.0.0.1:${srv.port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const clients = [], problems = [], checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function click(page, text, scope = '') {
  const handle = await page.evaluateHandle((label, prefix) => {
    const b = [...document.querySelectorAll(`${prefix} button`)].find((e) => e.textContent.trim() === label);
    return b && !b.disabled ? b : null;
  }, text, scope);
  const element = handle.asElement();
  assert.ok(element, `button available: ${text}`); await element.click(); await handle.dispose(); await sleep(100);
}
async function open(name, width = 1440, height = 900, touch = false) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width, height, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-screen');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.title-screen button')].some((e) => e.textContent.includes('快速匹配'))), false);
  await page.evaluate(async (name) => { const { enterSession } = await import('/js/screens/title.js'); enterSession(name); }, name);
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async () => (await import('/js/store.js')).store.get().connection.status === 'online');
  await page.waitForSelector('.release-notes'); await click(page, '我知道了', '.release-notes');
  await page.waitForSelector('.room-directory__empty');
  return page;
}
async function state(page) { return page.evaluate(async () => (await import('/js/store.js')).store.get().room); }
async function request(page, t, fields) { return page.evaluate(async (t, fields) => (await import('/js/net.js')).net.request(t, fields), t, fields); }
async function screenshot(page, name) { await sleep(150); await page.screenshot({ path: path.join(out, name + '.png') }); }
async function viewport(page, width, height) {
  await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.waitForSelector('.screen'); await sleep(650);
  if (await page.$('.release-notes')) await click(page, '我知道了', '.release-notes');
}
async function geometry(page, selectors) {
  return page.evaluate((selectors) => selectors.flatMap((s) => [...document.querySelectorAll(s)].map((e) => {
    const r = e.getBoundingClientRect(), style = getComputedStyle(e);
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { selector: s, text: e.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height,
      visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      reachable: !!hit && (e.contains(hit) || hit.contains(e)) };
  })), selectors);
}
try {
  const host = await open('测试房主'), viewer = await open('测试队友');
  for (const [name, description, difficulty, capacity] of [
    ['休闲博士', '轻松组阵容，新手欢迎一起玩', 'FUNNY', 4], ['联防爱好者', '练习联防配合，麦上交流也可以', 'NORMAL', 6],
    ['终极挑战队', '终极难度，欢迎熟悉机制的博士', 'ABYSS', 8]]) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c); await c.hello(name);
    const r = await c.request({ t: 'room.create', mode: 'coop', difficulty, capacity, experimentalAccepted: true, visibility: 'public', description }); assert.equal(r.t, 'ok');
    await c.request({ t: 'room.recruit' });
  }
  await click(viewer, '刷新 ↻', '.room-directory'); await sleep(150);
  await screenshot(viewer, 'lobby-desktop');
  assert.equal(await viewer.evaluate(() => [...document.querySelectorAll('.lobby-screen button')].some((e) => e.textContent.includes('快速匹配'))), false);
  const clipboardStub = () => { navigator.clipboard.writeText = async (text) => { (window.__copies ||= []).push(text); }; };
  await host.evaluateOnNewDocument(clipboardStub); await host.evaluate(clipboardStub);
  await click(host, '创建同盟'); await host.waitForSelector('.room-access-modal');
  assert.equal(await host.$eval('.modal__actions .btn--primary', (e) => e.disabled), true);
  await click(host, '公开同盟', '.room-access-options').catch(async () => {
    await host.click('.room-access-option');
  });
  await host.type('.room-description-field textarea', '终极休闲，欢迎交流阵容，不催准备');
  await host.keyboard.press('Tab');
  assert.ok(await host.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'create dialog traps focus');
  await click(host, '确认创建'); await host.waitForSelector('.room-screen');
  const code = (await state(host)).code;
  await screenshot(host, 'room-desktop-public');
  assert.equal(await host.evaluate(() => [...document.querySelectorAll('.room-screen button')].some((e) => e.textContent.includes('组队匹配'))), false);
  await click(host, '发布招募');
  await host.waitForFunction(() => document.querySelector('.room-recruit')?.textContent.includes('冷却'));
  await click(viewer, '刷新 ↻', '.room-directory');
  const descriptions = await viewer.$$eval('.room-directory--recruit .room-directory__message', (els) => els.map((e) => e.textContent));
  assert.ok(descriptions.includes('终极休闲，欢迎交流阵容，不催准备'));
  checks.push({ check: 'saved description published by one click', passed: true });
  await host.select('.room-map-picker select', 'classic');
  await host.waitForFunction(async () => (await import('/js/store.js')).store.get().room.mapVersion === 'classic');
  await host.locator('.invite__btns button:last-child').click();
  await host.waitForFunction(() => window.__copies?.at(-1)?.includes('房间简介：终极休闲，欢迎交流阵容，不催准备'));
  assert.ok((await host.evaluate(() => window.__copies.at(-1))).includes('4人房间 · 0.1.4 经典棋盘'));
  const sharedText = await host.evaluate(() => window.__copies.at(-1));
  assert.equal(await host.evaluate(async (text) => (await import('/js/screens/lobby.js')).normalizeCode(text), sharedText), code);
  checks.push({ check: 'public invite contains saved description, room settings and pasteable link', passed: true });
  for (const [width, height] of [[844,390],[932,430],[667,375],[640,360]]) {
    await viewport(host, width, height);
    await screenshot(host, `room-${width}-public`);
    const g = await geometry(host, ['.invite__btns button', '.room-bar__right--directory button']);
    checks.push({ check: `public room controls ${width}x${height}`, geometry: g });
    assert.ok(g.every((c) => c.visible && c.reachable), `all room controls visible ${width}: ${JSON.stringify(g)}`);
    assert.ok(g.filter((c) => c.selector === '.invite__btns button').every((c) => c.width >= 44 && c.height >= 44));
    const botButtons = await geometry(host, ['.seat__foot button']);
    assert.ok(botButtons.every((c) => c.visible && c.reachable), `add AI remains reachable ${width}: ${JSON.stringify(botButtons)}`);
    const copiesBefore = await host.evaluate(() => (window.__copies || []).length);
    await host.locator('.invite__btns button:first-child').click();
    await host.waitForFunction((n) => window.__copies?.length > n, {}, copiesBefore);
    assert.equal(await host.evaluate(() => window.__copies.at(-1)), code);
  }
  await click(host, '私有', '.room-access-toggle'); await host.waitForFunction(async () => (await import('/js/store.js')).store.get().room.visibility === 'private');
  await screenshot(host, 'room-640-private');
  assert.equal(await host.$('.room-recruit'), null);
  await host.locator('.invite__btns button:last-child').click();
  await host.waitForFunction((code) => window.__copies?.at(-1).includes(`?room=${code}`), {}, code);
  assert.ok((await host.evaluate(() => window.__copies.at(-1))).includes('房间简介：终极休闲，欢迎交流阵容，不催准备'));
  await click(viewer, '刷新 ↻', '.room-directory');
  assert.equal(await viewer.evaluate((code) => [...document.querySelectorAll('.room-directory__meta b')].some((e) => e.textContent === code), code), false);
  await request(viewer, 'room.join', { code }); await viewer.waitForSelector('.room-screen');
  await host.type('.room-chat-strip input', '私有房间可以聊天'); await click(host, '发送', '.room-chat-strip');
  await viewer.waitForFunction(() => document.querySelector('.room-chat-strip__preview')?.textContent.includes('私有房间可以聊天'));
  checks.push({ check: 'private hidden, invite link and cross-client chat work', passed: true });
  await host.click('.room-description button'); await host.waitForSelector('.room-description-field textarea'); await sleep(100);
  await host.$eval('.room-description-field textarea', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await host.type('.room-description-field textarea', '休闲新手房 ?room=FAKE <img onerror=x>');
  await click(host, '保存简介', '.modal');
  await host.waitForFunction(async () => (await import('/js/store.js')).store.get().room.description.startsWith('休闲新手房'));
  await host.locator('.invite__btns button:last-child').click();
  await host.waitForFunction(() => window.__copies?.at(-1).includes('房间简介：休闲新手房'));
  const updatedShare = await host.evaluate(() => window.__copies.at(-1));
  assert.equal(await viewer.evaluate(async (text) => (await import('/js/screens/lobby.js')).normalizeCode(text), updatedShare), code);
  assert.equal(await host.$('.room-description img'), null);
  checks.push({ check: 'invite uses latest saved description and remains pasteable with markup or URL-like text', passed: true });
  await viewer.click('.room-screen .topbar .btn--danger'); await viewer.waitForSelector('.lobby-screen');
  for (const [width, height] of [[844,390],[640,360]]) {
    await viewport(viewer, width, height);
    await screenshot(viewer, `lobby-${width}`);
    const g = await geometry(viewer, ['.create-box__actions button']);
    checks.push({ check: `lobby create ${width}x${height}`, geometry: g });
    assert.ok(g.every((c) => c.visible && c.reachable), `create stays visible ${width}: ${JSON.stringify(g)}`);
  }
  await viewer.select('.create-box select', '8'); await click(viewer, '创建同盟');
  await viewer.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('5–8人房间'));
  assert.equal(await viewer.$('.room-access-modal'), null);
  await click(viewer, '了解并选择', '.modal'); await viewer.waitForSelector('.room-access-modal');
  await viewer.click('.room-access-option:last-child'); await viewer.type('.room-description-field textarea', '8人练习联防');
  await screenshot(viewer, 'create-8-warning-then-access');
  await click(viewer, '确认创建'); await viewer.waitForSelector('.seats--expanded');
  await screenshot(viewer, 'room-640-eight-private');
  const eight = await geometry(viewer, ['.invite__btns button', '.room-bar__right--directory button']);
  checks.push({ check: 'eight-player room 640x360', geometry: eight });
  assert.ok(eight.every((c) => c.visible && c.reachable), JSON.stringify(eight));
  assert.equal((await state(viewer)).capacity, 8);
  assert.equal((await state(viewer)).visibility, 'private');
  await viewer.$eval('.seat:last-child button', (e) => e.scrollIntoView({ block: 'nearest' }));
  const lastSeat = await geometry(viewer, ['.seat:last-child button']);
  assert.ok(lastSeat.every((c) => c.visible && c.reachable), `last seat reachable by scrolling: ${JSON.stringify(lastSeat)}`);
  await viewer.locator('.seat:last-child button').click();
  await viewer.waitForFunction(async () => (await import('/js/store.js')).store.get().room.seats.some((s) => s?.isBot));
  checks.push({ check: 'eight-player last seat can add AI after scrolling', passed: true });
  await screenshot(viewer, 'room-640-eight-scrolled');
  assert.equal(problems.length, 0, problems.join('\n'));
  writeFileSync(path.join(out, 'browser-qa.json'), JSON.stringify({ passed: true, checks, problems }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, output: out }));
} catch (e) {
  for (const [i, page] of (await browser.pages()).entries()) {
    await page.screenshot({ path: path.join(out, `failure-${i}.png`) }).catch(() => {});
    const debug = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => ({ text: d.textContent, inputs: [...d.querySelectorAll('textarea')].map((x) => x.value), controls: [...d.querySelectorAll('button')].map((x) => ({ text: x.textContent, disabled: x.disabled, checked: x.getAttribute('aria-checked') })) }))).catch(() => null);
    writeFileSync(path.join(out, `failure-${i}.json`), JSON.stringify(debug, null, 2));
  }
  writeFileSync(path.join(out, 'browser-qa.json'), JSON.stringify({ passed: false, checks, problems, error: e.stack }, null, 2));
  throw e;
} finally { await browser.close(); await Promise.all(clients.map((c) => c.terminate())); await srv.close(); }
