// 外援 cards in the MATCH UI (DESIGN §21.2): a 外援 drawn into the shop / hand / board must render as the OPERATOR — name
// and avatar — not as its raw chess id. The match UI resolves every chess id through `data.lookup('chess', …)`
// (shopBar.js ChessCard `c?.name || slot.id`), and a 甄选 record is NOT in data/chess.json, so the loadout sync installs
// the player's picks as a chess overlay (data.js setChessOverlay) exactly like the server merges them into a match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDataStore, data, setChessOverlay } from '../../public/js/data.js';
import { waiguanRecords, WAIGUAN_SLOTS } from '../../shared/waiguan.js';
import { waiguanPickChess } from '../../public/js/ui/loadoutModel.js';
import { installLoadoutSync } from '../../public/js/ui/loadoutSync.js';
import { bondMembers } from '../../public/js/ui/gameLogic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const WAIGUAN = JSON.parse(readFileSync(path.join(ROOT, 'data/waiguan.json'), 'utf8'));
const BONDS = JSON.parse(readFileSync(path.join(ROOT, 'data/bonds.json'), 'utf8'));
const RECORDS = waiguanRecords(WAIGUAN);
const CAND = WAIGUAN.candidates[2];
const A5 = CAND.chessIds[5];
const G5 = `${A5.slice(0, -1)}b`;
const PICKS = { diy5a: CAND.charId };
assert.ok(RECORDS[A5] && RECORDS[G5], 'the candidate has both forms');

test('外援: chess.json carries only the four empty templates, never a picked operator', () => {
  assert.equal(Object.hasOwn(CHESS, A5), false, `the static file has no ${A5}`);
  assert.equal(Object.hasOwn(CHESS, G5), false);
  for (const s of WAIGUAN_SLOTS) assert.equal(CHESS[s.chessId].isDiy, true, `${s.chessId}: the template`);
});

test('外援: the chess overlay answers lookup() — name, tier, and the charId the art is built from', () => {
  const store = createDataStore();
  store.setChessOverlay(waiguanPickChess(WAIGUAN, PICKS));
  const base = store.lookup('chess', A5);
  const gold = store.lookup('chess', G5);
  assert.equal(base?.name, CAND.name, 'the shop card shows the operator name');
  assert.equal(base?.charId, CAND.charId, 'and builds its portrait from this charId');
  assert.equal(base?.tier, 5);
  assert.equal(gold?.isGolden, true, 'the elite form of the pick is resolvable too');
  assert.equal(store.lookup('chess', 'chess_char_diy_5_char_999_ghost_a'), null, 'anything else stays unknown');
  // `list` stays the static file on purpose: a pool enumeration must not grow by a pick (the roster screens add them)
  assert.equal(store.list('chess').length, 0);
  store.setChessOverlay(null);
  assert.equal(store.lookup('chess', A5), null, 'clearing the overlay removes it again');
});

test('外援: the bond popup lists the pick as a member (bonds.json cannot know runtime records)', () => {
  // a candidate carrying a CORE bond, so data/bonds.json has the record to test against
  const cand = WAIGUAN.candidates.find((c) => (c.bonds || []).some((b) => BONDS[b]?.isCore));
  assert.ok(cand, 'a candidate carrying a core bond');
  const bondId = cand.bonds.find((b) => BONDS[b]?.isCore);
  const chessId = cand.chessIds[5];
  const overlay = waiguanPickChess(WAIGUAN, { diy5a: cand.charId });
  const getChess = (id) => overlay[id] || null;
  // the static member list of bonds.json has no 外援 in it — that is the gap the popup showed
  const plain = bondMembers(BONDS[bondId], { board: [], hand: [], temp: [] }, [], getChess, () => null);
  assert.equal(plain.some((r) => r.id === chessId), false, 'the static list misses the pick');
  // with the owner's overlay records passed in, the pick is a row like any other member
  const priv = { board: [{ uid: 1, kind: 'chess', id: chessId }], hand: [], temp: [] };
  const rows = bondMembers(BONDS[bondId], priv, [], getChess, () => null, Object.values(overlay));
  const row = rows.find((r) => r.id === chessId);
  assert.ok(row, `${cand.name} is listed as a ${BONDS[bondId].name} member`);
  assert.equal(row.name, cand.name);
  assert.equal(row.tier, 5);
  assert.equal(row.owned, true, 'and owning it on the board is marked');
  assert.equal(row.onBoard, true);
  assert.equal(rows.filter((r) => r.id === chessId).length, 1, 'once only (the overlay holds the elite form too)');
});

test('外援: a refused loadout entry is retried after re-sending the picks (never silently dropped)', async () => {
  // The lobby only accepts a 外援 loadout entry against a pick it already stored. When room.pick has not landed yet the
  // entry comes back BAD_TARGET — and the sync used to drop it with a console warning only: the player's skill choice was
  // gone with no explanation (owner's report 2026-10-06, "干员调配里换技能局内没变").
  const overlay = waiguanPickChess(WAIGUAN, PICKS);
  setChessOverlay(overlay);
  const sent = [];
  let refuseOnce = true;
  const net = {
    status: 'online',
    request: async (t) => {
      sent.push(t);
      if (t === 'room.loadout' && refuseOnce) { refuseOnce = false; const e = new Error('refused'); e.code = 'BAD_TARGET'; throw e; }
      return {};
    },
    on: () => () => {},
  };
  const queue = [];
  const timers = { setTimeout: (fn) => { queue.push(fn); return queue.length; }, clearTimeout: () => {} };
  let state = { picks: PICKS, entries: { [A5]: { skill: 2 } }, sync: 'idle', open: false };
  const subs = new Set();
  const target = {
    get: () => state,
    set: (p) => { const prev = state; state = { ...state, ...p }; for (const f of subs) f(state, prev); },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  };
  const sync = installLoadoutSync({
    net, timers, target, getChessReady: async () => CHESS, lookupChess: (id) => CHESS[id] || overlay[id] || null,
    loadWaiguan: async () => WAIGUAN, getWaiguan: () => WAIGUAN,
  });
  try {
    await sync.flush();
    while (queue.length) { const fn = queue.shift(); fn(); await new Promise((r) => setImmediate(r)); }
    assert.deepEqual(sent.slice(0, 4), ['room.pick', 'room.loadout', 'room.pick', 'room.loadout'],
      `the picks are re-sent and the loadout retried (${JSON.stringify(sent)})`);
  } finally {
    sync.dispose();
    setChessOverlay(null);
  }
});

test('外援: the loadout sync installs the overlay from the picks (the fix for the raw-id card)', async () => {
  data.setChessOverlay(null);
  const sent = [];
  const net = { status: 'online', request: async (t, payload) => { sent.push({ t, payload }); return {}; }, on: () => () => {} };
  const mkTarget = (init) => {
    let s = { ...init };
    const subs = new Set();
    return { get: () => s, set: (p) => { const prev = s; s = { ...s, ...p }; for (const f of subs) f(s, prev); }, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } };
  };
  const target = mkTarget({ picks: PICKS, entries: {}, sync: 'idle', open: false });
  const sync = installLoadoutSync({
    net, target, getChessReady: async () => CHESS, lookupChess: (id) => CHESS[id] || null,
    loadWaiguan: async () => WAIGUAN, getWaiguan: () => WAIGUAN,
  });
  try {
    await sync.flushPicks();
    assert.deepEqual(sent.map((s) => s.t), ['room.pick'], 'the pick goes to the server as before');
    assert.deepEqual(sent[0].payload.picks, PICKS);
    assert.equal(data.lookup('chess', A5)?.name, CAND.name, 'and the match UI can now resolve the pick');
    assert.equal(data.lookup('chess', G5)?.isGolden, true, 'elite form included');
    target.set({ picks: {} });
    await sync.flushPicks();
    assert.equal(data.lookup('chess', A5), null, 'an emptied selection clears the overlay');
  } finally {
    sync.dispose();
    data.setChessOverlay(null);
  }
});
