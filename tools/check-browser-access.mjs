import { chromium, firefox, webkit } from 'file:///C:/Users/34775/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'D:/Codex/2026-10-10/a/outputs/browser-access';
mkdirSync(out, { recursive: true });
const report = [];
const preview = process.argv.find(arg => arg.startsWith('https://')) || process.env.SP_GAME_PREVIEW;
const selectedEngines = process.argv.slice(2).filter(arg => ['chromium', 'firefox', 'webkit'].includes(arg));
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  if (selectedEngines.length && !selectedEngines.includes(name)) continue;
  let browser;
  let page;
  const pending = new Set();
  const result = { engine: name, errors: [], failedRequests: [] };
  try {
    const executablePath = {
      chromium: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      firefox: 'C:/Users/34775/AppData/Local/ms-playwright/firefox-1522/firefox/firefox.exe',
      webkit: 'C:/Users/34775/AppData/Local/ms-playwright/webkit-2287/Playwright.exe',
    }[name];
    browser = await type.launch({ headless: true, executablePath, ...(name === 'chromium' ? { args: ['--disable-quic'] } : {}) });
    page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    page.on('request', request => pending.add(request.url()));
    page.on('requestfinished', request => pending.delete(request.url()));
    page.on('requestfailed', request => pending.delete(request.url()));
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    const response = await page.goto(preview || 'https://weishuxieyi.icu/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.status = response.status();
    result.url = page.url();
    result.userAgent = await page.evaluate(() => navigator.userAgent);
    if (!preview) {
      await page.locator('#name-8443').waitFor({ state: 'visible', timeout: 10000 });
      result.selectorVisible = true;
      await page.locator('[data-enter="icu"]').click();
    }
    await page.locator('.title-screen').waitFor({ state: 'visible', timeout: 60000 });
    result.titleVisible = true;
    await page.screenshot({ path: out + '/' + name + '-title.png' });
    result.bootMessage = await page.locator('#boot-err').textContent().catch(() => null);
    result.ok = true;
  } catch (error) {
    result.error = error.message;
    result.pending = [...pending];
    if (page) {
      result.url = page.url();
      result.body = await page.locator('body').innerText().catch(() => null);
      await page.screenshot({ path: out + '/' + name + '-failure.png' }).catch(() => {});
    }
  } finally {
    console.log(JSON.stringify(result));
    await browser?.close();
  }
  report.push(result);
  writeFileSync(out + '/engines.json', JSON.stringify(report, null, 2));
}
