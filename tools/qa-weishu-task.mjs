/* global window, document, innerWidth, Image, getComputedStyle */
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'D:/Codex/2026-10-10/a/outputs/weishu-task';
mkdirSync(out, { recursive: true });
const report = { passed: false, errors: [], layouts: [] }, pause = ms => new Promise(r => setTimeout(r, ms));
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && /\[render\]|shader|GLSL/.test(message.text())) report.errors.push(message.text()); });
const views = [[1440, 900], [844, 390], [568, 320], [390, 844]];
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#copy-qq');
  assert.equal(await page.$eval('#qq-number', el => el.textContent), '561101140');
  assert.equal(await page.$eval('[data-enter="8443"]', el => el.href), 'https://weishuxieyiwangye.cn:8443/');
  assert.equal(await page.$eval('[data-enter="icu"]', el => new URL(el.href).pathname), '/game.html');
  assert.equal(await page.$eval('[data-server="8443"] .tag', el => el.textContent), '友服');
  assert.equal(await page.$eval('[data-server="icu"] .tag', el => el.textContent), '本服');
  const serverOrder = await page.$$eval('.server-card', elements => elements.map(el => el.dataset.server));
  assert.deepEqual(serverOrder, ['8443', 'icu']);
  assert.equal(await page.$eval('#name-icu', el => el.firstChild.textContent.trim()), 'icu服');
  await page.waitForFunction(() => document.querySelector('#online-icu')?.textContent === '0');
  for (const [width, height] of views) {
    await page.setViewport({ width, height }); await pause(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `homepage overflow ${width}`);
    await page.screenshot({ path: `${out}/homepage-${width}x${height}.png`, fullPage: true });
  }
  await page.setViewport({ width: 1440, height: 900 });
  await page.click('[data-enter="icu"]'); await page.waitForSelector('.title-screen');
  await page.waitForSelector('.release-notes__content');
  report.highlights = await page.$$eval('.release-notes__content > .release-notes__changes > li:nth-child(-n+2)', elements => elements.map(el => el.textContent));
  assert.ok(report.highlights[0].includes('对抗模式（测试版）') && report.highlights[0].includes('尚非正式玩法'));
  assert.ok(report.highlights[1].includes('皮肤与语音语言'));
  await page.screenshot({ path: `${out}/release-highlights.png` });
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  assert.equal(new URL(page.url()).pathname, '/game.html');
  await page.click('[aria-label="设置"]'); await page.waitForSelector('.set-voice-lang');
  report.voiceOptions = await page.$$eval('.set-voice-lang option', elements => elements.map(el => ({ text: el.textContent, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })));
  assert.ok(report.voiceOptions.every(o => o.color === 'rgb(22, 34, 28)' && o.background === 'rgb(244, 247, 245)'));
  await page.select('.set-voice-lang', 'en');
  assert.equal(await page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get().voiceLang), 'en');
  for (const [width, height] of views.slice(0, 3)) {
    await page.setViewport({ width, height }); await pause(200);
    await page.$eval('.set-voice-lang', el => el.scrollIntoView({ block: 'center' }));
    const bounds = await page.$eval('.set-voice-lang', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height, JSON.stringify(bounds));
    await page.screenshot({ path: `${out}/settings-${width}x${height}.png` });
  }
  await page.keyboard.press('Escape'); await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('皮肤验收博士'));
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  await page.click('[data-testid="loadout-open"]'); await page.waitForSelector('.lo-card');
  await page.click('[data-tab="loadout"]');
  await page.click('[data-chess="chess_char_1_01_a"]');
  await page.waitForSelector('[aria-label="选择干员皮肤"]');
  report.skinOptions = await page.$$eval('[aria-label="选择干员皮肤"] option', elements => elements.map(el => ({ text: el.textContent, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })));
  assert.ok(report.skinOptions.every(o => o.color === 'rgb(22, 34, 28)' && o.background === 'rgb(244, 247, 245)'));
  const option = await page.$eval('[aria-label="选择干员皮肤"]', el => el.options[1]?.value);
  assert.ok(option?.startsWith('char_498_inside@'));
  await page.select('[aria-label="选择干员皮肤"]', option);
  await page.waitForFunction(() => document.querySelector('.lo-dhead__art img')?.src.includes('/cosmetics/') && document.querySelector('.lo-dhead__art img')?.naturalWidth > 0);
  const traits = await page.$$eval('.lo-garrison [data-garrison]', elements => elements.map(el => ({ id: el.dataset.garrison, text: el.textContent })));
  assert.equal(traits.length, 2);
  assert.ok(traits.every(g => g.text.includes('特质') && g.text.length > 10));
  report.traits = traits;
  for (const [width, height] of views.slice(0, 3)) {
    await page.setViewport({ width, height }); await pause(250);
    await page.$eval('[aria-label="选择干员皮肤"]', el => el.scrollIntoView({ block: 'center' }));
    const bounds = await page.$eval('[aria-label="选择干员皮肤"]', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.top >= 0 && bounds.bottom <= height, JSON.stringify(bounds));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${out}/loadout-${width}x${height}.png` }); report.layouts.push({ width, height, bounds });
  }
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.lobby-screen');
  const saved = await page.evaluate(async () => ({ skin: (await import('/js/ui/cosmetics.js')).cosmeticsStore.get().choices.char_498_inside,
    voice: (await import('/js/ui/settings.js')).settingsStore.get().voiceLang }));
  assert.deepEqual(saved, { skin: option, voice: 'en' });
  await page.setViewport({ width: 1440, height: 900 });
  report.models = await page.evaluate(async () => {
    const { data } = await import('/js/data.js'), { assets } = await import('/js/assets.js');
    const { setSkin } = await import('/js/ui/cosmetics.js'), { createFieldView } = await import('/js/render/app.js');
    await data.loadAll('chess', 'stages', 'assets', 'local', 'items', 'tokens', 'backups'); assets.seed(data.get('assets'));
    const host = document.createElement('div'); host.id = 'cosmetics-qa-field';
    host.style.cssText = 'position:fixed;inset:0;background:#101714;z-index:99999'; document.body.append(host);
    const field = await createFieldView(host, { data, assets, board: '3d' });
    field.setStage(data.lookup('stages', 'act1autochess_m03')); field.setCamera('prep', { instant: true });
    field.setPrep({ board: [{ uid: 1, id: 'chess_char_1_01_a', kind: 'chess', row: 9, col: 4, dir: 'RIGHT' }], hand: [], temp: [] });
    window.__cosmeticsQA = { field, host, setSkin };
    return { expected: assets.spineEntry('char_498_inside').skel };
  });
  await page.waitForFunction(() => [...window.__cosmeticsQA.field.debug.views.values()].some(v => v.actor && v._actorEntry?.skel === window.__cosmeticsQA.field.debug.ctx.assets.spineEntry('char_498_inside').skel));
  await pause(700); await page.screenshot({ path: `${out}/skin-battle-model.png` });
  const model = await page.evaluate(() => [...window.__cosmeticsQA.field.debug.views.values()].map(v => ({ spine: v._actorEntry?.skel, width: v.actor?.spine?.getBounds().width, height: v.actor?.spine?.getBounds().height })));
  assert.ok(model.some(v => v.spine?.includes('/cosmetics/') && v.width > 20 && v.height > 20));
  report.models.loaded = model;
  report.models.layouts = [];
  for (const [width, height] of views.slice(0, 3)) {
    await page.setViewport({ width, height }); await pause(500);
    const bounds = await page.evaluate(() => {
      const v = [...window.__cosmeticsQA.field.debug.views.values()][0];
      const b = v.root.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height, visible: v.root.visible, culled: v.culled };
    });
    assert.ok(bounds.visible && !bounds.culled && bounds.x + bounds.width > 0 && bounds.x < width && bounds.y + bounds.height > 0 && bounds.y < height, JSON.stringify(bounds));
    await page.screenshot({ path: `${out}/skin-battle-${width}x${height}.png` });
    report.models.layouts.push({ width, height, bounds });
  }
  const pixels = await page.$('#cosmetics-qa-field');
  const png = await pixels.screenshot({ encoding: 'base64' });
  report.canvas = await page.evaluate(async encoded => {
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0; const colors = new Set();
    for (let i = 0; i < data.length; i += 64) if (data[i + 3]) { visible++; colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`); }
    return { visible, colors: colors.size };
  }, png);
  assert.ok(report.canvas.visible > 100 && report.canvas.colors > 50);
  const frameBefore = await page.evaluate(() => [...window.__cosmeticsQA.field.debug.views.values()][0].actor.spine.state.tracks[0]?.trackTime);
  await pause(250);
  const frameAfter = await page.evaluate(() => [...window.__cosmeticsQA.field.debug.views.values()][0].actor.spine.state.tracks[0]?.trackTime);
  assert.ok(frameAfter > frameBefore, 'skin model animation advances');
  report.models.animated = true;
  await page.evaluate(() => window.__cosmeticsQA.setSkin('char_498_inside', ''));
  await page.waitForFunction(() => [...window.__cosmeticsQA.field.debug.views.values()].some(v => v.actor && !v._actorEntry?.skel.includes('/cosmetics/')));
  report.models.reset = true;
  await page.evaluate(() => { window.__cosmeticsQA.field.destroy(); window.__cosmeticsQA.host.remove(); });
  report.voice = await page.evaluate(async () => {
    const { audio } = await import('/js/audio.js'), { data } = await import('/js/data.js');
    await audio.unlock(); audio.voiceNextAt = 0; audio.voiceTicket = null;
    const url = audio.voice('char_498_inside', 'skill', { slot: 2 });
    return { url, langs: Object.fromEntries(Object.entries(data.get('assets').audio.voice.banks).map(([lang, bank]) => [lang, Object.keys(bank).length])) };
  });
  assert.ok(report.voice.url?.includes('/voice/en/'));
  assert.equal((await fetch(server.url + report.voice.url)).status, 200);
  const production = await browser.newPage();
  production.on('pageerror', error => report.errors.push(error.message));
  await production.setViewport({ width: 1440, height: 900 });
  await production.setRequestInterception(true);
  production.on('request', request => {
    void (async () => {
      const url = new URL(request.url());
      if (url.origin !== 'https://weishuxieyi.icu') {
        await request.respond({ status: 503, body: '' }); return;
      }
      const response = await fetch(server.url + url.pathname + url.search);
      await request.respond({ status: response.status, contentType: response.headers.get('content-type') || 'text/plain', body: Buffer.from(await response.arrayBuffer()) });
    })().catch(error => report.errors.push(error.message));
  });
  // All requests are intercepted locally: this checks production URLs without contacting either live server.
  await production.goto('https://weishuxieyi.icu/', { waitUntil: 'domcontentloaded' });
  await production.waitForFunction(() => /^\d+$/.test(document.querySelector('#online-icu')?.textContent || ''));
  report.selector = await production.$$eval('.server-card', elements => elements.map(el => ({ id: el.dataset.server,
    label: el.querySelector('h3').textContent, href: el.querySelector('[data-enter]').href })));
  assert.equal(report.selector[0].href, 'https://weishuxieyiwangye.cn:8443/');
  assert.equal(report.selector[1].href, 'https://weishuxieyi.icu/game.html');
  assert.equal(new URL(production.url()).pathname, '/');
  await production.screenshot({ path: `${out}/server-selector-production.png`, fullPage: true });
  await production.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack; await page.screenshot({ path: `${out}/failure.png` }).catch(() => {}); throw error;
} finally {
  writeFileSync(`${out}/browser.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report));
