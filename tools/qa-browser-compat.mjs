import { chromium, firefox, webkit } from 'file:///C:/Users/34775/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { startServer } from '../server/index.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'D:/Codex/2026-10-10/a/outputs/browser-access';
mkdirSync(out, { recursive: true });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const report = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true, executablePath: {
      chromium: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      firefox: 'C:/Users/34775/AppData/Local/ms-playwright/firefox-1522/firefox/firefox.exe',
      webkit: 'C:/Users/34775/AppData/Local/ms-playwright/webkit-2287/Playwright.exe',
    }[name] });
    try {
      console.log(name + ': launch');
      const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
      await context.addInitScript(() => {
        for (const [target, key] of [[AbortSignal, 'timeout'], [Promise, 'allSettled'], [crypto, 'randomUUID'], [HTMLScriptElement, 'supports'], [Array.prototype, 'at'], [Array.prototype, 'findLast'], [Array.prototype, 'findLastIndex'], [Object, 'hasOwn'], [window, 'structuredClone'], [Element.prototype, 'replaceChildren']]) {
          Object.defineProperty(target, key, { value: undefined, writable: true, configurable: true });
        }
      });
      await context.route('**/versus.html?*', route => route.fulfill({ contentType: 'text/html', body: readFileSync('public/js/browser/versus.html', 'utf8') }));
      const page = await context.newPage();
      const errors = [], scripts = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
      await page.goto(server.url + '/js/browser/server-lobby.html', { waitUntil: 'domcontentloaded' });
      console.log(name + ': selector');
      await page.locator('#name-8443').waitFor();
      await page.waitForFunction(() => !document.getElementById('refresh-status').disabled);
      await page.goto(server.url + '/js/browser/game.html', { waitUntil: 'domcontentloaded' });
      await page.locator('.title-screen').waitFor({ timeout: 15000 });
      console.log(name + ': title');
      const dismiss = page.getByRole('button', { name: '我知道了', exact: true });
      if (await dismiss.count()) await dismiss.click();
      assert.ok(await page.evaluate(() => typeof AbortSignal.timeout === 'function' && typeof crypto.randomUUID === 'function'));
      await page.locator('.title-login input').fill('兼容验收');
      await page.getByRole('button', { name: '进入大厅', exact: true }).click();
      await page.locator('.lobby-screen').waitFor();
      await page.waitForFunction(() => window.__SP__.store.get().connection.status === 'online');
      await page.screenshot({ path: `${out}/${name}-compat-lobby.png` });
      const code = await page.evaluate(async () => {
        const { net, store } = window.__SP__;
        await net.request('room.create', { mode: 'coop', difficulty: 'HARD', capacity: 4 });
        await net.request('room.setGameMode', { gameMode: 'versus' });
        for (let i = 0; i < 3; i++) await net.request('room.addBot');
        await net.request('room.start');
        return store.get().room.code;
      });
      await page.locator('.brief-bonds').first().waitFor();
      await page.evaluate(() => window.__SP__.net.request('g.infoReady'));
      const frame = page.frameLocator('iframe[title="对抗模式（测试）"]');
      await frame.locator('.field').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => {
        const frame = document.querySelector('iframe');
        return !!frame?.contentWindow.__versusView && !!frame.contentWindow.__versusState()?.field;
      }, null, { timeout: 45000 });
      await page.screenshot({ path: `${out}/${name}-compat-versus.png` });
      assert.deepEqual(errors, []);
      report.push({ engine: name, oldApisRemoved: true, selector: true, lobby: true, versus: true, errors, scriptRequests: scripts.length, code });
      console.log(JSON.stringify(report.at(-1)));
      await context.close();
    } finally { await browser.close(); }
  }
} finally {
  writeFileSync(out + '/compat-local.json', JSON.stringify(report, null, 2));
  await server.close();
}
