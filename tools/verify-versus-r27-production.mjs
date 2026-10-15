import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = 'D:/Codex/2026-10-10/a/outputs/r27-deploy';
mkdirSync(out, { recursive: true });
const plan = JSON.parse(readFileSync(`${out}/deployment.json`, 'utf8'));
const base = `https://weishuxieyi.icu/_build/${plan.generation}`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const report = { passed: false, generation: plan.generation, errors: [], viewports: [] };
page.on('pageerror', error => report.errors.push(error.message));
const request = (t, args = {}) => page.evaluate(async (base, t, args) => (await import(`${base}/js/net.js`)).net.request(t, args), base, t, args);
let roomCreated = false;
try {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('https://weishuxieyi.icu/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-enter="icu"]');
  report.selector = await page.$$eval('.server-card', cards => cards.map(card => ({ name: card.querySelector('h3')?.textContent, url: card.querySelector('[data-enter]')?.href })));
  assert.equal(report.selector[0].url, 'https://weishuxieyiwangye.cn:8443/');
  assert.equal(report.selector[1].url, 'https://weishuxieyi.icu/game.html');
  assert.ok(page.url().includes(plan.generation));
  await page.waitForFunction(() => Number(document.querySelector('#online-icu')?.textContent.replaceAll(',', '')) > 0, { timeout: 15000 });
  report.selectorOnline = await page.$eval('#online-icu', e => e.textContent);
  await page.screenshot({ path: `${out}/production-selector.png`, fullPage: true });
  await page.click('[data-enter="icu"]');
  await page.waitForSelector('.title-screen', { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__SP_GENERATION), plan.generation);
  await page.evaluate(async base => (await import(`${base}/js/screens/title.js`)).enterSession('发布验收'), base);
  await page.waitForSelector('.lobby-screen', { timeout: 60000 });
  await page.waitForFunction(async base => (await import(`${base}/js/store.js`)).store.get().connection.status === 'online', { timeout: 20000 }, base);
  await page.evaluate(async base => (await import(`${base}/js/ui/releaseNotes.js`)).closeReleaseNotes(), base);
  report.assets = await page.evaluate(async base => {
    const assets = await (await fetch(`${base}/data/assets.json`)).json();
    const manifest = await (await fetch(`${base}/data/resource-cache.json`)).json();
    const skins = Object.values(assets.chars).flatMap(char => Object.values(char.skins || {}));
    const sample = skins[0];
    const url = sample.avatar;
    const image = await fetch(new URL(url, location.origin), { method: 'HEAD' });
    const bank = Object.values(assets.audio.voice.banks.en || {})[0];
    const voice = Object.values(bank || {}).flat()[0];
    const audio = voice ? await fetch(new URL(voice, location.origin), { method: 'HEAD' }) : null;
    return { skins: skins.length, resources: manifest.count, skinStatus: image.status, voiceStatus: audio?.status,
      cdnRetained: Object.values(manifest.entries).some(item => item.cdn?.startsWith('https://assets.weishuxieyi.icu/')) };
  }, base);
  assert.equal(report.assets.skins, 273);
  assert.equal(report.assets.skinStatus, 200);
  assert.equal(report.assets.voiceStatus, 200);
  assert.equal(report.assets.cdnRetained, true);
  await request('room.create', { mode: 'coop', difficulty: 'NORMAL', gameMode: 'versus', capacity: 4, visibility: 'private', description: '发布验收临时房' });
  roomCreated = true;
  report.difficulty = await page.evaluate(async base => (await import(`${base}/js/store.js`)).store.get().room.difficulty, base);
  assert.equal(report.difficulty, 'HARD');
  for (let i = 0; i < 3; i++) await request('room.addBot');
  await request('room.start');
  await page.waitForSelector('.brief-bonds', { timeout: 20000 });
  await request('g.infoReady');
  await page.waitForSelector('iframe[title="对抗模式（测试）"]', { timeout: 30000 });
  const frame = await (await page.$('iframe[title="对抗模式（测试）"]')).contentFrame();
  await frame.waitForFunction(() => window.__versusView && window.__versusState()?.field, { timeout: 90000 });
  assert.ok(frame.url().startsWith(base + '/versus.html'), frame.url());
  report.role = await frame.evaluate(() => window.__versusState().me.role);
  report.frameUrl = frame.url();
  await frame.click('[aria-label="对抗模式规则"]');
  await frame.waitForSelector('.versus-rules');
  report.rules = await frame.$eval('.versus-rules', e => e.textContent);
  assert.match(report.rules, /测试版/);
  assert.match(report.rules, /扣血\+5/);
  await frame.click('[aria-label="关闭规则"]');
  if (await frame.$('[aria-label="展开商店"]')) await frame.click('[aria-label="展开商店"]');
  await frame.waitForSelector('.shopbar__cards .scard:not(.scard--sold)');
  await frame.click('.shopbar__cards .scard:not(.scard--sold)');
  await frame.waitForSelector('.dpanel');
  assert.equal(await frame.$('.versus-detail'), null);
  await page.screenshot({ path: `${out}/production-native-detail.png` });
  await frame.click('.shopbar__cards .scard:not(.scard--sold)');
  await frame.waitForFunction(() => !document.querySelector('.dpanel'));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewport({ ...viewport, deviceScaleFactor: viewport.width <= 1000 ? 2 : 1 });
    await new Promise(resolve => setTimeout(resolve, 1200));
    if (await frame.$('[aria-label="展开商店"]')) await frame.click('[aria-label="展开商店"]');
    const metrics = await frame.evaluate(() => {
      const bounds = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const card = document.querySelector('.bench-card');
      const box = card?.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, shop: bounds('.shopbar'), bonds: bounds('.gm__bonds'), field: bounds('.field'),
        bench: box?.toJSON(), benchHit: box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.bench-card') != null : false,
        cards: document.querySelectorAll('.shopbar__cards .scard').length, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        aboveShopBand: !!document.querySelector('.shell > .bond-strip'), canvas: document.querySelector('canvas')?.getBoundingClientRect().toJSON() };
    });
    assert.equal(metrics.aboveShopBand, false);
    assert.equal(metrics.overflow, false);
    assert.ok(metrics.cards <= 11);
    assert.ok(metrics.canvas.width > 100 && metrics.canvas.height > 100);
    if (metrics.bench) assert.equal(metrics.benchHit, true);
    report.viewports.push(metrics);
    await page.screenshot({ path: `${out}/production-versus-${viewport.width}.png` });
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: `${out}/production-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (roomCreated) {
    try { await request('g.leave'); report.testRoomRemoved = true; }
    catch (error) { report.cleanupError = error.message; }
  }
  await browser.close();
  writeFileSync(`${out}/live-browser.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
