/* global window */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = path.resolve('.cache/network-live-20261014'); mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), failures: [], errors: [], httpErrors: [], requests: [], workerRequests: [] };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-proxy-server', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('requestfailed', r => report.failures.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => {
    if (r.status() >= 400) report.httpErrors.push({ url: r.url(), code: r.status() });
    if (/\.skel|\.atlas|\.png|resource-routes|worker\.js/.test(r.url())) report.requests.push({ url: r.url(), code: r.status(), source: r.headers()['x-sp-resource-source'], cache: r.headers()['x-sp-resource-cache'] });
  });
  await page.goto('https://weishuxieyi.icu/game.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => window.__SP__, { timeout: 45000 });
  await page.evaluate(() => window.__SP__.data.loadAll('assets', 'local'));
  await new Promise(r => setTimeout(r, 4000));
  report.registration = await page.evaluate(async () => ({ url: window.location.href, controller: navigator.serviceWorker?.controller?.scriptURL,
    registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.scriptURL, waiting: r.waiting?.scriptURL, installing: r.installing?.scriptURL })) }));
  console.log(JSON.stringify({ registration: report.registration }));
  if (process.argv.includes('--no-reload')) {
    assert.ok(report.registration.controller, 'first navigation must be controlled without a manual reload');
    if (process.env.SP_QA_BUILD) assert.ok(report.registration.controller.includes('/_build/' + process.env.SP_QA_BUILD + '/'));
  } else if (!report.registration.controller) { await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForFunction(() => window.__SP__); }
  await page.waitForFunction(() => navigator.serviceWorker?.controller, { timeout: 20000 });
  const target = await browser.waitForTarget(t => t.type() === 'service_worker', { timeout: 10000 });
  const session = await target.createCDPSession(); await session.send('Network.enable');
  session.on('Network.responseReceived', e => {
    if (/assets|resource-routes/.test(e.response.url)) report.workerRequests.push({ url: e.response.url, code: e.response.status,
      ray: e.response.headers['cf-ray'] || e.response.headers['CF-RAY'], cors: e.response.headers['access-control-allow-origin'] || e.response.headers['Access-Control-Allow-Origin'] });
  });
  session.on('Network.loadingFailed', e => report.failures.push({ worker: true, error: e.errorText, cors: e.corsErrorStatus }));
  report.result = await page.evaluate(async () => {
    const base = new URL('.', window.location.href).pathname;
    const { ensurePixi } = await import(base + 'js/render/app/pixi.js'); await ensurePixi();
    const { assets } = await import(base + 'js/assets.js');
    assets.seed(window.__SP__.data.get('assets')); assets.seedLocal(window.__SP__.data.get('local'));
    const results = [];
    for (const id of ['char_003_kalts', 'enemy_1000_gopro_2', 'char_010_chen']) {
      const entry = assets.spineEntry(id), at = performance.now();
      if (!entry) { results.push({ id, error: 'missing manifest' }); continue; }
      try { const model = await assets.spine.acquire(entry); results.push({ id, ms: performance.now() - at, animations: model.animations.length, skel: entry.skel }); }
      catch (e) { results.push({ id, ms: performance.now() - at, error: e.message, skel: entry.skel }); }
      finally { assets.spine.release(entry); }
    }
    return { url: window.location.href, worker: navigator.serviceWorker.controller.scriptURL, results, stats: assets.spine.stats() };
  });
  for (const model of report.result.results) assert.ok(!model.error && model.animations > 0, JSON.stringify(model));
  if (process.argv.includes('--no-reload')) {
    const modelRequests = report.requests.filter(row => /\/spine\/.*\.(skel|atlas|png)$/.test(row.url));
    assert.ok(modelRequests.length >= 9, 'all model files must finish');
    assert.ok(modelRequests.every(row => row.source === 'r2' || row.cache === 'HIT'), 'hashed model URLs must use CDN/cache, not silent origin fallback');
    assert.equal(report.workerRequests.filter(row => /resource-routes/.test(row.url) && row.code >= 400).length, 0);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (e) { report.error = e.stack; console.log(e.stack); process.exitCode = 1; }
finally { writeFileSync(path.join(out, 'browser-models.json'), JSON.stringify(report, null, 2)); await browser.close(); }
