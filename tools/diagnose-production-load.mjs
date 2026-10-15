/* global document */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const generation = process.argv[2];
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(generation || '')) throw new Error('Provide the active generation');
const base = `https://weishuxieyi.icu/_build/${generation}/`;
const output = path.resolve(process.env.LOAD_QA_OUT || 'test/e2e/out/production-load');
await fs.mkdir(output, { recursive: true });
const report = { generation, startedAt: new Date().toISOString(), errors: [], failures: [], completed: [], snapshots: [] };
const started = Date.now(), pending = new Map();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-proxy-server', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => pending.set(request, Date.now()));
  page.on('requestfinished', request => {
    report.completed.push({ url: request.url(), seconds: (Date.now() - (pending.get(request) || Date.now())) / 1000,
      status: request.response()?.status() }); pending.delete(request);
  });
  page.on('requestfailed', request => {
    report.failures.push({ url: request.url(), error: request.failure()?.errorText }); pending.delete(request);
  });
  await page.goto(base + 'game.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  let requested = false;
  for (let sample = 0; sample < 10; sample++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const state = await page.evaluate(() => {
      const sp = globalThis.__SP__;
      const files = ['config', 'assets', 'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses', 'stages', 'tokens', 'choices', 'effects', 'garrisons', 'factions', 'local', 'backups'];
      return { booted: !!sp, connection: sp?.store.get().connection.status,
        worker: navigator.serviceWorker?.controller?.scriptURL,
        data: sp ? Object.fromEntries(files.map(name => [name, sp.data.status(name)])) : null,
        body: document.body.innerText.slice(0, 160) };
    });
    if (state.booted && !requested) {
      await page.evaluate(() => {
        const files = ['config', 'assets', 'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses', 'stages', 'tokens', 'choices', 'effects', 'garrisons', 'factions', 'local', 'backups'];
        globalThis.__SP__.data.loadAll(...files);
      });
      requested = true;
    }
    report.snapshots.push({ seconds: (Date.now() - started) / 1000, state,
      pending: [...pending].map(([request, at]) => ({ url: request.url(), seconds: (Date.now() - at) / 1000 })) });
    console.log(JSON.stringify(report.snapshots.at(-1)));
    if (requested && Object.values(state.data || {}).every(status => status === 'ready')) break;
  }
  await page.screenshot({ path: path.join(output, 'cold-phone.png') });
  report.timings = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({
    name: entry.name, milliseconds: entry.duration, transferred: entry.transferSize, decoded: entry.decodedBodySize }))) ;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, errors: report.errors, failures: report.failures, error: report.error }));
}
