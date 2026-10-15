import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds } from '../../server/match/bondsMeta.js';

function emptyPrep() {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 11, fake: true }).start().toPrep(1);
  const p = h.ps('p_0');
  for (const x of p.allChess()) p.returnCopies(x);
  p.board.clear(); p.hand.fill(null); p.temp.fill(null); p.offers.length = 0; p.bandId = null; p.recompute();
  return { h, m: h.m, p };
}

for (const mu of ['chess_char_6_11_a', 'chess_char_6_11_b']) test(`seven distinct Yan operators plus Yan-converted ${mu} activate nine Yan`, () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const seven = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.bonds.includes('yanShip')).slice(0, 7);
  assert.equal(seven.length, 7);
  const pieces = seven.map((c, i) => ({ uid: i + 1, kind: 'chess', id: c.chessId, items: [] }));
  pieces.push({ uid: 8, kind: 'chess', id: mu, items: [{ id: 'chess_item_6_09_e_a' }, { id: 'chess_item_3_04_e_a' }] });
  const state = { board: new Map(pieces.map((p, i) => [`${9 + i % 4},${3 + Math.floor(i / 4)}`, p])), hand: [], layers: {} };
  const b = computeBonds(gd, state);
  assert.equal(b.yanShip.count, 9); assert.equal(b.yanShip.tier, 3); assert.equal(b.yanShip.harmony, 1);
  pieces[7].items.pop();
  const withoutConversion = computeBonds(gd, state);
  assert.equal(withoutConversion.yanShip.count, 8); assert.equal(withoutConversion.yanShip.tier, 2);
});
