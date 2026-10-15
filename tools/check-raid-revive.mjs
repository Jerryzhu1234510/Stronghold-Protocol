/* global window, requestAnimationFrame */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildBattleSpec } from '../server/sim/spec.js';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/raid-revive';
mkdirSync(out, { recursive: true });
const base = process.env.SP_PREVIEW_URL || 'http://localhost:8923';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const results = [], errors = [];
try {
  for (const [width, height] of [[1440, 900], [844, 390]]) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width, height });
    await page.goto(`${base}/dev/render-demo.html?scene=normal-m01&paused=1&panel=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__demo?.ready, { timeout: 60000 });
    const spec = buildBattleSpec({ battleId: 'raid-revive', fieldId: 'raid-revive', kind: 'normal', seed: 97,
      modeId: 'mode_multi_normal', round: 8, stageId: 'act1autochess_m01', timeLimit: 180,
      flags: { dpInit: 99, dpPerSec: 0, dpMax: 999 },
      routes: [{ motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] }],
      spawns: [{ time: 0, enemyKey: 'enemy_1000_gopro_2', routeIndex: 0, pos: [12, 8], mods: { hpMul: 1e6, speedMul: 0 } }],
      players: [{ playerId: 'p1', seat: 0, side: 'L', units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_4_04_a', row: 12, col: 4, dir: 'RIGHT', skillIndex: 1 }],
        bonds: { raidShip: { active: true, tier: 1, count: 2, layers: 10 } }, playerEffects: [] }],
    });
    const result = await page.evaluate(async spec => {
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const { data } = await import('/js/data.js');
      const { spec: S, ds } = await loadBrowserSim();
      const b = S.createBattleFromSpec(spec, ds, { quiet: true }), v = window.__demo.view;
      b.step();
      const meta = b.fieldMeta();
      v.setStage(data.lookup('stages', spec.stageId)); v.enterBattle(meta);
      v.setCamera('normal', { rect: meta.rect, side: 'L', instant: true });
      v.setLocalFeed({ on: true, speed: 2 });
      const u = b.allyUnits.find(u => u.uid === 1), e = b.enemies[0];
      e.base.moveSpeed = 0; e.markDirty();
      const frames = async n => {
        for (let i = 0; i < n; i++) {
          b.step(); b.step();
          const ev = b.drainEvents();
          if (ev.length) v.pushEvents({ t: 'b.ev', fieldId: meta.fieldId, gt: b.time, ev });
          v.pushSnapshot(b.snapshot());
          await new Promise(r => requestAnimationFrame(r));
        }
      };
      u.skill.gainSp(999);
      await frames(12);
      const first = { seq: u.deploySeq, r: u.tileR, c: u.tileC };
      u.base.respawnTime = 4;
      b.kill(u);
      e.x = 4; e.y = 9; b._enemyIndexTick = -1;
      let respawnAt = null, jumpAt = null;
      b.on('deploy', ({ unit, respawn }) => {
        if (unit !== u) return;
        if (respawn) respawnAt = b.time;
        else if (respawnAt !== null) jumpAt ??= b.time;
      }, { priority: 100 });
      await frames(20);
      const down = v.debug.views.get(u.id)?.down;
      await frames(72);
      const rendered = v.debug.views.get(u.id);
      return { first, respawnAt, jumpAt, sim: { x: u.x, y: u.y, dir: u.dir, seq: u.deploySeq },
        rendered: { x: rendered?.x, y: rendered?.y, dir: rendered?.dir, alive: rendered?.alive, down: !!rendered?.down, spine: rendered?.spineReady },
        downWasVisible: !!down, errors: b.errors };
    }, spec);
    assert.ok(result.first.seq > 1, 'initial raid');
    assert.ok(result.downWasVisible, 'normal death has a visible redeploy countdown');
    assert.ok(result.jumpAt >= result.respawnAt && result.jumpAt - result.respawnAt <= .3, 'raid resumes on the next poll');
    assert.equal(result.rendered.alive, true); assert.equal(result.rendered.down, false);
    assert.equal(result.rendered.dir, 'RIGHT');
    assert.ok(Math.abs(result.rendered.x - result.sim.x) < .01 && Math.abs(result.rendered.y - result.sim.y) < .01, 'rendered landing matches browser simulation');
    assert.ok(result.rendered.spine, 'operator model loaded');
    assert.deepEqual(result.errors, []);
    results.push({ width, height, ...result });
    await page.screenshot({ path: `${out}/revived-raid-${width}x${height}.png` });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/browser.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ checks: results.length, results, errors }));
} finally { await browser.close(); }
