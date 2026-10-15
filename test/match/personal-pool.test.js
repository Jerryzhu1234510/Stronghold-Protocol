import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { buildResult } from '../../server/match/results.js';

function prep(options = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, capacity: 4, fake: true,
    seed: 941, extensions: { personalPool: true }, ...options }).start();
  h.toPrep(1);
  return h;
}
function target(h) {
  return [...h.m.pool.entries].find(([id, e]) => e.tier === 6 && h.m.gd.goldenIdOf(id)
    && h.m.order.every(ps => ps.cardPool.left(id) === ps.cardPool.cap(id)))?.[0];
}
function buy(ps, id) {
  ps.funds = 100;
  ps.shop.slots = [{ kind: 'chess', id, basePrice: ps.gd.chessPrice(id), frozen: false, sold: false }];
  ps.shop.layout = { chess: 1, item: 0 };
  return ps.buy(0);
}
function deplete(ps, id) {
  const copies = ps.cardPool.left(id);
  for (let i = 0; i < copies; i++) assert.ok(ps.acquireChess(id, { silent: true }));
  assert.equal(ps.cardPool.left(id), 0);
}

test('default remains a shared pool, with unchanged seeded stock, bans and shops', () => {
  const a = prep({ extensions: {} }), b = prep({ extensions: { personalPool: false } });
  try {
    assert.equal(a.m.personalPools, null);
    assert.equal(a.ps('p_0').cardPool, a.m.pool); assert.equal(a.ps('p_1').cardPool, a.m.pool);
    assert.deepEqual(a.m.pool.snapshot(), b.m.pool.snapshot());
    assert.deepEqual(a.m.bannedChess, b.m.bannedChess);
    assert.deepEqual(a.m.order.map(p => p.shop.slots), b.m.order.map(p => p.shop.slots));
    const id = target(a), cap = a.m.pool.left(id);
    assert.deepEqual(buy(a.ps('p_0'), id), { ok: true });
    assert.equal(a.ps('p_1').poolOf(id).left(id), cap - 1);
    checkInvariants(a.m); checkInvariants(b.m);
  } finally { a.m.dispose(); b.m.dispose(); }
});

for (const capacity of [4, 8]) for (const gameMode of ['normal', 'clone']) {
  test(`personal pool isolates purchases, merges, sale and elimination (${capacity} seats/${gameMode})`, () => {
    const h = prep({ capacity, gameMode });
    try {
      const a = h.ps('p_0'), b = h.ps('p_1'), id = target(h);
      assert.ok(id); assert.notEqual(a.cardPool, b.cardPool);
      assert.notEqual(a.cardPool.entries.get(id), b.cardPool.entries.get(id));
      assert.equal(a.cardPool.cap(id), h.m.pool.cap(id), 'retain the room/clone copy multiplier');
      assert.deepEqual(a.cardPool.banned, h.m.bannedChess);
      const cap = b.cardPool.left(id);
      deplete(a, id);
      assert.equal(b.cardPool.left(id), cap, 'a teammate still has the complete stock');
      assert.equal(h.m.pool.left(id), cap, 'match-wide catalogue never absorbs personal mutations');
      assert.deepEqual(buy(b, id), { ok: true });
      assert.equal(b.cardPool.left(id), cap - 1); assert.equal(a.cardPool.left(id), 0);
      checkInvariants(h.m);
      const piece = a.allChess().find(p => h.m.gd.baseIdOf(p.id) === id), held = piece.poolCopies;
      assert.deepEqual(a.sell(piece.uid), { ok: true });
      assert.equal(a.cardPool.left(id), held); assert.equal(b.cardPool.left(id), cap - 1);
      a.eliminate(1);
      assert.equal(a.cardPool.left(id), cap); assert.equal(b.cardPool.left(id), cap - 1);
      checkInvariants(h.m);
    } finally { h.m.dispose(); }
  });
}

test('already displayed cards can overdraw only their owner, then selling returns the exact debt', () => {
  const h = prep();
  try {
    const a = h.ps('p_0'), b = h.ps('p_1'), id = target(h), cap = a.cardPool.cap(id);
    deplete(a, id); assert.deepEqual(buy(a, id), { ok: true });
    assert.equal(a.cardPool.entries.get(id).left, -1); assert.equal(b.cardPool.left(id), cap);
    checkInvariants(h.m);
    a.eliminate(1); assert.equal(a.cardPool.left(id), cap); assert.equal(b.cardPool.left(id), cap);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('shop weighting, promotion rewards, effects and all choice-pool shapes use the drawing player', () => {
  const h = prep({ data: structuredClone(DATA) });
  try {
    const a = h.ps('p_0'), b = h.ps('p_1'), id = target(h); deplete(a, id);
    const ca = makeCtx(h.m, a, { key: 'personal-test' }, 'onTest'), cb = makeCtx(h.m, b, { key: 'personal-test' }, 'onTest');
    assert.equal(ca.rollChess({ filter: candidate => candidate === id }), null);
    assert.equal(cb.rollChess({ filter: candidate => candidate === id }), id);
    h.m.gd.raw.choices = { ...h.m.gd.choices, pools: { ...h.m.gd.choices.pools,
      personalItems: { kind: 'chess', items: [id] }, personalWeighted: { kind: 'chess', weighted: [[id, 1]] },
      personalDraw: { kind: 'chess', tier: 6 } } };
    for (const pool of ['personalItems', 'personalWeighted', 'personalDraw']) {
      const opts = { filter: candidate => candidate === id };
      assert.equal(ca.rollPool(pool, opts), null); assert.equal(cb.rollPool(pool, opts)?.id, id);
    }
    // Pick the centre of this card's weighted interval. No artificial stock writes.
    const fraction = (pool, tier) => {
      const eligible = [...pool.entries].filter(([, e]) => e.left > 0 && e.tier <= tier);
      const total = eligible.reduce((n, [, e]) => n + e.left, 0);
      let before = 0; for (const [base, e] of eligible) { if (base === id) return (before + e.left / 2) / total; before += e.left; }
      throw Error('Expected target in the personal pool');
    };
    h.m.rngShop = () => fraction(b.cardPool, 6); a.shop.level = 6; b.shop.level = 6;
    assert.notEqual(a._rollChessSlot()?.id, id); assert.equal(b._rollChessSlot()?.id, id);
    const sixes = [...b.cardPool.entries].filter(([, e]) => e.tier === 6);
    const total = sixes.reduce((n, [, e]) => n + e.left, 0);
    const before = sixes.slice(0, sixes.findIndex(([base]) => base === id)).reduce((n, [, e]) => n + e.left, 0);
    h.m.rngShop = () => (before + b.cardPool.left(id) / 2) / total;
    const oa = a.pushRewardOffer('test', { tier: 6 }), ob = b.pushRewardOffer('test', { tier: 6 });
    assert.ok(oa.slots.every(slot => slot.id !== id)); assert.equal(ob.slots[0].id, id);
    assert.equal(ca.grantChess(id), null); assert.ok(cb.grantChess(id));
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('AI owns independent stock; existing DIY slots stay in their separate owner-only inventory', () => {
  const pick = { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
  const slot = 'chess_char_5_diy1_a';
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 911, fake: true, extensions: { personalPool: true }, seats: [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [slot]: pick } },
    { seat: 1, playerId: 'p_1', name: 'AI', isBot: true, connected: true },
  ] });
  try {
    const a = h.ps('p_0'), bot = h.ps('p_1'), id = target(h), cap = bot.cardPool.left(id);
    deplete(a, id); assert.equal(bot.cardPool.left(id), cap); assert.equal(bot.poolOf(id), bot.cardPool);
    assert.equal(a.poolOf(slot), a.diyStock); assert.notEqual(a.poolOf(slot), a.cardPool);
    const count = a.diyStock.left(slot); assert.ok(a.acquireChess(slot, { silent: true }));
    assert.equal(a.diyStock.left(slot), count - 1); assert.equal(bot.diyStock.has(slot), false);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('result/reconnect views preserve the option, and personal pool ABYSS clears count four cups only once', () => {
  const h = prep({ difficulty: 'ABYSS', extensions: { personalPool: true, bossHp: 96, duckEnhanced: 2 } });
  try {
    assert.equal(h.m.publicView().extensions.personalPool, true);
    assert.equal(h.m.extensions.personalPool, true); assert.ok(Object.isFrozen(h.m.extensions));
    h.m.round = 14;
    const result = buildResult(h.m, { victory: true, hiddenReached: false, hiddenCleared: false, reason: 'victory' });
    assert.equal(result.extensions.personalPool, true); assert.equal(result.trophyPolicy.multiplier, 0.5);
    assert.equal(result.players.find(p => p.playerId === 'p_0').trophies, 4);
  } finally { h.m.dispose(); }
});

test('AI shopping and reward pipelines preserve every personal stock across six complete rounds', () => {
  const seats = [0, 1].map(i => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, fake: true, seed: 13,
    extensions: { personalPool: true }, botRehearsal: 0 }).start();
  try {
    h.run(() => h.ended || h.m.phase === 'SETTLE' && h.m.round === 6);
    assert.equal(h.m.errorCount, 0); assert.ok(h.m.round >= 6);
    assert.notEqual(h.m.order[0].cardPool, h.m.order[1].cardPool);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});
