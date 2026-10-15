/* global location, document, caches */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';

const output = path.resolve(process.argv[2] || '../../outputs/resource-preload-qa');
await fs.mkdir(output, { recursive: true });
const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [];
try {
  for (const [width, height] of [[1440, 900], [844, 390]]) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status));
    } catch (error) {
      console.log(JSON.stringify({ errors, page: await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-2000), state: globalThis.__SP__?.store.get().connection })) }));
      throw error;
    }
    // No manual warm call: the real boot scheduler must initiate background downloads.
    try { await page.waitForFunction(async () => {
      const { resourceCacheAction } = await import('/js/resources/client.js');
      try { return (await resourceCacheAction()).preload.completed >= 3; } catch { return false; }
    }, { timeout: 25000, polling: 1000 }); } catch (error) {
      console.log(JSON.stringify({ errors, debug: await page.evaluate(async () => {
        const { cacheSupported, resourceCacheAction } = await import('/js/resources/client.js');
        try { return { supported: cacheSupported(), registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.state, installing: r.installing?.state })), status: await resourceCacheAction(), warm: await resourceCacheAction('warm') }; }
        catch (e) { return { supported: cacheSupported(), error: e.message }; }
      }) })); throw error;
    }
    const result = await page.evaluate(async () => {
      const { resourceCacheAction } = await import('/js/resources/client.js');
      const manifest = await (await fetch('/data/resource-cache.json')).json();
      const cache = await caches.open('sp-resource-content-v1');
      const url = Object.entries(manifest.entries).find(([, item]) => item.hash && item.bytes > 0);
      let hit;
      for (const [asset, item] of Object.entries(manifest.entries)) {
        if (await cache.match(location.origin + '/__sp_resource_content/' + item.hash)) {
          const response = await fetch(asset); hit = { url: asset, header: response.headers.get('x-sp-resource-cache') }; break;
        }
      }
      return { status: await resourceCacheAction(), hit, manifestFiles: manifest.count, example: url?.[0] };
    });
    assert.equal(result.hit.header, 'HIT');
    if (await page.$('.release-notes .modal__actions button')) {
      await page.click('.release-notes .modal__actions button');
      await page.waitForFunction(() => !document.querySelector('.release-notes'));
    }
    await page.$eval('.title-settings', e => e.click());
    try { await page.waitForSelector('.set-resource-cache', { timeout: 5000 }); }
    catch (error) { console.log(JSON.stringify({ width, errors, text: await page.evaluate(() => document.body.innerText.slice(-3000)) })); throw error; }
    const text = await page.$eval('.set-resource-cache', e => e.textContent);
    assert.ok(text.includes('后台预下载'));
    await page.screenshot({ path: path.join(output, `settings-${width}.png`) });
    assert.deepEqual(errors, []);
    results.push({ viewport: [width, height], ...result, errors });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }
