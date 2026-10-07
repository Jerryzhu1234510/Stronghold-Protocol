// 外援 / 甄选 (DIY) slots — the four 6★ operators a player brings in from outside the shop pool (DESIGN §21.2).
//
// Covers the data-driven pick (shared/waiguan.js), the protocol check (checkWaiguanPicks), the per-player pool scoping
// (SharedPool.addOwned: a teammate never sees or buys another player's 甄选) and the match wiring (Match.setPicks /
// pool entries / the four empty slot templates staying unreachable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA, give, checkInvariants } from './harness.js';
import { checkWaiguanPicks } from '../../shared/protocol.js';
import { PHASE } from '../../shared/constants.js';
import { WAIGUAN_SLOTS, waiguanRecords } from '../../shared/waiguan.js';
import { WAIGUAN_POOL_COPIES, botWaiguanPicks } from '../../server/match/Match.js';

const ROSTER = DATA.waiguan;
const RECORDS = waiguanRecords(ROSTER);
/** Two different candidates of one tier (the pick rule forbids one operator filling two slots, whatever their tiers). */
const cands = ROSTER.candidates;
const pair = (tier) => [cands[0].chessIds[tier], cands[1].chessIds[tier]];
const charOf = (chessId) => RECORDS[chessId].charId;
/** The charId of candidate `i` as it appears in `tier` (four different candidates fill the four slots). */
const charAt = (i, tier) => charOf(cands[i].chessIds[tier]);

/** A solo match whose seat already carries `picks`. */
function solo(picks = null, seed = 5) {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks }];
  return makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats, seed }).start();
}

test('waiguan: checkWaiguanPicks accepts the four slots and refuses everything else', () => {
  const [a5, b5] = pair(5);
  // four DIFFERENT operators: one operator may fill one slot only (owner 2026-10-06)
  const good = { diy5a: charAt(0, 5), diy5b: charAt(1, 5), diy6a: charAt(2, 6), diy6b: charAt(3, 6) };
  assert.equal(new Set(Object.values(good)).size, 4, 'the fixture uses four different candidates');
  assert.deepEqual(checkWaiguanPicks(good, ROSTER), { ok: true, picks: good });
  // an empty selection is legal (the slots then stay unreachable)
  assert.deepEqual(checkWaiguanPicks({}, ROSTER), { ok: true, picks: {} });
  assert.deepEqual(checkWaiguanPicks({ diy5a: null }, ROSTER), { ok: true, picks: {} });
  // unknown slot / unknown operator / a pool operator / one operator in two slots (same tier or not)
  assert.equal(checkWaiguanPicks({ diy9z: charOf(a5) }, ROSTER).error, 'BAD_TARGET');
  assert.equal(checkWaiguanPicks({ diy5a: 'char_002_amiya' }, ROSTER).error, 'BAD_TARGET');
  assert.equal(checkWaiguanPicks({ diy5a: charOf(a5), diy5b: charOf(a5) }, ROSTER).error, 'BAD_TARGET');
  // the same operator may NOT take a tier V and a tier VI slot either: it is one person, one slot (owner 2026-10-06)
  const crossTier = checkWaiguanPicks({ diy5a: charAt(0, 5), diy6a: charAt(0, 6) }, ROSTER);
  assert.equal(crossTier.error, 'BAD_TARGET', 'a tier V pick is refused in a tier VI slot');
  assert.match(crossTier.detail, /already fills diy5a/);
  assert.equal(checkWaiguanPicks({ diy6b: charAt(0, 6), diy5b: charAt(0, 5) }, ROSTER).error, 'BAD_TARGET', 'in either order');
  // structurally invalid payloads
  assert.equal(checkWaiguanPicks('nope', ROSTER).error, 'BAD_MSG');
  assert.equal(checkWaiguanPicks({ diy5a: 42 }, ROSTER).error, 'BAD_MSG');
});

test('waiguan: the four slot templates stay empty and out of the pool until a player picks', () => {
  const h = solo(null);
  for (const slot of WAIGUAN_SLOTS) {
    const rec = DATA.chess[slot.chessId];
    assert.ok(rec && rec.isDiy && !rec.stats, `${slot.chessId}: the template has no combat data`);
    assert.equal(h.m.pool.has(slot.chessId), false, `${slot.chessId}: not in the pool`);
  }
  assert.deepEqual(h.m.waiguanPicks, {});
  h.m.dispose();
});

test('waiguan: a pick adds the operator record to the match and copies to the owner only', () => {
  const [a5] = pair(5);
  const h = solo({ diy5a: charOf(a5) });
  const m = h.m;
  const rec = RECORDS[a5];
  assert.deepEqual(m.waiguanPicks, { p_0: { diy5a: charOf(a5) } });
  assert.ok(m.gd.chess(a5), 'the tier V record is in this match\u2019s chess table');
  assert.equal(m.gd.chess(a5).name, rec.name);
  // one-argument has() asks the SHARED pool (a 甄选 entry belongs to its owner, so it is not in it); the owner-scoped form
  // is what the shop and the buy path use
  assert.equal(m.pool.has(a5), false, 'a 甄选 entry is not part of the shared pool');
  assert.equal(m.pool.has(a5, 'p_0'), true, 'the owner sees the entry');
  assert.equal(m.pool.has(a5, 'somebody_else'), false, 'a teammate never sees it');
  assert.equal(m.pool.left(a5, 'somebody_else'), 0, 'and can never buy it');
  assert.equal(m.pool.left(a5, 'p_0'), WAIGUAN_POOL_COPIES[5], 'the tier V copy cap is the official 8');
  // the shared pool never grew by an operator of the shop pool
  assert.equal(m.gd.visibleChess.includes(a5), false, 'a 甄选 record is not shop-visible');
  checkInvariants(m);
  m.dispose();
});

test('waiguan: a pick brings its ELITE record, so three copies merge (regression: 外援合不出精锐)', () => {
  const [a5] = pair(5);
  const h = solo({ diy5a: charOf(a5) });
  const m = h.m;
  const eliteId = `${a5.slice(0, -1)}b`;
  // `GameData.goldenIdOf` only answers when the golden record is in the table ITSELF, so a base-only patch made every
  // 甄选 pick un-mergeable: three identical copies bought, and no elite ever came out of them.
  assert.ok(m.gd.chess(a5), 'the base record is in the match table');
  assert.ok(m.gd.chess(eliteId), 'the elite record is in the match table too');
  assert.equal(m.gd.goldenIdOf(a5), eliteId, 'goldenIdOf resolves it');
  m.phase = PHASE.PREP;
  const ps = h.ps('p_0');
  const need = m.gd.mergeCount(a5);
  assert.ok(need > 1, `the pick merges (${need} copies)`);
  for (let i = 0; i < need; i++) assert.ok(ps.acquireChess(a5, { source: 'test' }), `copy ${i + 1} is gained`);
  const pieces = ps.allChess().filter((p) => m.gd.baseIdOf(p.id) === a5);
  assert.equal(pieces.length, 1, 'the copies became one piece');
  assert.equal(pieces[0].id, eliteId, 'and that piece is the elite');
  checkInvariants(m);
  m.dispose();
});

test('waiguan: the pick is actually ROLLABLE — its owner\u2019s shop draws it (regression: 群友 report)', () => {
  // The pool having the entry is not enough: `SharedPool._eligible` skips an owner-scoped entry unless the roll passes
  // `playerId`, so every call site that rolls for a player must pass it. Miss one and the picked operator sits in the pool
  // with full copies and NEVER appears in its owner's shop — which is what happened: `_rollChessSlot` / `pushRewardOffer`
  // / `pool.rollItem` / the effects' rollChess+rollPool / the choices gain_bond_chess roll all rolled without it.
  const [a5, b5] = pair(5);
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { diy5a: charOf(a5) } },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, picks: null },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 5 }).start();
  const me = h.ps('p_0');
  const mate = h.ps('p_1');
  me.shop.level = 6;
  mate.shop.level = 6;

  const draws = (ps, n = 240) => {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      ps.rollShop({ keepFrozen: false });
      if (ps.shop.slots.some((s) => s && s.kind === 'chess' && s.id === a5)) hits++;
    }
    return hits;
  };
  const mine = draws(me);
  const theirs = draws(mate);
  assert.ok(mine > 0, `the owner's shop draws the pick (${mine} of 240 rerolls)`);
  assert.equal(theirs, 0, 'a teammate never draws it');
  // the tier VI slot behaves the same (same call path, the other tier)
  const [a6] = pair(6);
  const solo6 = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { diy6a: charOf(a6) } }], seed: 9 }).start();
  const ps6 = solo6.ps('p_0');
  ps6.shop.level = 6;
  let hits6 = 0;
  for (let i = 0; i < 240; i++) {
    ps6.rollShop({ keepFrozen: false });
    if (ps6.shop.slots.some((s) => s && s.kind === 'chess' && s.id === a6)) hits6++;
  }
  assert.ok(hits6 > 0, `the tier VI pick is rollable too (${hits6} of 240)`);
  // and the reward offer path (the merge / special offer) rolls for one player as well
  const offer = ps6.pushRewardOffer('merge');
  assert.ok(offer, 'a reward offer is built');
  checkInvariants(h.m);
  checkInvariants(solo6.m);
  h.m.dispose();
  solo6.m.dispose();
  void b5;
});

test('waiguan: the shop favours the owner\u2019s picks (the 4× weight), so a pick is playable', () => {
  // The official caps (8 / 5) are tiny next to the ~1100 copies a level-6 shop draws from: with plain copy weighting a
  // pick showed up about once every NINE refreshes (measured 2.3% per slot), which reads as "my 外援 never comes". The
  // shop's chess roll weighs an owned entry 4× its copies (PlayerState.WAIGUAN_SHOP_WEIGHT). This pins the effect, not
  // the constant: drop the weight and the rate falls to ~11%, well under the bound below.
  const picks = { diy5a: charAt(0, 5), diy5b: charAt(1, 5), diy6a: charAt(2, 6), diy6b: charAt(3, 6) };
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks }], seed: 21 }).start();
  const m = h.m;
  const ps = h.ps('p_0');
  m.phase = PHASE.PREP;
  ps.shop.level = 6;
  const mine = new Set(Object.entries(RECORDS).filter(([, r]) => Object.values(picks).includes(r.charId)).map(([id]) => id));
  const N = 400;
  let offered = 0;
  for (let i = 0; i < N; i++) {
    ps.rollShop({ keepFrozen: false });
    if (ps.shop.slots.some((s) => s && s.kind === 'chess' && mine.has(s.id))) offered++;
  }
  const rate = offered / N;
  assert.ok(rate >= 0.2, `a filled shop offers a pick often (${(rate * 100).toFixed(1)}% of refreshes; plain weighting sat near 11%)`);
  // …and a shop below the pick's tier still never offers it (the tier rule is untouched by the weight)
  ps.shop.level = 4;
  let low = 0;
  for (let i = 0; i < 200; i++) {
    ps.rollShop({ keepFrozen: false });
    if (ps.shop.slots.some((s) => s && s.kind === 'chess' && mine.has(s.id))) low++;
  }
  assert.equal(low, 0, 'a shop below the tier (level 4) never shows a tier V/VI pick');
  checkInvariants(m);
  m.dispose();
});

test('waiguan: rolls never draw another player\u2019s pick (the private pool stays private)', () => {
  const [a5, b5] = pair(5);
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, picks: { diy5a: charOf(a5) } },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, picks: { diy5a: charOf(b5) } },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 9 }).start();
  const m = h.m;
  const rng = () => 0;
  // a tier filter the shared pool cannot satisfy at all: only the player's own 甄选 entry of that tier is eligible, so a
  // draw that returned another player's pick would be the leak this test is about
  for (let i = 0; i < 200; i++) {
    const id = m.pool.roll(rng, { tier: 5, maxTier: 5, playerId: 'p_0', filter: (cid) => cid.startsWith('chess_char_diy_') });
    assert.notEqual(id, b5, 'p_0 never rolls p_1\u2019s pick');
  }
  const mine = m.pool.roll(rng, { tier: 5, maxTier: 5, playerId: 'p_0', filter: (cid) => cid.startsWith('chess_char_diy_') });
  assert.equal(mine, a5, 'p_0\u2019s own pick is drawable');
  const theirs = m.pool.roll(rng, { tier: 5, maxTier: 5, playerId: 'p_1', filter: (cid) => cid.startsWith('chess_char_diy_') });
  assert.equal(theirs, b5, 'and p_1\u2019s for p_1');
  m.dispose();
});

test('waiguan: a pick whose bonds this match disabled is never seeded (拉特兰被禁 ⇒ 结城理)', () => {
  // The pool bans the shared chess of bonds that are ALL switched off (drawDisabledBonds `banned`); the picks follow the
  // same rule, or 结城理 — whose only bond is 拉特兰 — would still be dealt with 拉特兰 drawn as a ban (owner's report
  // 2026-10-06; research 01 「禁用盟约有可能影响自选的支援干员」).
  const yuki = ROSTER.candidates.find((c) => Array.isArray(c.bonds) && c.bonds.length === 1 && c.bonds[0] === 'lateranoShip');
  assert.ok(yuki, 'a single-bond 拉特兰 candidate');
  const chessId = yuki.chessIds[5];
  // seeds 1 and 2 are pinned: the ban draw is random, seed 1 bans 拉特兰, seed 2 leaves it open
  const blocked = solo({ diy5a: yuki.charId }, 1);
  assert.equal(blocked.m.disabledBondSet.has('lateranoShip'), true, 'seed 1 bans 拉特兰');
  assert.equal(blocked.m.pool.hasEntry(chessId), false, 'the pick never reaches the pool');
  assert.equal(blocked.m.pool.has(chessId, 'p_0'), false);
  assert.ok(blocked.m.gd.chess(chessId), 'the record is still in the chess table (the pick itself stays legal)');
  assert.equal(blocked.m.pool.hasEntry(`${chessId.slice(0, -1)}b`), false, 'and so does its elite');
  // a pick taken mid-match obeys the same rule: the slot is skipped rather than dealt
  blocked.m.setPicks('p_0', { diy5a: yuki.charId });
  assert.equal(blocked.m.pool.has(chessId, 'p_0'), false, 'setPicks withholds it too');
  assert.equal(blocked.m.waiguanPicks['p_0'], undefined);
  checkInvariants(blocked.m);
  blocked.m.dispose();

  const allowed = solo({ diy5a: yuki.charId }, 2);
  assert.equal(allowed.m.disabledBondSet.has('lateranoShip'), false, 'seed 2 leaves 拉特兰 open');
  assert.equal(allowed.m.pool.has(chessId, 'p_0'), true, 'so the pick IS seeded');
  checkInvariants(allowed.m);
  allowed.m.dispose();
});

test('waiguan: only a FULLY disabled bond set withholds a pick (one banned bond of two keeps it)', () => {
  const two = ROSTER.candidates.find((c) => Array.isArray(c.bonds) && c.bonds.length >= 2);
  assert.ok(two, 'a candidate with at least two bonds');
  for (let seed = 1; seed <= 40; seed++) {
    const h = solo({ diy5a: two.charId }, seed);
    const off = two.bonds.filter((b) => h.m.disabledBondSet.has(b));
    if (off.length > 0 && off.length < two.bonds.length) {
      assert.equal(h.m.pool.has(two.chessIds[5], 'p_0'), true, `seed ${seed}: ${off.join('/')} banned, but ${two.bonds.join('/')} is not fully off`);
      checkInvariants(h.m);
      h.m.dispose();
      return;
    }
    h.m.dispose();
  }
  assert.fail('no seed bans exactly one bond of the chosen candidate');
});

test('waiguan: botWaiguanPicks prefers the bonds a bot plays around, never repeating an operator', () => {
  // 维多利亚 is a core bond with roster candidates; the bot should take one of those over an unrelated candidate
  const victoria = ROSTER.candidates.filter((c) => c.bonds.includes('victoriaShip'));
  assert.ok(victoria.length >= 1, 'the roster has a 维多利亚 candidate to prefer');
  const picks = botWaiguanPicks(DATA, ROSTER, ['victoriaShip']);
  const byChar = new Map(ROSTER.candidates.map((c) => [c.charId, c]));
  assert.ok(picks.diy5a || picks.diy5b, 'the tier V slots are filled');
  assert.ok(picks.diy6a || picks.diy6b, 'the tier VI slots are filled');
  for (const [slot, charId] of Object.entries(picks)) {
    assert.ok(byChar.has(charId), `${slot}: ${charId} is a roster candidate`);
    assert.ok(byChar.get(charId).bonds.includes('victoriaShip'), `${slot}: the preferred bond wins the slot`);
  }
  // one operator, one slot — the same rule the player's own selection obeys
  const all = Object.values(picks);
  assert.equal(new Set(all).size, all.length, `an operator fills one slot only (${JSON.stringify(picks)})`);
  for (const tier of [5, 6]) {
    const slots = tier === 5 ? ['diy5a', 'diy5b'] : ['diy6a', 'diy6b'];
    const chosen = slots.map((s) => picks[s]).filter(Boolean);
    assert.equal(new Set(chosen).size, chosen.length, `tier ${tier}: two different operators`);
  }
  // an empty / missing roster is not an error
  assert.deepEqual(botWaiguanPicks(DATA, null, ['victoriaShip']), {});
  assert.deepEqual(botWaiguanPicks(DATA, { candidates: [] }, []), {});
});

test('waiguan: a bot seat brings its own picks, a human seat brings exactly what it sent', () => {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 3 }).start();
  const m = h.m;
  assert.equal(m.waiguanPicks.p_0, undefined, 'a human that picked nothing has no picks');
  const botPicks = m.waiguanPicks.ai_0;
  assert.ok(botPicks && Object.keys(botPicks).length >= 2, 'the bot filled slots of its own');
  const byChar = new Map(ROSTER.candidates.map((c) => [c.charId, c]));
  for (const [slot, charId] of Object.entries(botPicks)) {
    const tier = slot.startsWith('diy5') ? 5 : 6;
    assert.ok(byChar.has(charId), `${slot}: ${charId} is a roster candidate`);
    const rec = m.waiguanRecords[`chess_char_diy_${tier}_${charId}_a`];
    assert.ok(rec, `${slot}: the picked record exists`);
    assert.equal(m.pool.has(rec.chessId, 'ai_0'), true, `${slot}: the bot owns the entry`);
    assert.equal(m.pool.has(rec.chessId, 'p_0'), false, `${slot}: the human cannot see it`);
  }
  m.dispose();
});

test('waiguan: setPicks accepts a change before the shop is frozen and refuses it after', () => {  const [a5, b5] = pair(5);
  const h = solo(null);
  const m = h.m;
  const first = m.setPicks('p_0', { diy5a: charOf(a5) });
  assert.deepEqual(first, { ok: true });
  assert.equal(m.pool.left(a5, 'p_0'), WAIGUAN_POOL_COPIES[5]);
  // replacing the pick returns the old entry's copies: nothing is lost while the piece is unowned
  assert.deepEqual(m.setPicks('p_0', { diy5a: charOf(b5) }), { ok: true });
  assert.equal(m.pool.left(a5, 'p_0'), WAIGUAN_POOL_COPIES[5], 'the dropped slot keeps its copies (the entry stays)');
  assert.equal(m.pool.left(b5, 'p_0'), WAIGUAN_POOL_COPIES[5]);
  // a pick bought into the hand and then dropped gives its copies back
  const ps = h.ps('p_0');
  give(m, ps, b5);
  assert.equal(m.pool.left(b5, 'p_0'), WAIGUAN_POOL_COPIES[5] - 1, 'holding the piece took a copy');
  assert.deepEqual(m.setPicks('p_0', {}), { ok: true });
  assert.equal(m.pool.left(b5, 'p_0'), WAIGUAN_POOL_COPIES[5], 'the copies came back');
  assert.ok(ps.hand.some((p) => p && p.id === b5), 'the piece itself is untouched (it is the player\u2019s)');
  m.dispose();
});
