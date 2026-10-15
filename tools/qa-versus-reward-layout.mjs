/* global window, document, innerWidth, innerHeight */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from '../server/index.js';

const baseline = process.argv.includes('--baseline');
const out = resolve('.cache/versus-reward-layout', baseline ? 'before' : 'after');
mkdirSync(out, { recursive: true });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, seedFn: () => 81 });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { errors: [], states: [] };
const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${server.url}/game.html`, { waitUntil: 'domcontentloaded' });
  console.log('opened', server.url);
  await page.waitForSelector('.title-screen');
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('布局测试'));
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async () => (await import('/js/store.js')).store.get().connection.status === 'online');
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  const request = (t, fields = {}) => page.evaluate(async (t, fields) => (await import('/js/net.js')).net.request(t, fields), t, fields);
  await request('room.create', { mode: 'coop', difficulty: 'NORMAL', capacity: 4, visibility: 'public', description: '本地布局验收', mapVersion: 'official' });
  await page.waitForSelector('.room-mode-picker select');
  await page.select('.room-mode-picker select', 'versus');
  await page.waitForFunction(async () => (await import('/js/store.js')).store.get().room.gameMode === 'versus');
  for (let i = 0; i < 3; i++) await request('room.addBot');
  const code = await page.evaluate(async () => (await import('/js/store.js')).store.get().room.code);
  await request('room.start');
  const match = server.lobby.rooms.get(code).match;
  await page.waitForSelector('.brief-bonds');
  await request('g.infoReady');
  console.log('versus started');
  clearInterval(match.timer);
  await page.waitForSelector('iframe[title="对抗模式（测试）"]');
  const frame = await (await page.$('iframe[title="对抗模式（测试）"]')).contentFrame();
  await frame.waitForFunction(() => window.__versusView && window.__versusState()?.field, { timeout: 60000 });
  const id = await frame.evaluate(() => window.__versusState().me.id);
  const p = match.players.get(id);
  p.role = 'defend'; p.coins = 100; match.flush();
  await frame.waitForFunction(() => window.__versusState().me.role === 'defend' && window.__versusState().me.coins === 100);
  const check = async label => {
    for (const [width, height] of [[1440,900], [844,390], [568,320], [390,844]]) {
      await page.setViewport({ width, height });
      await frame.waitForFunction(({width,height}) => innerWidth === width && innerHeight === height, {}, {width,height});
      await pause(350);
      const geometry = await frame.evaluate(() => {
        const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
        const funds = box('.funds'), item = box('.shopbar__item .scard'), reward = box('.shopbar__reward');
        const cards = [...document.querySelectorAll('.shopbar__reward .scard')].map(e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom }; });
        return { funds, item, reward, cards, width:innerWidth, height:innerHeight, role:window.__versusState().me.role };
      });
      report.states.push({ label, width, height, ...geometry });
      await page.screenshot({ path: `${out}/${label}-${width}x${height}.png` });
      if (!baseline) {
        for (const r of [geometry.funds, geometry.item, geometry.reward, ...geometry.cards].filter(Boolean)) {
          assert.ok(r.x >= -1 && r.y >= -1 && r.right <= width + 1 && r.bottom <= height + 1, JSON.stringify({ label, width, height, r }));
        }
        assert.ok(geometry.item.width >= 20 && geometry.item.height >= 20);
        assert.ok(geometry.item.right <= geometry.funds.x + 1, JSON.stringify(geometry));
        if (geometry.reward) assert.ok(geometry.cards.every(r => r.right <= geometry.item.x + 1), JSON.stringify(geometry));
      }
    }
  };
  await check('shop');
  await page.setViewport({ width:1440, height:900 }); await pause(350);
  await frame.click('.lvcard'); await frame.waitForSelector('.lvcard.is-armed'); await frame.click('.lvcard.is-armed');
  await frame.waitForFunction(() => window.__versusState().me.level === 2);
  await check('level-2');
  p.level = 6; match.game.refresh(p, false); match.flush();
  await frame.waitForFunction(() => window.__versusState().me.level === 6);
  await check('level-6');
  console.log('high-level geometry captured');
  p.offers.push({ kind:'merge', slots:p.shop.operator.slice(0,3).map(id => ({kind:'chess', id, price:0, sold:false})) });
  match.flush(); await frame.waitForSelector('.shopbar__reward');
  console.log('reward visible');
  await check('promotion');
  await page.setViewport({ width:844, height:390 }); await pause(350);
  await frame.click('.rwtag__later'); await frame.waitForSelector('.versus-reward-pill');
  await check('deferred');
  await page.setViewport({ width:844, height:390 }); await pause(350);
  await frame.waitForSelector('.versus-reward-pill');
  await frame.click('.versus-reward-pill'); await frame.waitForSelector('.shopbar__reward .scard');
  await frame.click('.shopbar__reward .scard'); await frame.waitForSelector('.shopbar__reward .scard.is-armed');
  await frame.click('.shopbar__reward .scard.is-armed');
  await frame.waitForFunction(() => !window.__versusState().me.rewardOffer && window.__versusState().me.operators.length > 0);
  await check('claimed');
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
