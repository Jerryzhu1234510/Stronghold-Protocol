/* global window */
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';

const out = path.resolve('.cache/hidden-pipe-position', process.argv.includes('--after') ? 'after' : 'before');
await mkdir(out, { recursive: true });
const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], samples: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
  await page.setViewport(viewport);
  await page.goto(server.url + '/dev/render-demo.html?scene=prep&fa=L&stage=act2autochess_m02&panel=0&board=3d');
  await page.waitForFunction(() => window.__demo?.ready, { timeout: 60000 });
  for (const side of ['L', 'R']) {
    for (const key of ['enemy_2016_csphtm', 'enemy_9021_acduml', 'enemy_9021_acduml_2']) {
      if (key.endsWith('_2')) {
        await page.evaluate(() => {
          const view = window.__demo.view;
          const info = { id: 9900, kind: 'enemy', side: 'enemy', defId: 'enemy_2016_csphtm',
            spine: 'enemy_2016_csphtm', x: 7, y: 4, maxHp: 100, boss: true };
          view.enterBattle({ fieldId: 'phantom-qa', kind: 'boss', units: [info] });
          for (const gt of [0, 0.1]) view.pushSnapshot({ fieldId: 'phantom-qa', gt, units: [[9900, 7, 4, 100, 100, 0, 0, 0, 0]] });
        });
        await page.waitForFunction(() => window.__demo.view.debug.views.get(9900)?.spineReady, { timeout: 30000 });
      }
      await page.evaluate(({ side, key }) => {
        const v = window.__demo.view;
        v.debug.ctx.impostorInterval = () => 0;
        v.debug.ctx.loadLevel = () => 0;
        const state = structuredClone(window.__demo.scene.state);
        state.nextEnemies = [{ enemyKey: key, boss: true, elite: true, count: 1, start: [3, key.endsWith('_2') ? 9 : 10] }];
        v.setCamera('bossPrep', { side, instant: true });
        v.setPrep(state, { editable: true });
        v.highlightTiles([[10, 5]], { group: 'facing', color: 0xff9c33 });
      }, { side, key });
      await page.waitForFunction(() => !!window.__demo.view.debug.leader?.view.actor, { timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 500));
      const sample = await page.evaluate(() => {
        const { view } = window.__demo, d = view.debug, l = d.leader, v = l.view;
        const bounds = v.actor.spine.getBounds();
        return { root: { x: v.x, y: v.y, facing: v.visFacing, px: v.root.x, py: v.root.y },
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          scale: { x: v.actor.spine.scale.x, y: v.actor.spine.scale.y },
          hitArea: l.area, stand: { row: l.stand.row, col: l.stand.col },
          body: { x: v.body.x, y: v.body.y },
          stalePhantom: d.views.has(9900),
          pivot: d.cam.project(v.x + v.modelPivotX, v.y, v.z + v.hover + v.lift, {}),
          origin: d.cam.project(v.x + v.modelPivotX - v.visFacing * v.modelPivotX, v.y, v.z + v.hover + v.lift, {}),
          bones: v.actor.spine.skeleton.bones.slice(0, 6).map(b => ({ name: b.data.name, x: b.x, y: b.y })),
          board: view.stats().board3d };
      });
      assert.equal(sample.root.x, key.endsWith('_2') ? 9 : 10);
      assert.equal(sample.root.y, 3);
      assert.equal(sample.stalePhantom, false);
      assert.ok(sample.bounds.width > 20 && sample.bounds.height > 20);
      assert.ok(Math.abs(sample.root.px - sample.pivot.x) < 0.01);
      assert.ok(Math.abs(sample.root.px + sample.body.x - sample.origin.x) < 0.01);
      assert.ok(sample.board.on && sample.board.triangles > 100 && !sample.board.lost);
      if (!key.endsWith('_2')) assert.equal(sample.body.x, 0);
      report.samples.push({ viewport, side, key, ...sample });
      console.log(JSON.stringify({ viewport, side, key, phase: 'prep' }));
      await page.screenshot({ path: path.join(out, viewport.width + '-' + side + '-' + key + '.png') });
    }
    await page.evaluate(() => {
      const view = window.__demo.view, info = { ...view.debug.leader.view.info, id: 9911, preview: false, maxHp: 100 };
      view.enterBattle({ fieldId: 'hidden-pipe-qa', kind: 'hidden', units: [info] });
      for (const gt of [0, 0.1]) view.pushSnapshot({ fieldId: 'hidden-pipe-qa', gt, units: [[9911, 9, 3, 100, 100, 0, 0, 0, 0]] });
    });
    await page.waitForFunction(() => window.__demo.view.debug.views.get(9911)?.spineReady, { timeout: 30000 });
    for (const interval of [0, 2]) {
      await page.evaluate(interval => { window.__demo.view.debug.ctx.impostorInterval = () => interval; }, interval);
      await new Promise(resolve => setTimeout(resolve, 500));
      const sample = await page.evaluate(() => {
        const { debug } = window.__demo.view, v = debug.views.get(9911);
        const pivot = debug.cam.project(10, 3, v.z + v.hover + v.lift, {});
        const origin = debug.cam.project(10 - v.visFacing, 3, v.z + v.hover + v.lift, {});
        const pixels = debug.app.renderer.extract.pixels(v.body);
        let painted = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
        return { x: v.x, y: v.y, rootX: v.root.x, rootY: v.root.y, bodyX: v.body.x, bodyY: v.body.y,
          pivot, origin, painted, impostor: !!v.imp?.sprite.visible, leaderCleared: !debug.leader };
      });
      assert.equal(sample.x, 9);
      assert.equal(sample.y, 3);
      assert.ok(sample.leaderCleared);
      assert.ok(Math.abs(sample.rootX - sample.pivot.x) < 0.01);
      assert.ok(Math.abs(sample.rootY - sample.pivot.y) < 0.01);
      assert.ok(Math.abs(sample.rootX + sample.bodyX - sample.origin.x) < 0.01);
      assert.ok(sample.painted > 100, 'Boss model must paint nonblank pixels');
      assert.equal(sample.impostor, interval > 0);
      report.samples.push({ viewport, side, battle: true, interval, ...sample });
      console.log(JSON.stringify({ viewport, side, interval, phase: 'battle', painted: sample.painted }));
      await page.screenshot({ path: path.join(out, viewport.width + '-' + side + '-battle-' + interval + '.png') });
    }
  }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await server.close();
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
