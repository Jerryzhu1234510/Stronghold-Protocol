/* global document, window, getComputedStyle, innerWidth, innerHeight */
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = path.resolve('C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/mobile-qa');
mkdirSync(out, { recursive: true });
const mode = process.argv[2] || 'before';
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const results = [], errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-screen');
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('手机适配核验'));
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async () => (await import('/js/store.js')).store.get().connection.status === 'online');
  await page.waitForSelector('.release-notes');
  await page.evaluate(() => [...document.querySelectorAll('.release-notes button')].find(e => e.textContent.trim() === '我知道了')?.click());
  await page.evaluate(async () => (await import('/js/net.js')).net.request('room.create', { mode: 'coop', difficulty: 'ABYSS', capacity: 4, experimentalAccepted: true, visibility: 'public', description: '终极模拟，一起组阵容，不催准备' }));
  await page.waitForSelector('.room-screen');
  for (const [width, height, touch] of [[1440,900,false],[844,390,true],[932,430,true],[667,375,true],[640,360,true],[960,432,true],[1920,864,true],[375,812,true]]) {
    await page.setViewport({ width, height, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
    await new Promise(r => setTimeout(r, 650));
    await page.evaluate(() => [...document.querySelectorAll('.release-notes button')].find(e => e.textContent.trim() === '我知道了')?.click());
    await new Promise(r => setTimeout(r, 150));
    const metrics = await page.evaluate(() => {
      const selectors = ['.topbar','.room-options','.seats','.seat','.room-chat-strip','.room-bar','.invite__btns button','.room-bar__right button','.seat__foot button'];
      const rects = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(e => {
        const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { selector, text: e.textContent.trim().slice(0,60), x:r.x, y:r.y, w:r.width, h:r.height, right:r.right, bottom:r.bottom,
          reached: !!hit && (e.contains(hit) || hit.contains(e)), font:getComputedStyle(e).fontSize };
      }));
      return { width:innerWidth, height:innerHeight, rootFont:getComputedStyle(document.documentElement).fontSize, classes:document.documentElement.className,
        coarse:window.matchMedia('(any-pointer: coarse)').matches, short:window.matchMedia('(max-height: 600px)').matches, rects };
    });
    await page.screenshot({ path: path.join(out, `${mode}-${width}x${height}.png`) });
    results.push({ width, height, touch, ...metrics });
  }
  writeFileSync(path.join(out, `${mode}.json`), JSON.stringify({ results, errors }, null, 2));
  if (mode !== 'before') {
    for (const r of results.filter(r => r.touch && r.width > r.height)) {
      for (const control of r.rects.filter(e => e.selector.includes('button'))) {
        assert.ok(control.reached && control.right <= r.width + 1 && control.bottom <= r.height + 1, `${r.width}x${r.height}: ${control.text}`);
      }
    }
    assert.equal(results[0].rootFont, '75px', 'desktop scale is unchanged');
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    await page.evaluate(async () => (await import('/js/net.js')).net.request('room.setCapacity', { capacity: 8, experimentalAccepted: true }));
    await page.waitForSelector('.seats--expanded');
    await new Promise(r => setTimeout(r, 800));
    assert.equal(await page.$$eval('.seat', nodes => nodes.length), 8);
    assert.ok(await page.$eval('.seats', node => node.scrollHeight <= node.clientHeight + 1), 'all eight compact seats fit');
    await page.screenshot({ path: path.join(out, 'after-8-seats.png') });
    for (const [width, height, touch] of [[1440,900,false],[844,390,true]]) {
      for (const side of ['boss', 'bossR']) {
        const board = await browser.newPage();
        board.on('pageerror', e => errors.push(e.message));
        await board.setViewport({ width, height, isMobile: touch, hasTouch: touch });
        await board.goto(`http://127.0.0.1:${server.port}/dev/game-mock.html?shot=1&variant=${side}`, { waitUntil: 'domcontentloaded' });
        await board.addStyleTag({ url: `http://127.0.0.1:${server.port}/css/phone-compact.css` });
        await board.waitForFunction(() => window.__SP_VIEW__?.raw?.debug?.camKind === 'bossPrep', { timeout: 60000 });
        await new Promise(r => setTimeout(r, 1800));
        const state = await board.evaluate(() => {
          const view = window.__SP_VIEW__.raw, s = window.__MOCK__.S();
          const units = s.priv.board.filter(p => p.kind === 'chess').map(p => {
            const v = view.debug.views.get('p:' + p.uid);
            return { col:p.col, row:p.row, stored:p.dir || 'RIGHT', x:v?.x, y:v?.y, dir:v?.dir };
          });
          return { field:view.prepField(), units, stats:view.stats() };
        });
        const right = side === 'bossR';
        assert.equal(state.field.mirror, right);
        for (const u of state.units) {
          assert.ok(Math.abs(u.x - (right ? 20-u.col : u.col)) < 0.01);
          assert.ok(Math.abs(u.y - (u.row-7)) < 0.01);
          assert.equal(u.dir, right ? 'LEFT' : 'RIGHT');
        }
        await board.screenshot({ path: path.join(out, `${side}-${width}x${height}.png`) });
        writeFileSync(path.join(out, `${side}-${width}x${height}.json`), JSON.stringify(state, null, 2));
        await board.close();
      }
    }
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify({ errors, results:results.map(r => ({ width:r.width,height:r.height,rootFont:r.rootFont, seats:r.rects.filter(x=>x.selector==='.seat'), controls:r.rects.filter(x=>x.selector.includes('button')) })) }));
} finally { await browser.close(); await server.close(); }
