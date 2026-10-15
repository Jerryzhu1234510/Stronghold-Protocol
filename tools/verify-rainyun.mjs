/* global window, document */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { TestClient } from '../test/helpers/wsClient.js';

const origin = 'https://64-90-4-56.sslip.io';
const browserOrigin = process.env.SP_QA_BROWSER_ORIGIN || origin;
const out = path.resolve('.cache/rainyun-qa');
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP weishuxieyi.icu 64.90.4.56',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(), report = { errors: [], failedRequests: [], sceneRequests: [] };
let peer;
page.on('pageerror', e => report.errors.push(e.message));
page.on('requestfailed', r => { if (!r.failure()?.errorText?.includes('ERR_ABORTED')) report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }); });
page.on('response', r => { if (/\/assets\/(?:~[^/]+\/)?local\/scene\//.test(r.url())) report.sceneRequests.push({ url: r.url(), status: r.status() }); });
const request = (t, fields = {}) => page.evaluate((t, fields) => window.__SP__.net.request(t, fields), t, fields);
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(browserOrigin + '/game.html?board=3d', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__SP__, { timeout: 60000 });
  await page.evaluate(() => {
    window.__SP__.store.patch('session', { entered: true });
    window.__SP__.net.setName('worker-check');
  });
  await page.waitForFunction(() => window.__SP__.store.get().connection.status === 'online', { timeout: 15000 });
  await page.waitForFunction(() => {
    const values = [...document.querySelectorAll('[data-population] strong')];
    return values.length === 5 && values.every(node => /^\d+$/.test(node.textContent.trim()));
  }, { timeout: 20000 });
  report.population = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-population]')]
    .map(node => [node.dataset.population, Number(node.querySelector('strong').textContent)])));
  await request('room.create', { mode: 'solo', difficulty: 'FUNNY', mapVersion: 'official', visibility: 'private' });
  await request('room.start');
  await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'INFO_CHECK', { timeout: 20000 });
  report.generation = await page.evaluate(() => window.__SP_GENERATION);
  report.pageUrl = page.url();
  peer = await TestClient.connect(origin.replace('https:', 'wss:') + `/_build/${report.generation}/ws`, { timeout: 10000 });
  await peer.hello('worker-two');
  for (const msg of [{ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', visibility: 'private' }, { t: 'room.start' }]) {
    const reply = await peer.request(msg, 10000); assert.equal(reply.t, 'ok', JSON.stringify(reply));
  }
  await peer.waitFor('m.public', p => p.phase === 'INFO_CHECK', 10000);
  const health = await fetch(origin + '/healthz').then(r => r.json());
  assert.ok(health.matchWorkers.every(w => w.matches >= 1));
  assert.ok(health.matchWorkers.reduce((n, w) => n + w.matches, 0) >= 2);
  report.matchWorkers = health.matchWorkers;
  const manifest = await fetch(origin + `/_build/${report.generation}/data/local-assets.json`).then(r => r.json());
  report.sceneGroups = Object.keys(manifest.groups).filter(g => g.startsWith('scene/'));
  assert.equal(report.sceneGroups.length, 12);
  const sceneUrl = new URL(manifest.groups['scene/act2autochess_m01'].bin.path, origin);
  const sceneResponse = await fetch(sceneUrl, { method: 'HEAD' });
  report.sceneProbe = { url: sceneUrl.href, status: sceneResponse.status,
    bytes: Number(sceneResponse.headers.get('content-length')), cacheControl: sceneResponse.headers.get('cache-control') };
  assert.equal(report.sceneProbe.status, 200);
  assert.ok(report.sceneProbe.bytes > 1000000);
  assert.ok(report.sceneProbe.cacheControl.includes('immutable'));
  await request('g.infoReady');
  await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'BAND_DRAFT', { timeout: 15000 });
  await request('g.band', { bandId: 'band_sarkazb' });
  await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'PREP', { timeout: 20000 });
  // Render the updated official scene independently as well, so its geometry is verifiable rather than inferred from a selector.
  report.board = await page.evaluate(async () => {
    const base = `/_build/${window.__SP_GENERATION}`;
    const [{ createFieldView }, { data }, { assets }, { boardAppearance }] = await Promise.all([
      import(base + '/js/render/app.js'), import(base + '/js/data.js'), import(base + '/js/assets.js'), import(base + '/shared/roomDirectory.js')]);
    await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0a0e0d'; document.body.appendChild(host);
    const view = await createFieldView(host, { data, assets, settings: { quality: 'medium' }, ...boardAppearance('official') });
    view.setStage(data.lookup('stages', 'act2autochess_m01')); view.setCamera('unite', { instant: true });
    window.__rainyunBoard = view;
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const stats = view.stats();
      if (stats.board3d.on && stats.board3d.triangles > 10000) return stats;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('official scene geometry did not load');
  });
  assert.ok(report.board.board3d.triangles > 10000);
  await page.screenshot({ path: path.join(out, 'official-desktop.png') });
  // Keep emulation flags stable: changing them reloads the page and destroys the test view.
  await page.setViewport({ width: 844, height: 390 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(out, 'official-mobile.png') });
  const frames = report.board.board3d.frames;
  report.mobileBoard = await page.evaluate(() => window.__rainyunBoard.stats());
  assert.ok(report.mobileBoard.board3d.frames > frames);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  try { await request('room.leave'); } catch { /* disconnected */ }
  try { if (peer?.isOpen) await peer.request({ t: 'room.leave' }, 10000); } catch { /* disconnected */ }
  await peer?.terminate();
  await browser.close();
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
