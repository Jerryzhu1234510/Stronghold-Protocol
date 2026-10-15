/* global document, getComputedStyle, innerWidth, innerHeight, window */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pinText } from '../server/hot/gateway.mjs';

const out = new URL('../../../outputs/chat-free15/', import.meta.url);
const deployment = JSON.parse(await readFile(new URL('deployment.json', out), 'utf8'));
const generation = deployment.generation;
const base = `/_build/${generation}/`;
const origin = 'https://weishuxieyi.icu';
const report = { generation, errors: [], passed: false };
for (const [file, alias] of [['js/ui/roomChat.js', 'roomChat-free-20261009.js'], ['js/ui/releaseNotes.js', 'releaseNotes-free-20261009.js']]) {
  const raw = (await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8')).replace(/\r/g, '');
  const served = (await readFile(new URL(`served-${alias}`, out), 'utf8')).replace(/\r/g, '');
  assert.equal(served, pinText(raw, 'application/javascript', '/js/ui/' + alias, generation));
}
report.servedSourcesCorrect = true;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const pages = [];
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    pages.push(page);
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.evaluateOnNewDocument(() => localStorage.setItem('sp.pref.roomChatPosition', JSON.stringify({ x: 1, y: 0 })));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.title-screen', { timeout: 60000 });
    assert.equal(await page.evaluate(()=>window.__SP_UI_PATCH), '20261009-chat-free');
    assert.equal(await page.$eval('.rotate-hint', el => getComputedStyle(el).display), 'none');
    await page.evaluate(async ({ base, name }) => {
      const { enterSession } = await import(base + 'js/screens/title.js');
      enterSession(name);
    }, { base, name: `聊天验证${i + 1}` });
    await page.waitForFunction(async base => {
      const { store } = await import(base + 'js/store.js');
      return store.get().connection.status === 'online' && store.get().session.entered;
    }, { timeout: 30000 }, base);
  }
  const code = await pages[0].evaluate(async base => {
    const { net } = await import(base + 'js/net.js');
    const { store } = await import(base + 'js/store.js');
    await net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
    return store.get().room?.code;
  }, base);
  assert.ok(code);
  await pages[1].evaluate(async ({ base, code }) => {
    const { net } = await import(base + 'js/net.js');
    await net.request('room.join', { code });
  }, { base, code });
  report.ownRoomCreated = true;
  await pages[0].waitForSelector('.room-chat__toggle');
  // The release notice is dismissed only in the isolated QA client.
  for (const page of pages) {
    if (await page.$('.release-notes .modal__actions button')) {
      assert.ok(await page.$eval('.release-notes', el => el.textContent.includes('界面与伤害统计更新') && el.textContent.includes('聊天框统一为所有阶段可拖动')));
      report.newAnnouncementVisible = true;
      await page.click('.release-notes .modal__actions button');
      await page.waitForSelector('.release-notes', { hidden: true });
    }
  }
  report.chatHitProbe = await pages[0].$eval('.room-chat__toggle', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, topmost: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0, 500) };
  });
  console.log('chat hit probe', JSON.stringify(report.chatHitProbe));
  await pages[0].click('.room-chat__toggle');
  await pages[0].waitForSelector('#room-chat-input', { timeout: 5000 });
  await pages[0].type('#room-chat-input', '新版可移动聊天验证');
  await pages[0].keyboard.press('Enter');
  await pages[1].waitForFunction(() => document.querySelector('.room-chat__preview')?.textContent?.includes('新版可移动聊天验证'), { timeout: 15000 });
  await pages[1].click('.room-chat__toggle');
  await pages[1].waitForSelector('.room-chat__message');
  assert.ok(await pages[1].$eval('.room-chat__log', el => el.textContent.includes('新版可移动聊天验证')));
  for (const page of pages) {
    assert.ok(await page.$('.room-chat__move'));
    await page.waitForFunction(() => {const r=document.querySelector('.room-chat').getBoundingClientRect();return r.right<=innerWidth && r.bottom<=innerHeight;});
    const rect = await page.$eval('.room-chat', el => { const r = el.getBoundingClientRect(); return { x: r.x, bottom: r.bottom }; });
    assert.ok(rect.x >= 8 && rect.bottom <= 383);
  }
  const grip = await pages[0].$eval('.room-chat__move', el=>{const r=el.getBoundingClientRect();return {x:r.x+22,y:r.y+22};});
  const oldX = await pages[0].$eval('.room-chat',el=>el.getBoundingClientRect().x);
  await pages[0].mouse.move(grip.x,grip.y);await pages[0].mouse.down();await pages[0].mouse.move(grip.x-80,grip.y+55,{steps:8});await pages[0].mouse.up();
  await pages[0].waitForFunction(oldX=>document.querySelector('.room-chat').getBoundingClientRect().x < oldX-60,{},oldX);
  report.liveDraggingWorks = true;
  report.chatDeliveredBetweenClients = true;
  report.movableOutsideBattle = true;
  await pages[0].screenshot({ path: new URL('live-phone-room-chat.png', out).pathname.replace(/^\/(\w:)/, '$1') });
  await pages[1].evaluate(async base => { const {net}=await import(base+'js/net.js'); await net.request('room.ready',{ready:true}); },base);
  await pages[0].evaluate(async base => { const {net}=await import(base+'js/net.js'); await net.request('room.start',{}); },base);
  for (const page of pages) {
    await page.waitForFunction(async base => { const {store}=await import(base+'js/store.js'); return !!store.get().match.public; },{},base);
    await page.evaluate(async base => {const {net}=await import(base+'js/net.js'); await net.request('g.infoReady',{});},base);
  }
  for (let attempt=0;attempt<16;attempt++) {
    const phase=await pages[0].evaluate(async base => { const {store}=await import(base+'js/store.js');return store.get().match.public?.phase;},base);
    if (phase==='PREP') break;
    for (const page of pages) await page.evaluate(async base => {
      const {net}=await import(base+'js/net.js'); const {store}=await import(base+'js/store.js');
      const state=store.get(),pub=state.match.public;
      if(pub?.phase!=='BAND_DRAFT') return;
      const {normalizeDraft,sortedPlayers}=await import(base+'js/ui/gameLogic.js');
      const draft=normalizeDraft(pub.draft,sortedPlayers(pub));
      if(draft.turnPid!==state.me.playerId) return;
      const {data}=await import(base+'js/data.js');await data.load('bands');
      const taken=new Set(draft.picks.values());
      const band=Object.values(data.get('bands')).find(b=>b.modeTypeList.includes('MULTI')&&!taken.has(b.bandId));
      if(band) await net.request('g.band',{bandId:band.bandId});
    },base);
    await new Promise(resolve=>setTimeout(resolve,600));
  }
  await pages[0].waitForFunction(async base=>{const {store}=await import(base+'js/store.js');return store.get().match.public?.phase==='PREP';},{timeout:30000},base);
  assert.ok(await pages[0].$('.room-chat__move'));
  assert.equal(await pages[0].$('.room-chat--docked'),null);
  report.realPreparationMovable=true;
  await pages[0].reload({waitUntil:'domcontentloaded',timeout:60000});
  await pages[0].waitForSelector('.room-chat__move',{timeout:30000});
  assert.equal(await pages[0].evaluate(()=>window.__SP_UI_PATCH),'20261009-chat-free');
  assert.equal(await pages[0].$('.room-chat--docked'),null);
  report.reloadResumesMovableChat=true;
  report.liveVoteModuleImported = await pages[0].evaluate(async base => typeof (await import(base + 'js/ui/uniteVote.js')).UniteVoteControls === 'function', base);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  if (pages[0]) {
    report.visibleText = await pages[0].evaluate(() => document.body.innerText.slice(0, 2200)).catch(() => '');
    await pages[0].screenshot({ path: new URL('live-check-failure.png', out).pathname.replace(/^\/(\w:)/, '$1') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const page of pages) {
    try { await page.evaluate(async base => { const { net } = await import(base + 'js/net.js'); await net.request('room.leave'); }, base); } catch { /* already left or disconnected */ }
  }
  await browser.close();
  await writeFile(new URL('live-ui-report.json', out), JSON.stringify(report, null, 2));
  if (report.passed) {
    delete deployment.error;
    deployment.servedSourcesVerifiedAfterGatewayPinning = true;
    await writeFile(new URL('deployment.json', out), JSON.stringify(deployment, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
