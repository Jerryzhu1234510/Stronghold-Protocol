import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, checkInvariants } from './harness.js';
import { DiyStock } from '../../server/match/player/diy.js';

test('a displayed card bought after stock depletion occupies a deficit; selling it cannot create new stock', t => {
  const h = makeMatch({ mode: 'coop', humans: 4, fake: true, seed: 440025 }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const m = h.m, buyer = h.ps('p_0'), holder = h.ps('p_1'), id = 'chess_char_2_01_a';
  for (const p of m.order) {
    for (const piece of p.allChess()) p.returnCopies(piece);
    p.board.clear(); p.hand.fill(null); p.temp.fill(null); p.offers.length = 0; p.bandId = null; p.recompute();
  }
  buyer.shop.slots[0] = { kind: 'chess', id, price: 2, basePrice: 2, sold: false };
  const cap = m.pool.cap(id);
  assert.ok(cap > 0);
  for (let i = 0; i < cap; i++) assert.ok(holder.acquireChess(id));
  assert.equal(m.pool.left(id), 0);
  buyer.funds = 999;
  assert.deepEqual(buyer.buy(0), { ok: true });
  assert.equal(m.pool.entries.get(id).left, -1);
  const purchased = buyer.allChess().find(p => p.id === id);
  assert.equal(purchased.poolCopies, 1);
  checkInvariants(m);
  assert.ok(buyer.sell(purchased.uid).ok);
  assert.equal(m.pool.left(id), 0);
  const returned = holder.allChess()[0], copies = returned.poolCopies;
  assert.ok(holder.sell(returned.uid).ok);
  assert.equal(m.pool.left(id), copies);
  checkInvariants(m);
});

test('a fixed elite grant beyond shared stock occupies all three copies and returns its deficit first', t => {
  const h = makeMatch({ mode: 'solo', fake: true, seed: 440026 }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const p = h.ps('p_0'), id = 'chess_char_5_01_a', pool = h.m.pool;
  // The other already-owned copies are represented in this isolated stock transaction.
  const cap = pool.cap(id);
  assert.equal(pool.take(id, cap), cap);
  const gift = p.acquireChess(id.replace(/_a$/, '_b'));
  assert.ok(gift);
  assert.equal(gift.poolCopies, 3);
  assert.equal(pool.entries.get(id).left, -3);
  assert.ok(p.sell(gift.uid).ok);
  assert.equal(pool.entries.get(id).left, 0);
  assert.equal(pool.give(id, cap), cap);
});

test('DIY deficits use the same accounting without changing their scaled caps or ordinary stock checks', () => {
  const stock = new DiyStock();
  stock.entries.set('slot', { cap: 8, left: 0, tier: 5, shopLevel: 5 });
  assert.equal(stock.take('slot', 1), 0);
  assert.equal(stock.take('slot', 3, { overdraw: true }), 3);
  assert.equal(stock.left('slot'), 0);
  assert.equal(stock.cap('slot'), 8);
  assert.equal(stock.give('slot', 2), 2);
  assert.equal(stock.left('slot'), 0);
  assert.equal(stock.give('slot', 1), 1);
  assert.equal(stock.left('slot'), 0);
  stock.give('slot', 1);
  assert.equal(stock.left('slot'), 1);
});
