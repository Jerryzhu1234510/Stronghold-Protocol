import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, checkInvariants } from './harness.js';

test('Clementia is bought from the shared five-tier stock; three copies merge into the elite trait without losing copies', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 20261009 }).start();
  try {
    h.toPrep(1);
    const m = h.m, ps = h.ps('p_0'), base = 'chess_char_4_27_a', elite = 'chess_char_4_27_b';
    assert.ok(m.pool.has(base));
    const before = m.pool.left(base);
    ps.shop.level = 5; ps.funds = 100;
    for (let i = 0; i < 3; i++) {
      ps.shop.slots[0] = { kind: 'chess', id: base, basePrice: m.gd.chessPrice(base), frozen: false, sold: false };
      assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
    }
    assert.equal(ps.funds, 88);
    assert.equal(m.pool.left(base), before - 3);
    const owned = [...ps.board.values(), ...ps.hand, ...(ps.temp || [])].filter(Boolean);
    assert.equal(owned.filter(p => p.id === base).length, 0);
    const promoted = owned.filter(p => p.id === elite);
    assert.equal(promoted.length, 1); assert.equal(promoted[0].poolCopies, 3);
    const record = m.gd.chess(promoted[0].id);
    assert.equal(record.garrisonIds[0], 'garrison_4231_b');
    assert.deepEqual(record.bonds, ['egirShip', 'swiftShip', 'indomShip']);
    assert.equal(m.gd.raw.garrisons[record.garrisonIds[0]].bb.check_cnt, 2);
    checkInvariants(m);
  } finally { h.m.dispose(); }
});
