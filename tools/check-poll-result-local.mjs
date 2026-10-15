/* global document */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const home = process.env.SP_PREVIEW_URL || 'http://localhost:8923';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(home).hostname), 'Local preview only');
const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/poll-result-local';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const report = { pass: false, home, errors: [], pollRequests: [], checks: [] };
try {
  for (const [width, height] of [[1440, 900], [844, 390], [568, 320]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('request', r => { if (r.url().includes('api/player-poll') || r.url().includes('/ui/playerPoll')) report.pollRequests.push(r.url()); });
    await page.goto(home, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-screen', { timeout: 60000 });
    await page.evaluate(async () => {
      const { enterSession } = await import('/js/screens/title.js');
      enterSession('五本验收');
      (await import('/js/ui/releaseNotes.js')).closeReleaseNotes();
    });
    await page.waitForSelector('.lobby-screen', { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      await data.loadAll(['chess', 'bonds', 'garrisons', 'backups']);
      const ids = ['chess_char_4_27_a', 'chess_char_4_27_b'];
      const forms = ids.map(id => {
        const c = data.lookup('chess', id);
        return { id, tier: c.tier, price: c.price, bonds: c.bonds,
          count: data.lookup('garrisons', c.garrisonIds[0]).bb.check_cnt,
          description: data.lookup('garrisons', c.garrisonIds[0]).desc };
      });
      const { openLoadout, loadoutStore } = await import('/js/ui/loadoutSync.js');
      openLoadout('lobby');
      loadoutStore.set({ tab: 'loadout', sel: ids[0], filters: { search: '克莱门莎', tier: 5 } });
      return forms;
    });
    for (const [i, form] of result.entries()) {
      assert.equal(form.tier, 5); assert.equal(form.price, 4);
      assert.equal(form.count, i ? 2 : 3);
      assert.deepEqual(form.bonds, ['egirShip', 'swiftShip', 'indomShip']);
      assert.ok(form.description.includes('【迅捷】') && !form.description.includes('【突袭】'));
    }
    await page.waitForSelector('[data-chess="chess_char_4_27_a"].lo-card--t5');
    await page.click('[data-chess="chess_char_4_27_a"]');
    await page.waitForFunction(() => {
      const text = document.querySelector('.lo-detail-wrap')?.textContent;
      return text?.includes('克莱门莎') && text.includes('迅捷') && text.includes('不屈');
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    const art = await page.$eval('[data-chess="chess_char_4_27_a"] img', img => img.complete && img.naturalWidth > 0);
    assert.ok(art, 'Clementia portrait must render');
    assert.equal(await page.$('.player-poll'), null);
    assert.equal(await page.$('.player-poll-entry'), null);
    await page.screenshot({ path: `${out}/clementia-${width}x${height}.png` });
    report.checks.push({ width, height, forms: result, art });
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.pollRequests, []);
  report.pass = true;
  console.log(JSON.stringify({ pass: true, viewports: report.checks.length, pollRequests: 0 }));
} finally {
  await browser.close();
  await writeFile(`${out}/browser.json`, JSON.stringify(report, null, 2));
}
