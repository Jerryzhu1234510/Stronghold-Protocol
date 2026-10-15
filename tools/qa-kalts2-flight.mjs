/* global window */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from '../server/index.js';

const out = resolve('.cache/kalts2-flight', process.argv.includes('--after') ? 'after' : 'before');
mkdirSync(out, { recursive: true });
const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { errors: [], samples: [] };
const after = process.argv.includes('--after');
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(server.url + '/dev/render-demo.html?scene=prep&paused=1&panel=0&board=2d');
  await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error, { timeout: 60000 });
  await page.evaluate(async () => {
    const { UnitView } = await import('/js/render/units.js');
    const { view } = window.__demo;
    window.__demo.pause();
    view.debug.app.ticker.stop();
    for (const unit of view.debug.views.values()) unit.destroy();
    view.debug.views.clear();
    view.setCamera('unite', { instant: true });
    const ctx = { ...view.debug.ctx, impostors: null, impostorInterval: () => 0 };
    const unit = new UnitView(ctx, { id: 99001, kind: 'op', side: 'ally', spine: 'char_1052_kalts2',
      defId: 'char_1052_kalts2', x: 10, y: 8, dir: 'RIGHT', maxHp: 1000, tier: 6, skillIndex: 2 });
    view.debug.views.set(unit.id, unit);
    window.__flight = { unit, ctx, view };
  });
  await page.waitForFunction(() => !!window.__flight.unit.actor, { timeout: 60000 });
  for (const dir of ['RIGHT', 'UP']) {
    await page.evaluate(dir => window.__flight.unit.setDir(dir), dir);
    await page.waitForFunction(() => !!window.__flight.unit.actor, { timeout: 60000 });
    for (const [width, height] of [[1440, 900], [844, 390]]) {
      await page.setViewport({ width, height });
      await new Promise(resolve => setTimeout(resolve, 300));
      await page.evaluate(() => window.__flight.view.setCamera('unite', { instant: true }));
      for (const clip of ['Idle', 'Start', 'Skill_2_Idle', 'Skill_3_Idle', 'Skill_3_Attack']) {
        const result = await page.evaluate(clip => {
          const { unit: v, ctx, view } = window.__flight;
          v.flying = true;
          v.actor._play(clip, true, { mix: 0 });
          for (let i = 0; i < 60; i++) v.update(1 / 30, ctx.cam(), i / 30);
          view.debug.app.renderer.render(view.debug.app.stage);
          const b = v.actor.spine.getLocalBounds();
          const world = ctx.cam().project(v.x, v.y, v.z);
          return { clip, hover: v.hover, bodyOffset: v.body.position.y, ground: world, screen: { ...v.screen },
            modelScale: v.actor.spine.scale.y, localBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
            bones: v.actor.spine.skeleton.bones.slice(0, 14).map(bone => ({ name: bone.data.name, x: bone.worldX,
              y: bone.worldY, localY: bone.y, setupY: bone.data.y })) };
        }, clip);
        report.samples.push({ dir, width, height, ...result });
        const bone = result.bones.find(b => /^(Front|Back)_A$/.test(b.name));
        if (after && clip === 'Start' && bone && bone.localY - bone.setupY > 112
      && !(result.bodyOffset > 0)) throw new Error('Entrance offset was not applied');
        if (after && clip !== 'Start' && result.bodyOffset !== 0) throw new Error('Other animation was moved');
        await page.screenshot({ path: out + '/' + dir + '-' + width + '-' + clip + '.png' });
      }
      if (after) {
        const timeline = await page.evaluate(() => {
          const { unit: v, ctx } = window.__flight;
          v.actor.deploy();
          const samples = [];
          for (let frame = 1; frame <= 45; frame++) {
            v.update(1 / 30, ctx.cam(), frame / 30);
            const bone = v.actor.spine.skeleton.findBone('Front_A') || v.actor.spine.skeleton.findBone('Back_A');
            const rise = (bone.y - bone.data.y) / 320 - v.body.position.y / v.screen.s;
            if (!Number.isFinite(rise) || rise > 0.350001) throw new Error('Real deployment escaped the height limit');
            if ([1, 6, 15, 24, 36, 45].includes(frame)) samples.push({ frame, rise, offset: v.body.position.y, mode: v.actor.mode });
          }
          if (v.actor.mode !== 'base' || v.body.position.y !== 0) throw new Error('Entrance offset remained after landing');
          return samples;
        });
        report.samples.push({ dir, width, height, clip: 'real-deploy-timeline', timeline, bones: [] });
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ errors: report.errors, samples: report.samples.map(s => ({ dir: s.dir, width: s.width,
    clip: s.clip, bodyOffset: s.bodyOffset, bones: s.bones.filter(b => /^(Front|Back)_A$/.test(b.name)) })) }));
}
