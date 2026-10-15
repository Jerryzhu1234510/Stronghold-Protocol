import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = '../../outputs/clementia-deploy';
const staged = JSON.parse(await fs.readFile(out + '/staged.json'));
const base = '/_build/' + staged.generation + '/', origin = 'https://weishuxieyi.icu';
const report = { generation: staged.generation, errors: [], pass: false };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status), { timeout: 60000 });
  assert.ok(page.url().includes(staged.generation));
  report.renderedAnnouncement = await page.$eval('.release-notes__content > .release-notes__changes > li', e => e.textContent);
  assert.ok(report.renderedAnnouncement.includes('四本商店新增克莱门莎'));
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  report.runtime = await page.evaluate(async base => {
    const { resourceCacheAction } = await import(base + 'js/resources/client.js');
    const { loadSpineData } = await import(base + 'js/assets.js');
    const { ensurePixi } = await import(base + 'js/render/app/pixi.js');
    const { SpineActor } = await import(base + 'js/render/spine.js');
    await ensurePixi();
    const before = await resourceCacheAction('status');
    const manifest = await (await fetch(base + 'data/assets.json')).json();
    const app = new PIXI.Application({ width: 1200, height: 620, backgroundColor: 0x091713, antialias: true, autoStart: false });
    Object.assign(app.view.style, { position: 'fixed', left: '10px', top: '100px', zIndex: '9999' }); document.body.append(app.view);
    const checks = [];
    for (const [row, side] of ['front', 'back'].entries()) {
      const entry = manifest.chars.char_4231_clemnt.spine[side], data = await loadSpineData(entry);
      for (let skill = 0; skill < 3; skill++) {
        const actor = new SpineActor(data, entry); actor.setSkillIndex(skill); actor.spine.position.set(200 + skill * 400, 250 + row * 300); actor.spine.scale.set(.55);
        app.stage.addChild(actor.spine); actor.setSkill(true); actor.update(.6); actor.attack(.6); actor.update(.12);
        const track = actor.spine.state.getCurrent(0)?.animation?.name, bounds = actor.spine.getLocalBounds();
        checks.push({ side, skill: skill + 1, track, bones: data.bones.length, width: bounds.width, height: bounds.height });
      }
    }
    app.render(); const after = await resourceCacheAction('status');
    return { checks, newR2Downloads: after.cdn.downloads - before.cdn.downloads, cdn: after.cdn, controller: navigator.serviceWorker.controller.scriptURL };
  }, base);
  assert.equal(report.runtime.checks.length, 6);
  assert.ok(report.runtime.checks.every(c => c.track.includes('Skill') && c.bones > 0 && c.width > 0 && c.height > 0));
  assert.ok(report.runtime.newR2Downloads >= 6);
  await page.screenshot({ path: out + '/live-models.png' });
  report.data = await page.evaluate(async base => {
    const [chess, garrisons, bonds] = await Promise.all(['chess', 'garrisons', 'bonds'].map(async n => (await fetch(base + 'data/' + n + '.json')).json()));
    return ['chess_char_4_27_a', 'chess_char_4_27_b'].map(id => {
      const c = chess[id], g = garrisons[c.garrisonIds[0]];
      return { id, tier: c.tier, visible: c.visible, nation: c.nationId, bonds: c.bonds, garrison: g, inRosters: ['egirShip', 'indomShip', 'raidShip'].every(b => bonds[b].members.includes('chess_char_4_27_a')) };
    });
  }, base);
  for (const c of report.data) { assert.equal(c.tier, 4); assert.equal(c.nation, 'egir'); assert.equal(c.visible, true); assert.ok(c.inRosters); assert.deepEqual(c.bonds, ['egirShip', 'indomShip', 'raidShip']); }
  // Direct Tencent backup delivery still serves every added file with its exact content identity.
  const added = JSON.parse(await fs.readFile(out + '/r2-added.json'));
  const uploaded = JSON.parse(await fs.readFile('../../outputs/r2-full-r17/manifest.json'));
  const entries = uploaded.entries.filter(e => added.includes(e.path));
  await page.setBypassServiceWorker(true);
  report.tencentBackup = await page.evaluate(async ({ base, entries }) => Promise.all(entries.map(async e => {
    const r = await fetch(base + e.path.slice(1)), body = await r.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), b => b.toString(16).padStart(2, '0')).join('');
    return { path: e.path, status: r.status, valid: r.ok && body.byteLength === e.bytes && hash === e.hash };
  })), { base, entries });
  assert.ok(report.tencentBackup.every(e => e.valid));
  const notes = await (await fetch(origin + base + 'js/ui/releaseNotes.js')).text(); assert.ok(notes.includes('四本商店新增克莱门莎'));
  assert.deepEqual(report.errors, []); report.pass = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally { await browser.close(); await fs.writeFile(out + '/live-browser.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
