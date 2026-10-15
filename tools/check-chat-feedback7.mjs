/* global document, getComputedStyle */
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('../../../outputs/feedback7/', import.meta.url);
await mkdir(out, { recursive: true });
const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=1'] });
const report = [];
try {
  // The real entry gates portrait phones; the game itself is validated in landscape.
  const gate = await browser.newPage();
  await gate.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, isLandscape: false });
  await gate.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await gate.waitForFunction(() => getComputedStyle(document.querySelector('.rotate-hint')).display === 'grid');
  assert.ok(await gate.evaluate(() => document.elementFromPoint(30, 30)?.closest('.rotate-hint')), 'portrait overlay blocks game taps');
  assert.match(await gate.$eval('.rotate-hint__title', el => el.textContent), /请将设备横屏/);
  await gate.screenshot({ path: new URL('phone-portrait-gate.png', out).pathname.replace(/^\/(\w:)/, '$1') });
  await gate.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
  await gate.waitForFunction(() => getComputedStyle(document.querySelector('.rotate-hint')).display === 'none');
  report.push({ name: 'portrait-gate', portraitBlocked: true, landscapeUnblocked: true });
  await gate.close();
  for (const [name, width, height] of [['desktop', 1440, 900], ['phone-landscape', 844, 390], ['phone-min-landscape', 640, 360]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: name !== 'desktop', hasTouch: name !== 'desktop', isLandscape: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=prep&shot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!globalThis.__MOCK__);
    await page.evaluate(async () => {
      const { store } = globalThis.__MOCK__;
      const { net } = await import('/js/net.js');
      globalThis.__CHAT_SENT__ = [];
      const request = net.request;
      net.request = async (kind, payload) => {
        if (kind === 'room.chat') { globalThis.__CHAT_SENT__.push(payload.text); return { ok: true }; }
        return request(kind, payload);
      };
      store.set({ room: { ...store.get().room, chatEnabled: true }, chat: { ...store.get().chat, liveSeq: 6,
        messages: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, playerId: i % 2 ? store.get().me.playerId : 'p2', name: i % 2 ? 'P1 yilin' : 'P2 队友',
          text: ['队友集合，这局一起打', '我先铺场', '左边我来防守', '好的，先保血', '还差一个干员', '<img src=x onerror=alert(1)>'][i], at: Date.now() + i })) } });
    });
    await page.waitForSelector('.room-chat--docked .room-chat__message');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const geometry = await page.evaluate(() => {
      const bounds = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      return { panel: bounds(document.querySelector('.room-chat__body')), buttons: [...document.querySelectorAll('.gm__corner > button, .gm__corner > .ewheel > button, .room-chat__dock-toggle')].map(bounds),
        lines: document.querySelectorAll('.room-chat__message').length, xssImages: document.querySelectorAll('.room-chat__message img').length };
    });
    assert.equal(geometry.lines, 6);
    console.log(name, JSON.stringify(geometry));
    assert.ok(geometry.panel.h > 30, 'closed chat history must be visible');
    assert.equal(geometry.xssImages, 0);
    assert.ok(geometry.panel.x >= 0 && geometry.panel.x + geometry.panel.w <= width + 1 && geometry.panel.y >= 0);
    assert.equal(geometry.buttons.length, 5);
    assert.ok(geometry.buttons.every(b => b.w >= 44 && b.h >= 44 && b.x + b.w <= width + 1 && b.y + b.h <= height + 1));
    assert.equal(await page.$eval('.room-chat--docked', el => getComputedStyle(el).overflow), 'visible', 'parent must not clip chat history');
    assert.ok(await page.evaluate(() => {
      const shop = document.querySelector('.shopbar')?.getBoundingClientRect();
      const dock = document.querySelector('.gm__corner').getBoundingClientRect();
      return !shop || dock.right <= shop.left || dock.left >= shop.right || dock.bottom <= shop.top || dock.top >= shop.bottom;
    }), 'utility buttons do not cover shop cards or shop tools');
    await page.screenshot({ path: new URL(`${name}-chat.png`, out).pathname.replace(/^\/(\w:)/, '$1') });
    await page.click('.room-chat__dock-toggle');
    await page.waitForSelector('#room-chat-input');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'room-chat-input');
    assert.ok(await page.$eval('#room-chat-input', el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; }), 'input is visible and clickable');
    await page.type('#room-chat-input', '消息发送测试');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => globalThis.__CHAT_SENT__.length === 1);
    assert.equal(await page.$eval('#room-chat-input', el => el.value), '');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('room-chat__dock-toggle')), true);
    await page.click('.ewheel__btn');
    await page.waitForSelector('.ewheel__panel');
    assert.equal(await page.$eval('.room-chat__body', el => getComputedStyle(el).display), 'none', 'chat must not cover emotes');
    const target = await page.$eval('.ewheel__item', el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.ewheel__item') === el; });
    assert.equal(target, true, 'emote cell is clickable');
    await page.click('.ewheel__item');
    await page.waitForFunction(() => !document.querySelector('.ewheel__panel'));
    // The ballot can be opened/cast without a blocking modal covering the board.
    await page.evaluate(() => {
      const mock = globalThis.__MOCK__;
      mock.setPhase('UNITE');
      mock.mutate(S => { S.pub.uniteSkip = { enabled: true, used: false, vote: null }; });
    });
    await page.waitForSelector('.unite-vote button');
    await page.click('.unite-vote button');
    await page.waitForSelector('.unite-vote__panel');
    await page.addScriptTag({ content: await readFile(new URL('../../.qa-runtime/node_modules/axe-core/axe.min.js', import.meta.url), 'utf8') });
    const a11y = await page.evaluate(async () => (await globalThis.axe.run({ include: ['.room-chat--docked', '.unite-vote'] }, { rules: { 'region': { enabled: false } } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
    assert.deepEqual(a11y, [], 'new chat/vote UI passes axe');
    await page.screenshot({ path: new URL(`${name}-vote.png`, out).pathname.replace(/^\/(\w:)/, '$1') });
    // Room chat also stays in the lower-left, even with a saved position from the old draggable widget.
    await page.evaluate(async () => {
      const { render } = await import('/vendor/preact.module.js');
      const { html } = await import('/js/ui/components.js');
      const { RoomChatHost } = await import('/js/ui/roomChat.js');
      render(null, document.getElementById('app'));
      globalThis.__MOCK__.setPhase('INFO_CHECK');
      const { store } = globalThis.__MOCK__;
      store.set({ match: { ...store.get().match, public: null }, room: { ...store.get().room, chatEnabled: true } });
      localStorage.setItem('sp.pref.roomChatPosition', JSON.stringify({ x: 1, y: 0 }));
      render(html`<${RoomChatHost} />`, document.getElementById('app'));
    });
    await page.waitForSelector('.room-chat__toggle');
    await page.click('.room-chat__toggle');
    await page.waitForSelector('.room-chat__title');
    await new Promise(resolve => setTimeout(resolve, 100));
    const fixed = await page.$eval('.room-chat', el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom };
    });
    assert.equal(fixed.x, 8);
    assert.ok(Math.abs(fixed.bottom - (height - 8)) < 1, 'room chat stays above the lower safe edge');
    assert.equal(await page.$('.room-chat__move, .room-chat__corner'), null);
    const header = await page.$eval('.room-chat__title', el => { const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; });
    await page.mouse.move(header.x, header.y);
    await page.mouse.down();
    await page.mouse.move(header.x + 120, header.y - 80, { steps: 6 });
    await page.mouse.up();
    assert.deepEqual(await page.$eval('.room-chat', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom }; }), fixed);
    assert.deepEqual(errors, []);
    report.push({ name, width, height, geometry, errors, a11y, send: true, focus: true, emote: true, vote: true, fixedRoomChat: true });
    await page.close();
  }
  await writeFile(new URL('ui-report.json', out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.map(({ name, errors, ...rest }) => ({ name, errors, passed: rest.portraitBlocked || (!!rest.send && rest.emote && rest.vote) }))));
} finally { await browser.close(); await srv.close(); }
