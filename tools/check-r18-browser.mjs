/* global __demo, document, innerWidth, innerHeight, getComputedStyle */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from '../server/index.js';
const out = '../../outputs/performance-r18';
await mkdir(out, { recursive: true });
const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--enable-unsafe-swiftshader'] });
const report = { passed: false, viewports: [], errors: [] };
try {
  for (const [width, height] of [[1440, 900], [844, 390]]) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    await page.setViewport({ width, height, isMobile: width === 844, hasTouch: width === 844, isLandscape: true });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(srv.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.gm__gear[aria-label="设置"]', { timeout: 45000 });
    await page.click('.gm__gear[aria-label="设置"]');
    await page.waitForSelector('[role="radiogroup"][aria-label="画面帧率"]');
    const control = '[role="radiogroup"][aria-label="画面帧率"]';
    await page.$eval(control + ' button', el => el.focus());
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval(control + ' button:last-child', el => el.getAttribute('aria-checked')), 'true');
    const persisted = await page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get().frameRate);
    assert.equal(persisted, 30);
    assert.ok(await page.evaluate(() => !document.querySelector('.rotate-hint') || getComputedStyle(document.querySelector('.rotate-hint')).display === 'none'));
    const box = await page.$eval('.modal', el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(box.x >= 0 && box.right <= box.width + 1 && box.y >= 0 && box.bottom <= box.height + 1);
    await page.screenshot({ path: `${out}/settings-${width}.png` });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.gm__gear[aria-label="设置"]', { timeout: 45000 });
    assert.equal(await page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get().frameRate), 30);
    report.viewports.push({ width, height, keyboardAndPersistence: true, landscape: true, modalInsideViewport: true });
    await context.close();
  }
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(srv.url + '/dev/render-demo.html?quality=low&panel=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__demo?.ready, { timeout: 60000 });
  report.render = await page.evaluate(async () => {
    const view = __demo.view, ticker = view.debug.app.ticker;
    const sample = async fps => {
      view.setSettings({ frameRate: fps });
      let draws = 0; const count = () => draws++; ticker.add(count);
      const start = performance.now(); await new Promise(resolve => setTimeout(resolve, 3000));
      ticker.remove(count); return { requested: fps, limit: ticker.maxFPS, frames: draws, elapsed: performance.now() - start, stats: view.stats() };
    };
    return [await sample(60), await sample(30), await sample(60)];
  });
  assert.ok(report.render[1].frames < report.render[0].frames * .8);
  assert.ok(report.render[2].frames > report.render[1].frames * 1.2);
  assert.deepEqual(report.errors, []);
  report.passed = true; console.log(JSON.stringify(report));
} finally {
  await browser.close(); await srv.close(); await writeFile(`${out}/browser-local.json`, JSON.stringify(report, null, 2));
}
