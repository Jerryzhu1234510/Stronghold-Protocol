// Browser E2E of the presence readout (在线人数, DESIGN §8.1) against the real server, headless Chrome (puppeteer-core +
// system Chrome). Opt-in: SP_E2E=1 node --test test/ui/presence.e2e.test.js
//
// Title screen: the footer carries the release version AND the live counters, and a second page (another player) raises
// the first one's number without a reload — the server pushes `presence`. Lobby: the top bar shows the same numbers, and
// the store holds the frame. Closing a page takes the count back down.
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/presence-*.png

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

/** Page-side reader of whichever readout the current screen shows (lobby top bar, else the title footer). */
const READOUT = `(() => {
  const el = document.querySelector('[data-testid="lobby-presence"]') || document.querySelector('[data-testid="title-presence"]');
  const m = /^在线 (\\d+) 人 · 房间内 (\\d+) 人$/.exec((el?.textContent || '').trim());
  return m ? { text: el.textContent.trim(), online: Number(m[1]), inRoom: Number(m[2]) } : null;
})()`;

describe('presence readout (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    // a short presence tick: the push is then observable well inside the test's waits
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, presenceTickMs: 300 });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  /** Open a page: `entered: false` stays on the title screen, `true` goes straight to the lobby. */
  async function open({ entered = false, name = '在线测试' } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument((enter, who) => {
      localStorage.setItem('sp.name', who);
      if (enter) sessionStorage.setItem('sp.entered', '1');
    }, entered, name);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    // `connected` is the title screen's socket (no hello yet); `online` means the session was welcomed
    await page.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status), { timeout: 30000 });
    return { ctx, page, problems };
  }

  const read = (page) => page.evaluate(READOUT);
  /** Wait until the readout stops showing `n` online (i.e. the pushed frame arrived). */
  const waitOnlineAbove = (page, n, timeout = 15000) => page.waitForFunction(
    (min) => {
      const el = document.querySelector('[data-testid="lobby-presence"]') || document.querySelector('[data-testid="title-presence"]');
      const m = /^在线 (\d+) 人/.exec((el?.textContent || '').trim());
      return !!m && Number(m[1]) > min;
    }, { timeout }, n);
  const waitOnlineAtLeast = (page, n, timeout = 15000) => page.waitForFunction(
    (min) => {
      const el = document.querySelector('[data-testid="lobby-presence"]') || document.querySelector('[data-testid="title-presence"]');
      const m = /^在线 (\d+) 人/.exec((el?.textContent || '').trim());
      return !!m && Number(m[1]) >= min;
    }, { timeout }, n);
  const waitOnlineAtMost = (page, n, timeout = 15000) => page.waitForFunction(
    (max) => {
      const el = document.querySelector('[data-testid="lobby-presence"]') || document.querySelector('[data-testid="title-presence"]');
      const m = /^在线 (\d+) 人/.exec((el?.textContent || '').trim());
      return !!m && Number(m[1]) <= max;
    }, { timeout }, n);
  const waitOnlineEquals = (page, n, timeout = 15000) => page.waitForFunction(
    (want) => {
      const el = document.querySelector('[data-testid="lobby-presence"]') || document.querySelector('[data-testid="title-presence"]');
      const m = /^在线 (\d+) 人/.exec((el?.textContent || '').trim());
      return !!m && Number(m[1]) === want;
    }, { timeout }, n);

  test('the title footer and the lobby top bar show the live counters, and the push keeps them current', async () => {
    const a = await open({ entered: false });
    await a.page.waitForSelector('[data-testid="title-presence"]', { visible: true, timeout: 15000 });
    // the title screen has no session yet, so its numbers come from /healthz — and its own page still counts
    await waitOnlineAtLeast(a.page, 1);
    const first = await read(a.page);
    assert.ok(first, 'the title footer shows the readout');
    assert.ok(first.online >= 1, `this page is counted (${first.text})`);
    assert.equal(first.inRoom, 0, 'nobody is in a room');
    // the release version still sits in the same footer (test/version.test.js pins the expression, this pins the view)
    assert.match(await a.page.$eval('.title-foot', (el) => el.textContent), /v\d+\.\d+\.\d+ · WEB SIMULATION/);
    await a.page.screenshot({ path: path.join(OUT, 'presence-title.png') });

    // a second player enters: the lobby readout counts it, pushed by the server over the socket
    const b = await open({ entered: true, name: '第二个人' });
    await b.page.waitForSelector('[data-testid="lobby-presence"]', { visible: true, timeout: 15000 });
    await waitOnlineEquals(b.page, first.online + 1);
    const lobby = await read(b.page);
    assert.equal(lobby.online, first.online + 1, `the second page is counted (${lobby.text})`);
    assert.deepEqual(await b.page.evaluate(() => globalThis.__SP__.store.get().presence), { online: lobby.online, inRoom: lobby.inRoom });
    await b.page.screenshot({ path: path.join(OUT, 'presence-lobby.png') });

    // …and the title screen, which only polls, catches up within one interval
    await waitOnlineEquals(a.page, lobby.online, 20000);
    assert.equal((await read(a.page)).text, lobby.text, 'both screens agree on the counters');

    // closing the lobby page takes the count back down
    await b.ctx.close();
    await waitOnlineAtMost(a.page, first.online, 20000);
    assert.equal((await read(a.page)).online, first.online, 'back to one page');

    assert.deepEqual(a.problems, [], 'page A: no console errors / failed requests');
  });
});
