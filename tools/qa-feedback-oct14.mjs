/* global window, document, getComputedStyle */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from '../server/index.js';

const out = resolve('.cache/feedback-oct14'); mkdirSync(out, { recursive: true });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], ui: [], healing: [] };
try {
  for (const [width, height, touch] of [[1440, 900, false], [844, 390, true], [1920, 864, true]]) {
    const page = await browser.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.setViewport({ width, height, hasTouch: touch });
    await page.goto(server.url + '/dev/game-mock.html?phase=PREP&variant=vote8&shot=1&map=official');
    await page.waitForSelector('.prep-vote__ballot', { timeout: 60000 });
    await page.waitForFunction(() => window.__SP_VIEW__?.raw?.debug?.board3d, { timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    const ui = await page.evaluate(async () => {
      const { isMobileCamera } = await import('/js/ui/fieldHost.js');
      const view = window.__SP_VIEW__.raw, cam = view.debug.ctx.cam();
      const row = document.querySelector('.shopbar__row').getBoundingClientRect();
      const host = document.querySelector('.gm__field').getBoundingClientRect();
      const bench = cam.project(cam.tx, 6.5, .16).y + host.top;
      const ballot = document.querySelector('.prep-vote__ballot').getBoundingClientRect();
      const button = document.querySelector('.prep-vote__choices button');
      const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { mobile: isMobileCamera({ width: window.innerWidth, height: window.innerHeight }),
        gap: row.top - bench, shopTop: row.top, bench, tileScale: cam.scaleAt(5, 10),
        countdown: document.querySelector('.prep-vote__countdown').textContent,
        ballot: { x: ballot.x, y: ballot.y, right: ballot.right, bottom: ballot.bottom },
        clickable: !!hit && button.contains(hit), stats: view.stats() };
    });
    assert.equal(ui.mobile, touch);
    if (touch) assert.ok(ui.gap >= 7 && ui.gap <= 12, JSON.stringify(ui));
    assert.ok(ui.clickable, JSON.stringify(ui));
    assert.ok(ui.ballot.x >= 0 && ui.ballot.right <= width && ui.ballot.bottom <= height);
    await page.screenshot({ path: `${out}/prep-${width}x${height}.png` });
    report.ui.push({ width, height, ...ui });
    await page.evaluate(async () => {
      const { render } = await import('/vendor/preact.module.js');
      const { html } = await import('/js/ui/components.js');
      const { ReleaseNotesHost, openReleaseNotes } = await import('/js/ui/releaseNotes.js');
      const host = document.createElement('div'); document.body.appendChild(host);
      render(html`<${ReleaseNotesHost}/>`, host); openReleaseNotes();
    });
    await page.waitForSelector('.release-notes .modal__title-hint');
    const notes = await page.evaluate(() => ({
      micro: document.querySelector('.release-notes .micro').textContent,
      hint: document.querySelector('.release-notes .modal__title-hint').textContent,
      color: getComputedStyle(document.querySelector('.release-notes .modal__title-hint')).color,
    }));
    assert.match(notes.micro, /0\.2\.6/); assert.match(notes.hint, /PC.*手机.*561101140/);
    assert.equal(notes.color, 'rgb(255, 227, 131)');
    await page.screenshot({ path: `${out}/notes-${width}x${height}.png` });
    await page.close();
  }

  for (const [width, height] of [[1440, 900], [844, 390]]) {
    const page = await browser.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.setViewport({ width, height });
    await page.goto(server.url + '/dev/render-demo.html?scene=normal-m01&t=18&panel=0');
    await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__demo.error || null), null);
    await page.waitForFunction(() => [...window.__demo.view.debug.views.values()].some(v => v.info?.side === 'ally' && v.info?.kind !== 'device'), { timeout: 30000 });
    await page.waitForFunction(() => window.__demo.view.stats().spine?.ready >= 5, { timeout: 60000 });
    const healing = await page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      const { TRIO_UNITE_RECT } = await import('/shared/uniteLayout.js');
      const { layerCamera } = await import('/js/battle/observe.js');
      const { view } = window.__demo; window.__demo.pause();
      const { fx, ctx, app, views } = view.debug;
      const original = [...views.values()].find(v => v.info?.side === 'ally' && v.info?.kind !== 'device');
      if (!original) throw new Error('no operator model');
      const template = { ...original.info, kind: 'op', side: 'ally' };
      view.enterBattle({ fieldId: 'qa-trio', stageId: data.lookup('stages', 'act1autochess_m01').id,
        kind: 'unite', rect: TRIO_UNITE_RECT, units: [] });
      const until = performance.now() + 30000;
      while (!view.debug.board3d?.official && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      if (!view.debug.board3d?.official) throw new Error('official trio scene did not finish loading');
      let mapImage;
      const field = { kind: 'unite', rect: TRIO_UNITE_RECT, players: ['a', 'b', 'c'] };
      const layers = [];
      const sample = () => {
        app.renderer.render(app.stage);
        const p = app.renderer.extract.pixels(); let white = 0, nonblank = 0;
        for (let i = 0; i < p.length; i += 4) {
          if (p[i + 3] > 0) nonblank++;
          if (p[i] > 245 && p[i + 1] > 245 && p[i + 2] > 245 && p[i + 3] > 200) white++;
        }
        return { whiteFraction: white / (p.length / 4), nonblank };
      };
      for (const layer of ['R', 'ALL', 'T', 'R']) {
        view.setCamera('unite', { ...layerCamera(field, layer), instant: true });
        fx.clear();
        // Exercise every healer class through shared events, including skill-only healers.
        const a = { ...template, id: 901, x: 13, y: 3, z: .42, alive: true, _headTiles: 1.3 };
        const b = { ...a, id: 902, x: 15, y: 3 };
        for (let i = 0; i < 30; i++) {
          fx.heal(b, 100); fx.attack(a, b, 'orb'); fx.attack(a, b, 'chainHeal');
          fx.simFx('healAoe', b.x, b.y, { r: 2 }); fx.simFx('blessing', b.x, b.y, { r: 2 });
          fx.simFx('cleanse', b.x, b.y, { r: 1 });
        }
        fx.update(.08); const pixels = sample();
        view.debug.board3d.render(ctx.cam(), fx.time);
        if (layer === 'ALL') mapImage = view.debug.board3d.canvas.toDataURL('image/png');
        layers.push({ layer, projection: ctx.cam().project(15, 3, 1), ...pixels });
      }
      // Force a near-plane frame while the camera moves, then ensure no stale visual survives returning home.
      const cam = ctx.cam(), project = cam.project;
      cam.project = (_x, _y, _z, p = {}) => Object.assign(p, { x: app.screen.width / 2, y: app.screen.height / 2, s: 1e8, depth: .05 });
      fx.clear();
      fx.attack({ x: 13, y: 3, z: 0 }, { x: 15, y: 3, z: 0 }, 'orb');
      fx.simFx('healAoe', 15, 3, { r: 2 }); fx.simFx('cleanse', 15, 3, { r: 2 });
      fx.heal({ id: 903, x: 15, y: 3 }, 100); fx.update(.02);
      const stress = sample(); cam.project = project;
      view.setPrep({ hand: [], board: [], temp: [], loadout: {}, funds: 0, deployCap: 8, deployCount: 0 }, { editable: true });
      const cleared = !fx.parts.length && !fx.projs.length && !fx.rings.length && fx.tintSprite.alpha === 0;
      return { layers, stress, cleared, mapImage, stats: view.stats() };
    });
    assert.ok(healing.cleared);
    assert.ok(healing.stress.whiteFraction < .05, JSON.stringify(healing.stress));
    assert.ok(healing.layers.every(l => l.whiteFraction < .15), JSON.stringify(healing.layers));
    assert.ok(healing.stats.board3d.on);
    assert.ok(healing.stats.board3d.triangles > 1000);
    writeFileSync(`${out}/trio-${width}x${height}.png`, Buffer.from(healing.mapImage.split(',')[1], 'base64'));
    delete healing.mapImage;
    report.healing.push({ width, height, ...healing });
    await page.screenshot({ path: `${out}/returned-${width}x${height}.png` });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ passed: true, ui: report.ui, healing: report.healing }, null, 2));
} finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
