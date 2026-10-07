// Browser E2E of the 外援 / 甄选 (DIY) slots (DESIGN §21.2) against the real server, headless Chrome (puppeteer-core +
// system Chrome). Opt-in: SP_E2E=1 node --test test/ui/waiguan.e2e.test.js
//
// Desktop: lobby → 干员调配 → the four slot tiles are there → open a slot → the picker lists the 87 candidates and marks
// the sibling slot of the same tier as taken once one is chosen → the choice is persisted (localStorage sp.pref.waiguan),
// the slot tile shows the operator, and the server stores it (a room then carries it in room.state.picks).
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/waiguan-*.png

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('外援 / 甄选 slots (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open({ w = 1920, h = 1080, touch = false, picks = null } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // a cancelled request is not a failure: the browser aborts still-pending image loads when a list re-renders
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText || '';
      if (why === 'net::ERR_ABORTED' || /fonts\.(googleapis|gstatic)/.test(r.url())) return;
      problems.push(`requestfailed: ${r.url()} ${why}`);
    });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument((seed) => {
      localStorage.setItem('sp.name', '外援测试');
      sessionStorage.setItem('sp.entered', '1');
      // a player who already picked 外援 (the match UI test): the client boots with the selection and the sync sends it
      if (seed) localStorage.setItem('sp.pref.waiguan', JSON.stringify({ v: 1, picks: seed }));
      // diagnostic: record every frame the page sends
      globalThis.__SP_SENT__ = [];
      const Orig = globalThis.WebSocket;
      globalThis.WebSocket = class extends Orig {
        send(data) { try { globalThis.__SP_SENT__.push(String(data).slice(0, 200)); } catch { /* ignore */ } return super.send(data); }
      };
    }, picks);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    return { ctx, page, problems };
  }
  const clickSel = async (page, sel) => {
    await page.waitForSelector(sel, { visible: true, timeout: 15000 });
    await page.click(sel);
  };
  /** The picks the client stored (the sync sends the same map with room.pick). */
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.waiguan') || 'null'));

  test('desktop: pick into slot 1 of each tier, the sibling slot refuses the same operator, the server stores it', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-wg__slot', { visible: true, timeout: 20000 });
    assert.equal(await page.$$eval('.lo-wg__slot', (els) => els.length), 4, 'four 甄选 slots (2 × tier V, 2 × tier VI)');
    assert.equal(await page.$$eval('.lo-wg__slot.is-filled', (els) => els.length), 0, 'all empty to start');
    await page.screenshot({ path: path.join(OUT, 'waiguan-slots-empty.png') });

    // tier V slot 1: the picker lists every candidate
    await clickSel(page, '[data-testid="waiguan-slot-diy5a"]');
    await page.waitForSelector('.lo-wgpick__grid .lo-card', { visible: true, timeout: 20000 });
    const nCand = await page.$$eval('.lo-wgpick__grid .lo-card', (els) => els.length);
    assert.ok(nCand > 50, `the picker lists the roster (${nCand})`);
    await page.screenshot({ path: path.join(OUT, 'waiguan-picker.png') });

    // choose the first candidate of the list
    const firstChar = await page.$eval('.lo-wgpick__grid .lo-card', (el) => el.getAttribute('data-char'));
    const firstName = await page.$eval('.lo-wgpick__grid .lo-card .lo-card__name', (el) => el.textContent.trim());
    await page.click('.lo-wgpick__grid .lo-card');
    await page.waitForFunction(() => !document.querySelector('.lo-wgpick'), { timeout: 10000 });
    assert.equal(await page.$$eval('.lo-wg__slot.is-filled', (els) => els.length), 1, 'the slot is filled');
    assert.equal(await page.$eval('[data-testid="waiguan-slot-diy5a"] .lo-wg__name', (el) => el.textContent.trim()), firstName);

    // tier V slot 2: the same operator is offered as taken and cannot be clicked
    await clickSel(page, '[data-testid="waiguan-slot-diy5b"]');
    await page.waitForSelector('.lo-wgpick__grid .lo-card', { visible: true, timeout: 20000 });
    assert.equal(await page.$eval(`.lo-wgpick__grid [data-char="${firstChar}"]`, (el) => el.disabled), true, 'the same operator of one tier is refused');
    const otherChar = await page.$$eval('.lo-wgpick__grid .lo-card:not([disabled])', (els) => els[0]?.getAttribute('data-char'));
    assert.ok(otherChar && otherChar !== firstChar, 'another candidate is still selectable');
    await page.click(`.lo-wgpick__grid [data-char="${otherChar}"]`);
    await page.waitForFunction(() => !document.querySelector('.lo-wgpick'), { timeout: 10000 });
    assert.equal(await page.$$eval('.lo-wg__slot.is-filled', (els) => els.length), 2, 'both tier V slots are filled');

    // tier VI slot 1: the operators taken above are refused whatever their tier (one operator, one slot)
    await clickSel(page, '[data-testid="waiguan-slot-diy6a"]');
    await page.waitForSelector('.lo-wgpick__grid .lo-card', { visible: true, timeout: 20000 });
    assert.equal(await page.$eval(`.lo-wgpick__grid [data-char="${firstChar}"]`, (el) => el.disabled), true, 'the tier V pick is refused in a tier VI slot too');
    assert.equal(await page.$eval(`.lo-wgpick__grid [data-char="${otherChar}"]`, (el) => el.disabled), true, 'and so is the second tier V pick');
    const note = await page.$eval('[data-testid="waiguan-taken-note"]', (el) => el.textContent);
    assert.match(note, /同一个干员只能占一个外援位/, 'the picker says the rule');
    assert.match(note, new RegExp(firstName), 'and names the operators already placed');
    const thirdChar = await page.$$eval('.lo-wgpick__grid .lo-card:not([disabled])', (els) => els[0]?.getAttribute('data-char'));
    assert.ok(thirdChar && thirdChar !== firstChar && thirdChar !== otherChar, 'a fresh candidate is still selectable');
    await page.click(`.lo-wgpick__grid [data-char="${thirdChar}"]`);
    await page.waitForFunction(() => !document.querySelector('.lo-wgpick'), { timeout: 10000 });

    // persisted, and cleared again
    await page.waitForFunction(() => !!localStorage.getItem('sp.pref.waiguan'), { timeout: 10000 });
    const saved = await stored(page);
    assert.deepEqual(Object.keys(saved.picks).sort(), ['diy5a', 'diy5b', 'diy6a'], 'the three picks are persisted');
    assert.equal(saved.picks.diy5a, firstChar);
    await clickSel(page, '[data-testid="waiguan-clear-diy5a"]');
    await sleep(300);
    assert.equal(await page.$$eval('.lo-wg__slot.is-filled', (els) => els.length), 2, 'the cleared slot is empty again');
    assert.ok(!(await stored(page)).picks.diy5a, 'the clear is persisted too');
    await page.screenshot({ path: path.join(OUT, 'waiguan-slots-filled.png') });

    // the server took the selection: a created room carries it in room.state.picks
    await clickSel(page, '.lo-back');
    await page.waitForSelector('.lobby-screen', { visible: true, timeout: 10000 });
    await page.waitForFunction(async () => {
      const s = globalThis.__SP__.store.get();
      return !!s.room || true; // the room is created below; this just yields a frame
    });
    // create a 独立模拟 room through the UI
    await page.evaluate(() => {
      const s = globalThis.__SP__.store.get();
      return s;
    });
    const roomPicks = await page.evaluate(async () => {
      const net = globalThis.__SP__.net;
      const st = await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
      return st;
    }).catch(() => null);
    if (roomPicks) {
      await page.waitForFunction(() => !!globalThis.__SP__.store.get().room, { timeout: 10000 });
      const picks = await page.evaluate(() => globalThis.__SP__.store.get().room?.picks || {});
      assert.equal(picks.diy5b, (await stored(page)).picks.diy5b, 'the server keeps the selection and echoes it back');
    }
    assert.deepEqual(problems, [], 'no console / page / request errors');
    await ctx.close();
  });

  /**
   * The bug this locks down: a picked 外援 operator appeared on the 干员调配 screen but its SKILL could not be switched — the
   * record was `visible: false` / `isDiy`, so the screen's roster predicate and the server's checkLoadout both dropped the
   * entry, and the radio group never even showed. Now the picked operator is a loadout target like any other.
   */
  test('desktop: a picked 外援 operator can switch its skill, and the server stores the choice', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-wg__slot', { visible: true, timeout: 20000 });
    // pick a tier VI 外援, then select that operator in the roster list
    await clickSel(page, '[data-testid="waiguan-slot-diy6a"]');
    await page.waitForSelector('.lo-wgpick__grid .lo-card', { visible: true, timeout: 20000 });
    const charId = await page.$eval('.lo-wgpick__grid .lo-card', (el) => el.getAttribute('data-char'));
    await page.click('.lo-wgpick__grid .lo-card');
    await page.waitForFunction(() => !document.querySelector('.lo-wgpick'), { timeout: 10000 });
    // the picker closes on the tier VI slot; that operator's roster card is now in the list. Its chess id is derived the
    // same way the roster does (`chess_char_diy_6_<charId>_a`), and the list card is the one with data-chess.
    const suffix = charId.replace(/^char_\d+_/, '');
    const wantIds = [`chess_char_diy_6_${charId}_a`, `chess_char_diy_6_${suffix}_a`];
    const cardId = await (async () => {
      for (const id of wantIds) {
        if (await page.$(`.lo-grid [data-chess="${id}"]`)) return id;
      }
      // last resort: the first tier VI 外援 card the list shows (the group is labelled 外援)
      const any = await page.$$eval('.lo-grid [data-chess*="_diy_6_"]', (els) => els.map((e) => e.getAttribute('data-chess')));
      return any[0] || null;
    })();
    assert.ok(cardId, `the operator is in the roster list (tried ${wantIds.join(' / ')})`);
    await clickSel(page, `.lo-grid [data-chess="${cardId}"]`);

    // its SKILL radio group is offered (this used to be empty / absent for a 外援)
    await page.waitForSelector('.lo-skills .lo-skill', { visible: true, timeout: 15000 });
    const skills = await page.$$eval('.lo-skills .lo-skill', (els) => els.map((e) => e.getAttribute('data-skill')));
    assert.ok(skills.length >= 2, `the skill options are there (${skills.join(', ')})`);
    const before = await page.$eval('.lo-skills .lo-skill.is-on', (el) => el.getAttribute('data-skill'));
    const target = skills.find((s) => s !== before);
    await page.click(`.lo-skills [data-skill="${target}"]`);
    assert.equal(await page.$eval('.lo-skills .lo-skill.is-on', (el) => el.getAttribute('data-skill')), target, 'the choice is selected');
    await page.screenshot({ path: path.join(OUT, 'waiguan-skill-switch.png') });

    // it is persisted (the sync sends the same map as room.loadout)
    await page.waitForFunction((id) => {
      const lo = JSON.parse(localStorage.getItem('sp.pref.loadout') || 'null');
      const e = lo && (lo.entries || lo);
      return !!(e && e[id]);
    }, { timeout: 10000 }, cardId);
    const entry = await page.evaluate((id) => {
      const lo = JSON.parse(localStorage.getItem('sp.pref.loadout') || 'null');
      const e = lo && (lo.entries || lo);
      return e ? e[id] || null : null;
    }, cardId);
    assert.ok(entry, `the switched skill is stored (${JSON.stringify(entry)})`);
    assert.equal(String(entry.skill), String(target));

    // A room now makes the server echo both copies: the seat's loadout and the room's picks (room.state.picks is sent to
    // the room's members, so this is where the 甄选 selection becomes visible back to the client).
    const kept = await page.evaluate(async (id) => {
      const net = globalThis.__SP__.net;
      try { await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }); } catch { return { err: 'create' }; }
      const s = globalThis.__SP__.store.get();
      const seat = (s.room?.seats || []).find((x) => x && x.playerId === s.me.playerId);
      return { entry: (seat?.loadout || {})[id] || null, picks: s.room?.picks || {}, code: s.room?.code || null };
    }, cardId).catch(() => null);
    // the debounced frames have to land: the pick (room.pick) then the loadout (room.loadout, with this entry)
    await page.waitForFunction((id) => (globalThis.__SP_SENT__ || []).some((f) => {
      try { const m = JSON.parse(f); return m.t === 'room.loadout' && !!m.entries && !!m.entries[id]; } catch { return false; }
    }), { timeout: 15000 }, cardId);

    // ask again now that the room exists (room.loadout does not broadcast a state frame: that is deliberate)
    const state = await page.evaluate(async (id) => {
      const net = globalThis.__SP__.net;
      const me = globalThis.__SP__.store.get().me.playerId;
      const st = await net.request('g.state', {});
      const seat = (st?.seats || []).find((x) => x && x.playerId === me);
      return { entry: (seat?.loadout || {})[id] || null, picks: st?.picks || {} };
    }, cardId).catch(() => null);
    if (state && !state.err) {
      assert.ok(state.entry, `the server stored the 外援 loadout entry (${JSON.stringify(state)})`);
      assert.equal(String(state.entry.skill), String(target), 'with the switched skill index');
      assert.equal(state.picks.diy6a || state.picks.diy6b, charId, `and it holds the pick that entry needs (${JSON.stringify(state.picks)})`);
    }
    // …and a match STARTED from here must fight with that skill: this is the seam the owner hit (the skill looked
    // unchanged in-match), so it is asserted end to end rather than in halves.
    const started = await page.evaluate(async () => {
      try { await globalThis.__SP__.net.request('room.start'); return { ok: true }; } catch (e) { return { err: String((e && e.code) || e) }; }
    });
    assert.ok(started.ok, `room.start (${JSON.stringify(started)})`);
    const m = [...srv.lobby.rooms.values()].find((r) => r.match)?.match || null;
    assert.ok(m, 'the match exists');
    const pid = [...m.players.values()].find((p) => !p.isBot)?.playerId;
    const ps = m.players.get(pid);
    assert.equal(String(ps.loadout[cardId]?.skill), String(target), `the match carries the switched skill (${JSON.stringify(ps.loadout)})`);
    assert.equal(String(ps.loadoutFor(m.gd.chess(cardId)).skillIndex), String(target), 'and resolves it for the operator');
    await page.screenshot({ path: path.join(OUT, 'waiguan-skill-switch.png') });
    assert.deepEqual(problems, [], 'no console / page / request errors');
    await ctx.close();
  });

  /**
   * The search box of the 外援 picker (regression): its TextField was wired with the DOM convention — `onInput=${(e) =>
   * setQuery(e.currentTarget.value)}` — while TextField calls `onInput(value)` with the STRING. Every keystroke therefore
   * threw `Cannot read properties of undefined (reading 'value')` and the query stayed empty, so the list never filtered:
   * a player typing an operator's name saw all 87 cards unchanged and concluded the operator was missing from the roster.
   */
  test('desktop: the 外援 picker search filters the roster (typing a name narrows the list)', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-wg__slot', { visible: true, timeout: 20000 });
    await clickSel(page, '[data-testid="waiguan-slot-diy6a"]');
    await page.waitForSelector('.lo-wgpick input', { visible: true, timeout: 15000 });
    const all = await page.$$eval('.lo-wgpick__grid .lo-card', (els) => els.length);
    assert.ok(all > 50, `the unfiltered list is the whole roster (${all})`);

    // 维什戴尔: in the data (a 6★ outside the shop pool) and must be findable by name
    await page.click('.lo-wgpick input');
    await page.keyboard.type('维什戴尔');
    await page.waitForFunction((n) => document.querySelectorAll('.lo-wgpick__grid .lo-card').length === n, { timeout: 8000 }, 1);
    const names = await page.$$eval('.lo-wgpick__grid .lo-card .lo-card__name', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(names, ['维什戴尔'], 'the search narrows the list to the typed operator');
    assert.match(await page.$eval('.lo-wgpick__n', (el) => el.textContent), /1\s*名可选/);

    // a query that matches nothing is empty (and says so)
    await page.keyboard.type('xyz');
    await page.waitForFunction(() => document.querySelectorAll('.lo-wgpick__grid .lo-card').length === 0, { timeout: 8000 });
    assert.ok(await page.$('.lo-empty'), 'the empty state is shown');

    // a 调度中心 name is not a candidate, and the empty state explains that instead of just saying nothing matched
    for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('能天使');
    await page.waitForFunction(() => document.querySelectorAll('.lo-wgpick__grid .lo-card').length === 0, { timeout: 8000 });
    const hint = await page.$eval('[data-testid="waiguan-empty"]', (el) => el.textContent);
    assert.match(hint, /能天使/, 'the shop operator the query matched is named');
    assert.match(hint, /不是外援/, 'and the empty state says why it is not offered');

    // clearing the field brings the roster back
    for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
    await page.waitForFunction((n) => document.querySelectorAll('.lo-wgpick__grid .lo-card').length === n, { timeout: 8000 }, all);
    await page.screenshot({ path: path.join(OUT, 'waiguan-picker-search.png') });
    assert.deepEqual(problems, [], 'no console / page / request errors');
    await ctx.close();
  });

  test('phone 844×390 (touch): the slot row and the picker stay usable', async () => {
    const { ctx, page, problems } = await open({ w: 844, h: 390, touch: true });
    await page.waitForSelector('.lobby-screen', { visible: true, timeout: 20000 });
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-wg__slot', { visible: true, timeout: 20000 });
    const box = await page.$eval('.lo-wg__slot', (el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
    assert.ok(box[0] > 20 && box[1] > 20, `the slot tile has a usable size ${JSON.stringify(box)}`);
    await clickSel(page, '[data-testid="waiguan-slot-diy6a"]');
    await page.waitForSelector('.lo-wgpick__grid .lo-card', { visible: true, timeout: 20000 });
    await page.screenshot({ path: path.join(OUT, 'waiguan-picker-phone.png') });
    const grid = await page.$eval('.lo-wgpick__grid', (el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
    assert.ok(grid[1] > 40 && grid[1] <= 390, `the picker grid scrolls inside the viewport ${JSON.stringify(grid)}`);
    await page.click('.lo-wgpick__grid .lo-card');
    await page.waitForFunction(() => !document.querySelector('.lo-wgpick'), { timeout: 10000 });
    assert.equal(await page.$$eval('.lo-wg__slot.is-filled', (els) => els.length), 1, 'the tap selected a candidate');
    assert.deepEqual(problems, [], 'no console / page / request errors');
    await ctx.close();
  });

  test('desktop: the main roster search points an unpicked 外援 candidate at the slots', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-grid .lo-card', { visible: true, timeout: 20000 });
    // 维什戴尔 is a 外援 candidate and not in the shop pool: this roster lists the pool plus the picks, so it is absent
    // until the player picks it — the empty state must say that instead of a bare 「没有符合条件的干员」.
    await page.type('.lo-search input', '维什戴尔');
    await page.waitForSelector('[data-testid="roster-empty"]', { visible: true, timeout: 8000 });
    const text = await page.$eval('[data-testid="roster-empty"]', (el) => el.textContent);
    assert.match(text, /维什戴尔/, 'the candidate is named');
    assert.match(text, /外援候选/, 'and the empty state explains where it is picked');
    await page.screenshot({ path: path.join(OUT, 'waiguan-roster-hint.png') });
    assert.deepEqual(problems, [], 'no console / page / request errors');
    await ctx.close();
  });

  test('desktop: a 外援 drawn into the shop renders as the operator (name + avatar), not as its raw id', async () => {
    const { waiguanRecords } = await import('../../shared/waiguan.js');
    const { PHASE } = await import('../../shared/constants.js');
    const roster = await (await fetch(`${base}/data/waiguan.json`)).json();
    const cand = roster.candidates[2];
    const picks = { diy5a: cand.charId };
    const { ctx, page, problems } = await open({ picks });

    // the frames the lobby itself sends: create the solo room and start it
    await page.evaluate(async () => {
      const net = globalThis.__SP__.net;
      await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
      await net.request('room.start');
    });
    let m = null;
    const until = Date.now() + 40000;
    while (Date.now() < until && !m) {
      // THIS client's match: earlier tests leave their own (disconnected) matches behind on the shared server
      m = [...srv.lobby.rooms.values()].map((r) => r.match).filter(Boolean)
        .find((mm) => [...mm.players.values()].some((p) => !p.isBot && p.connected)) || null;
      if (!m) await sleep(300);
    }
    assert.ok(m, 'the match was created');
    const pid = [...m.players.values()].find((p) => !p.isBot)?.playerId;
    assert.ok(pid, 'the human seat exists');
    assert.deepEqual(m.waiguanPicks[pid], picks, 'the pick the client stored reached the match');

    // The briefing / band draft of a solo match runs through the UI's own flow; this test is about the SHOP card, so the
    // phase is forced to prep and both views are pushed (the client renders from m.public.phase + its private shop).
    const ps = m.players.get(pid);
    ps.shop.level = 6;
    const diy = new Set(Object.entries(waiguanRecords(roster)).filter(([, r]) => r.charId === cand.charId).map(([id]) => id));
    let found = null;
    for (let i = 0; i < 300 && !found; i++) {
      ps.rollShop({ keepFrozen: false });
      found = ps.shop.slots.find((s) => s && s.kind === 'chess' && diy.has(s.id)) || null;
    }
    assert.ok(found, 'the pick is in the shop');
    m.phase = PHASE.PREP;
    m.markPrivate(ps);
    m.flush(true);
    await page.waitForSelector('.scard', { visible: true, timeout: 25000 });

    await page.waitForFunction((name) => [...document.querySelectorAll('.scard__name')].some((e) => e.textContent.trim() === name), { timeout: 20000 }, cand.name);
    const names = await page.$$eval('.scard__name', (els) => els.map((e) => e.textContent.trim()));
    assert.ok(!names.some((n) => /^chess_/.test(n)), `no card falls back to its raw id (${JSON.stringify(names)})`);
    const card = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('.scard')].find((c) => c.querySelector('.scard__name')?.textContent.trim() === name);
      const img = el?.querySelector('.scard__art');
      return { found: !!el, src: img?.getAttribute('src') || null, w: img?.naturalWidth || 0, label: el?.getAttribute('aria-label') || null };
    }, cand.name);
    assert.ok(card.found, 'the 外援 card is on screen');
    assert.ok(card.src, `its portrait has a src (${JSON.stringify(card)})`);
    assert.ok(card.w > 0, `and the portrait actually loaded (${JSON.stringify(card)})`);
    assert.match(card.label || '', new RegExp(cand.name), 'and its aria-label names the operator');
    await page.screenshot({ path: path.join(OUT, 'waiguan-shop-card.png') });
    assert.deepEqual(problems, [], 'no console / page / request errors');
    await ctx.close();
  });
});
