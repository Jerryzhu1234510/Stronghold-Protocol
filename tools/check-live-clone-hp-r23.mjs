/* global window, document */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/clone-hp-r23-deploy';
const deploymentFile = `${out}/deployment.json`;
const deployment = JSON.parse(await readFile(deploymentFile, 'utf8'));
assert.ok(deployment.activated);
const home = 'https://weishuxieyi.icu';
const base = `${home}/_build/${deployment.generation}/`;
const report = { generation: deployment.generation, pass: false, errors: [], checks: [] };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
let inRoom = false;
const request = (t, p = {}) => page.evaluate(async (url, type, payload) => (await import(url + 'js/net.js')).net.request(type, payload), base, t, p);
const pub = () => page.evaluate(async url => (await import(url + 'js/store.js')).store.get().match.public, base);
const quit = () => page.evaluate(async url => (await import(url + 'js/ui/matchChrome.js')).quitMatch(), base);
try {
  page.on('pageerror', e => report.errors.push(e.message));
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.title-screen', { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__SP_GENERATION), deployment.generation);
  await page.evaluate(async url => (await import(url + 'js/screens/title.js')).enterSession('血量更新上线核验'), base);
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async url => (await import(url + 'js/store.js')).store.get().connection.status === 'online', {}, base);
  await page.waitForSelector('.release-notes');
  const notes = await page.$eval('.release-notes', e => e.textContent);
  assert.ok(notes.includes('2.016亿'));
  assert.ok(notes.includes('1.1／1.2／1.3／1.4'));
  assert.ok(!notes.includes('再乘三倍'));
  await page.evaluate(async url => (await import(url + 'js/ui/releaseNotes.js')).closeReleaseNotes(), base);
  report.checks.push('new release entry and both HP announcements');
  const ratios = await page.evaluate(async url => {
    const { roomStartLp } = await import(url + 'shared/constants.js');
    return [4, 5, 6, 7, 8].map(capacity => ({ capacity, lp: roomStartLp(28, capacity) }));
  }, base);
  assert.deepEqual(ratios.map(r => r.lp), [28, 31, 34, 37, 40]);
  report.ratios = ratios;
  const bands = await page.evaluate(async url => (await fetch(url + 'data/bands.json')).json(), base);
  for (const [capacity, gameMode] of [[5, 'normal'], [8, 'clone']]) {
    await request('room.create', { mode: 'coop', difficulty: 'ABYSS', capacity, experimentalAccepted: true, visibility: 'private' });
    inRoom = true;
    await page.waitForSelector('.room-screen');
    if (gameMode === 'clone') {
      await page.select('.room-mode-picker select', 'clone');
      await page.waitForSelector('.room-clone-note');
      assert.ok(await page.$eval('.room-clone-note', e => e.textContent.includes('48倍')));
      await page.screenshot({ path: `${out}/live-clone-eight-room-844x390.png` });
    }
    for (let i = 1; i < capacity; i++) await request('room.addBot');
    await request('room.start');
    await page.waitForSelector('.brief-bond');
    await request('g.infoReady');
    await page.waitForSelector('.dband');
    const shownLp = Number((await page.$eval('[data-band="band_bldsk"] .dband__lp', e => e.textContent)).trim());
    assert.equal(shownLp, capacity === 5 ? 31 : 40);
    await page.screenshot({ path: `${out}/live-${gameMode}-${capacity}-strategy-lp-844x390.png` });
    if (gameMode === 'clone') {
      await page.waitForFunction(async url => Object.keys((await import(url + 'js/store.js')).store.get().match.public?.draft?.votes || {}).length === 7, {}, base);
      await request('g.band', { bandId: 'band_bldsk' });
      await page.waitForFunction(async url => (await import(url + 'js/store.js')).store.get().match.public?.phase !== 'BAND_DRAFT', { timeout: 5000 }, base);
      const state = await pub();
      for (const ps of state.players) {
        assert.equal(ps.lp, Math.ceil(bands[ps.bandId].totalHp * 14 / 10));
      }
      report.clonePlayers = state.players.map(ps => ({ bandId: ps.bandId, lp: ps.lp }));
    }
    report.checks.push(`${gameMode}/${capacity}: actual strategy UI uses reduced initial LP`);
    await quit();
    inRoom = false;
    await page.waitForSelector('.lobby-screen');
  }
  assert.deepEqual(report.errors, []);
  const status = await fetch(`${home}/__hot/status`).then(r => r.json());
  assert.equal(status.build, deployment.generation);
  assert.ok(status.versions.some(v => v.id === deployment.statusBefore.build && v.healthy && v.draining));
  const health = await fetch(base + 'healthz').then(r => r.json());
  assert.ok(health.ok);
  report.health = health;
  report.pass = true;
  deployment.liveVerified = true;
  await writeFile(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify({ pass: true, generation: report.generation, ratios, checks: report.checks }));
} catch (error) {
  report.error = error.stack;
  throw error;
} finally {
  if (inRoom) await quit().catch(() => {});
  await browser.close();
  await writeFile(`${out}/live-verification.json`, JSON.stringify(report, null, 2));
}
