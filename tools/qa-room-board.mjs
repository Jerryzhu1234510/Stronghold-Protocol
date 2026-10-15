/* global document, window */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startServer } from '../server/index.js';
const out = path.resolve('../../outputs/public-room-lobby'); mkdirSync(out, { recursive: true });
const stages = Object.values(JSON.parse(readFileSync('data/stages.json', 'utf8')));
const stageResults = [], signatures = new Map();
const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
try {
  for (const appearance of ['classic', 'new']) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const requests = [], errors = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${srv.port}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (appearance) => {
      const [{ createFieldView }, { data }, { assets }, { boardAppearance }] = await Promise.all([
        import('/js/render/app.js'), import('/js/data.js'), import('/js/assets.js'), import('/shared/roomDirectory.js')]);
      await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0a0e0d'; document.body.appendChild(host);
      const view = await createFieldView(host, { data, assets, settings: { quality: 'medium' }, ...boardAppearance(appearance) });
      view.setStage(data.lookup('stages', 'act2autochess_m01')); view.setCamera('unite', { instant: true });
      window.__boardTest = view;
    }, appearance);
    for (const stage of stages) {
      for (const camera of ['normal', 'unite', 'boss']) {
        const rendered = await page.evaluate(async (id, camera) => {
          const { data } = await import('/js/data.js');
          const view = window.__boardTest, stage = data.lookup('stages', id);
          view.setStage(stage); view.setCamera(camera, { instant: true });
          await new Promise((r) => window.requestAnimationFrame(() => window.requestAnimationFrame(r)));
          return { stats: view.stats(), stageId: view.debug.tiles.stage.id, signature: view.debug.tiles.grid.map((row) => row.map((tile) => `${tile.glyph}:${tile.h}`).join(',')).join('|') };
        }, stage.id, camera);
        assert.equal(rendered.stats.board3d.on, appearance === 'classic', `${stage.id}/${camera}: ${JSON.stringify(rendered.stats.board3d)}`);
        assert.equal(rendered.stats.boardArt, appearance === 'classic', `${stage.id}/${camera}`);
        assert.equal(rendered.stageId, stage.id);
        assert.ok(Object.values(rendered.stats.camera).every(Number.isFinite), `${stage.id}/${camera}: finite camera`);
        const key = `${stage.id}/${camera}`;
        if (appearance === 'classic') signatures.set(key, rendered.signature);
        else assert.equal(rendered.signature, signatures.get(key), `${key}: both appearances preserve terrain and heights`);
        stageResults.push({ appearance, stageId: stage.id, active: stage.active, camera, board3d: rendered.stats.board3d.on, boardArt: rendered.stats.boardArt });
        if (camera === 'unite') await page.screenshot({ path: path.join(out, `board-${appearance}-${stage.id}.png`) });
      }
    }
    await page.evaluate(async () => { const { data } = await import('/js/data.js'); window.__boardTest.setStage(data.lookup('stages', 'act2autochess_m01')); window.__boardTest.setCamera('unite', { instant: true }); });
    await new Promise((r) => setTimeout(r, 1800));
    const stats = await page.evaluate(() => window.__boardTest.stats());
    assert.equal(stats.board3d.on, appearance === 'classic', JSON.stringify(stats.board3d));
    assert.equal(stats.boardArt, appearance === 'classic');
    assert.deepEqual(errors, []);
    if (appearance === 'new') assert.equal(requests.some((p) => p.includes('TX_autochessi') || p.includes('three.module')), false, 'simplified board does not load classic materials or three.js');
    await page.screenshot({ path: path.join(out, `board-${appearance}.png`) });
    results.push({ appearance, boardArt: stats.boardArt, board3d: stats.board3d, errors });
    if (appearance === 'classic') {
      await page.evaluate(() => window.__boardTest.setBoardMode('2d'));
      const fallback = await page.evaluate(() => window.__boardTest.stats());
      assert.equal(fallback.board3d.on, false); assert.equal(fallback.boardArt, true);
      await page.screenshot({ path: path.join(out, 'board-classic-fallback.png') });
      results.push({ appearance: 'classic-2d-fallback', boardArt: true, board3d: fallback.board3d });
    }
    await page.evaluate(() => window.__boardTest.destroy()); await context.close();
  }
  writeFileSync(path.join(out, 'board-qa.json'), JSON.stringify({ passed: true, results, stages: stages.length, activeStages: stages.filter((s) => s.active).length, stageResults }, null, 2));
  console.log(JSON.stringify({ passed: true, stages: stages.length, activeStages: stages.filter((s) => s.active).length, checks: stageResults.length, results }));
} finally { await browser.close(); await srv.close(); }
