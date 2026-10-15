import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, legalTileFor } from './harness.js';

for (const tier of [5, 6]) for (const skillIndex of [0, 1, 2]) {
  test(`望 T${tier} S${skillIndex + 1}: first prep grants playable stones without casting a skill`, () => {
    const slot = `chess_char_${tier}_diy1_a`;
    const h = makeMatch({ mode: 'solo', seed: 11, seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [slot]: { charId: 'char_2027_wang', skillIndex } } }] }).start();
    try {
      h.toPrep(1);
      const ps = h.ps('p_0');
      for (const p of [...ps.board.values(), ...ps.hand]) if (p) ps.returnCopies(p);
      ps.board.clear(); ps.hand.fill(null); ps.recompute();
      const owner = ps.acquireChess(slot, { source: 'buy' });
      assert.ok(owner);
      const tile = legalTileFor(h.m, ps, slot);
      assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: owner.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
      const stones = [...ps.hand, ...ps.temp].find(p => p?.kind === 'token' && p.ownerUid === owner.uid);
      assert.ok(stones, 'first deployment supplies stones');
      assert.equal(stones.id, 'token_10064_wang_stone1');
      assert.equal(stones.count, 7);
      const t2 = legalTileFor(h.m, ps, slot, new Set([`${tile[0]},${tile[1]}`]));
      assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: stones.uid, to: { area: 'board', row: t2[0], col: t2[1] } }), { ok: true });
      assert.ok(ps.battleInput().units.some(p => p.kind === 'token' && p.tokenId === stones.id));
    } finally { h.m.dispose(); }
  });
}
