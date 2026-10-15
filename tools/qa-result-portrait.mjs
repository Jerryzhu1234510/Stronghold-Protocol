/* global window, document, getComputedStyle */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';

const out = path.resolve('.cache/result-portrait');
await mkdir(out, { recursive: true });
const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], cases: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(server.url + '/dev/game-mock.html?phase=RESULT&shot=1');
  await page.waitForSelector('.result-unit__portrait', { timeout: 60000 });
  await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const { data } = await import('/js/data.js');
    const result = structuredClone(store.get().match.result);
    const ownId = store.get().me.playerId;
    const own = result.players.find(p => p.playerId === ownId);
    own.name = '玩家自定义名字';
    result.difficulty = 'ABYSS'; result.roundsPassed = 15; own.roundsPassed = 15;
    result.hiddenReached = true; result.hiddenCleared = true;
    const items = data.list('items').filter(i => i.visible !== false).slice(0, 4);
    own.lineup.forEach((u, i) => { u.items = items.slice(i % 2, i % 2 + 2).map(it => it.id); });
    own.bonds = data.list('bonds').slice(0, 9).map((b, i) => ({ bondId: b.bondId, active: true, layers: 552 - i * 43 }));
    store.patch('match', { result });
    window.__qaResult = { result, ownId };
  });
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 600], [844, 390], [768, 360], [640, 360]]) {
    await page.setViewport({ width, height });
    await new Promise(resolve => setTimeout(resolve, 700));
    await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('.result img')];
      await Promise.all(imgs.map(img => img.complete ? null : new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 3000);
      })));
    });
    const sample = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const root = document.querySelector('.result'), main = root.querySelector('.result__main');
      return { name: root.querySelector('.result__player-name').textContent,
        headline: root.querySelector('h1').textContent, difficulty: root.querySelector('.dtag__name').textContent,
        identity: root.querySelector('.result__identity').dataset.player,
        damage: root.querySelector('.result__damage').textContent,
        avatar: root.querySelector('.result__identity img')?.getAttribute('src'),
        main: rect(main), footer: rect(root.querySelector('.result__foot')),
        hero: rect(root.querySelector('.result__hero')), showcase: rect(root.querySelector('.result__showcase')),
        overflow: main.scrollWidth > main.clientWidth + 1,
        units: [...root.querySelectorAll('.result-unit')].map(rect),
        equipment: [...root.querySelectorAll('.result-unit__items .uthumb')].map(el => ({ item: rect(el), unit: rect(el.closest('.result-unit')) })),
        bonds: root.querySelectorAll('.result__bond').length,
        portraitImages: [...root.querySelectorAll('.result-unit__portrait')].filter(i => i.complete && i.naturalWidth > 0).length,
        bodyText: root.textContent };
    });
    assert.equal(sample.name, '玩家自定义名字');
    assert.equal(sample.headline, '模拟完成');
    assert.equal(sample.difficulty, '终极模拟');
    assert.match(sample.damage, /造成伤害.*231万/);
    assert.equal(sample.overflow, false, 'No horizontal page overflow');
    assert.equal(sample.bonds, 9, 'Do not truncate active bonds');
    assert.ok(sample.portraitImages >= 8);
    assert.ok(sample.main.bottom <= sample.footer.y + 1, 'Footer must not occlude content');
    assert.ok(sample.hero.right <= sample.showcase.x + 1, 'Always preserve left/right composition');
    if (height <= 500) assert.ok(sample.units.every(r => r.bottom <= sample.footer.y), 'Landscape cards fit above footer');
    assert.ok(sample.units.every(r => r.width > 0 && r.x >= -1 && r.right <= width + 1));
    for (let i = 1; i < sample.units.length; i++) if (i % 5) assert.ok(sample.units[i - 1].right < sample.units[i].x, 'Portrait columns never overlap');
    assert.ok(sample.equipment.every(({ item, unit }) => item.width <= unit.width * .34 && item.x >= unit.x && item.right <= unit.right + 1), 'Compact equipment stays inside its operator card');
    assert.doesNotMatch(sample.bodyText, /卫戍认证|獲得|模擬|LV\.60|MAX/);
    const target = await page.$eval('.result__target', el => ({
      hidden: el.getAttribute('aria-hidden'), pointer: getComputedStyle(el).pointerEvents,
      quarters: el.querySelectorAll('.result__target-quarter').length,
      rays: el.querySelectorAll('.result__target-ray').length,
      images: [...el.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
      ringSource: el.querySelector('.result__target-quarter').getAttribute('src'),
      centresAligned: [...el.querySelectorAll('.result__target-ring')].every(ring => {
        const bounds = ring.getBoundingClientRect(), centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        return [...ring.children].every((img, i) => {
          const r = img.getBoundingClientRect();
          const anchor = [{ x: r.left, y: r.bottom }, { x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }][i];
          return Math.abs(anchor.x - centre.x) < .5 && Math.abs(anchor.y - centre.y) < .5;
        });
      }),
    }));
    assert.equal(target.hidden, 'true'); assert.equal(target.pointer, 'none');
    assert.equal(target.quarters, 8); assert.equal(target.rays, 5); assert.ok(target.images);
    assert.match(target.ringSource, /target_round_s/);
    assert.ok(target.centresAligned, 'Native upper-right quarters share the same ring centre');
    report.cases.push({ width, height, ...sample });
    await page.screenshot({ path: path.join(out, width + '-summary.png') });
    console.log(JSON.stringify({ width, height, portraits: sample.portraitImages }));
  }
  await page.setViewport({ width: 1440, height: 900 });
  const peer = await page.evaluate(() => window.__qaResult.result.players.find(p => p.playerId !== window.__qaResult.ownId));
  await page.$$eval('.result__player-tabs button', buttons => buttons[1].click());
  await page.waitForFunction(name => document.querySelector('.result__player-name').textContent === name, {}, peer.name);
  assert.equal(await page.$eval('.result__identity', el => el.dataset.player), peer.playerId);
  assert.match(await page.$eval('.result__damage', el => el.textContent), /172万/);
  await page.focus('.result__player-tabs button[aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('.result__identity', el => el.dataset.player), await page.evaluate(() => window.__qaResult.result.players[2].playerId));
  await page.click('.result__next');
  await page.waitForSelector('.result.is-details .rcard');
  assert.equal(await page.$$eval('.rcard', es => es.length), 4);
  await page.screenshot({ path: path.join(out, '1440-stats.png') });
  await page.setViewport({ width: 844, height: 390 });
  await new Promise(resolve => setTimeout(resolve, 500));
  const statsLayout = await page.evaluate(() => {
    const hero = document.querySelector('.result__hero').getBoundingClientRect();
    const players = document.querySelector('.result__players').getBoundingClientRect();
    return { heroRight: hero.right, playersX: players.x, overflow: document.querySelector('.result__main').scrollWidth > document.querySelector('.result__main').clientWidth + 1 };
  });
  assert.ok(statsLayout.heroRight <= statsLayout.playersX + 1);
  assert.equal(statsLayout.overflow, false);
  await page.screenshot({ path: path.join(out, '844-stats.png') });
  await page.click('.result__summary-back');
  await page.waitForSelector('.result__lineup-grid');
  await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const result = structuredClone(window.__qaResult.result);
    result.victory = false; result.hiddenReached = false; result.hiddenCleared = false;
    result.players = result.players.slice(0, 1); result.players[0].lineup = []; result.players[0].bonds = [];
    store.patch('match', { result });
  });
  await page.waitForFunction(() => document.querySelector('.result h1').textContent === '模拟失败');
  await page.waitForFunction(() => [...document.querySelectorAll('.result__target-quarter')].every(img => img.complete && img.naturalWidth > 0 && img.getAttribute('src').includes('target_round_f')));
  assert.equal(await page.$$eval('.result-unit--empty', es => es.length), 10);
  await page.screenshot({ path: path.join(out, '844-defeat-empty.png') });
  await page.evaluate(async () => {
    const { h, render } = await import('/vendor/preact.module.js');
    const { ResultScreen } = await import('/js/screens/result.js');
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/match-history.css'; document.head.append(link);
    await new Promise(resolve => { link.onload = resolve; });
    const host = document.createElement('div'); host.id = 'qa-history-result'; host.className = 'history-detail';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999'; document.body.append(host);
    const result = structuredClone(window.__qaResult.result);
    const own = result.players.find(p => p.playerId === window.__qaResult.ownId);
    own.lineup = [...own.lineup, ...own.lineup.slice(0, 4)];
    own.name = '自定义玩家名字没有写死且较长时也不会覆盖伤害';
    render(h(ResultScreen, { archive: { result, myId: window.__qaResult.ownId }, onBack: () => { window.__qaArchiveBack = true; } }), host);
  });
  await page.waitForSelector('#qa-history-result .result-unit');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await page.$$eval('#qa-history-result .result-unit', es => es.length), 12);
  const history = await page.evaluate(() => {
    const root = document.querySelector('#qa-history-result'), main = root.querySelector('.result__main').getBoundingClientRect(), footer = root.querySelector('.result__foot').getBoundingClientRect();
    return { mainBottom: main.bottom, footerTop: footer.top, overflow: root.scrollWidth > root.clientWidth + 1 };
  });
  assert.ok(history.mainBottom <= history.footerTop + 1);
  assert.equal(history.overflow, false);
  await page.screenshot({ path: path.join(out, '844-history-12-units.png') });
  await page.click('#qa-history-result .result__next');
  await page.waitForSelector('#qa-history-result .result.is-details');
  await page.click('#qa-history-result .result__next');
  assert.ok(await page.evaluate(() => window.__qaArchiveBack));
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close(); await server.close();
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
