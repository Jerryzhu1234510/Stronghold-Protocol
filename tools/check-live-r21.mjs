import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
let page, created = false;
const errors = [];
try {
  page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width:844, height:390, isMobile:true, hasTouch:true });
  await page.goto('https://weishuxieyi.icu/', { waitUntil:'domcontentloaded', timeout:90000 });
  await page.waitForSelector('.title-screen', { timeout:90000 });
  assert.ok(page.url().includes('d5513800f1b8-12'));
  await page.evaluate(async () => (await import('./js/screens/title.js')).enterSession('安卓界面核验'));
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async () => (await import('./js/store.js')).store.get().connection.status === 'online');
  await page.evaluate(() => [...document.querySelectorAll('.release-notes button')].find(e => e.textContent.trim() === '我知道了')?.click());
  await page.evaluate(async () => (await import('./js/net.js')).net.request('room.create', { mode:'coop', difficulty:'FUNNY', capacity:4, visibility:'private' }));
  created = true;
  await page.waitForSelector('.room-screen');
  await new Promise(r => setTimeout(r, 1000));
  const metrics = await page.evaluate(() => ({ rootFont:getComputedStyle(document.documentElement).fontSize,
    css:[...document.styleSheets].some(s => s.href?.includes('phone-compact.css')),
    controls:[...document.querySelectorAll('.invite__btns button,.room-bar__right button')].map(e => {
      const r=e.getBoundingClientRect(), h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return { text:e.textContent.trim(), reached:!!h && (e.contains(h)||h.contains(e)), bottom:r.bottom, right:r.right };
    }) }));
  assert.equal(metrics.rootFont, '40px');
  assert.ok(metrics.css);
  for (const c of metrics.controls) assert.ok(c.reached && c.bottom<=391 && c.right<=845, c.text);
  assert.deepEqual(errors, []);
  await page.screenshot({ path:'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/mobile-qa/live-844x390.png' });
  console.log(JSON.stringify({ url:page.url(), metrics, errors }));
} finally {
  if(created) await page.evaluate(async () => (await import('./js/net.js')).net.request('room.leave', {})).catch(()=>{});
  await browser.close();
}
