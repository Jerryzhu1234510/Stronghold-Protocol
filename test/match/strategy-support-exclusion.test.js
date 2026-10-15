import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { MatchSpDraft } from '../../server/match/match/spDraft.js';

const MAKOTO = 'chess_char_5_diy1_a', ANGELINA = 'chess_char_5_diy2_a';
function setup(gameMode = 'normal') {
  const h = makeMatch({ mode: 'coop', fake: true, gameMode, seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true,
    diy: { [MAKOTO]: { charId: 'char_4217_makoto', skillIndex: 2, uniEquipId: null },
      [ANGELINA]: { charId: 'char_1015_aglna2', skillIndex: 2, uniEquipId: null } } }] }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.initDiyStock(); ps.shop.level = 6;
  return { h, m: h.m, ps };
}
for (const mode of ['normal', 'clone']) test(`${mode}: 潘格尼尼 / 贾维 cannot gift no-trait supports, while regular support acquisition remains available`, () => {
  const { m, ps } = setup(mode);
  try {
    for (const [, e] of m.pool.entries) e.left = 0;
    const ordinary = makeCtx(m, ps, { key: 'choice:test' }, 'onGain');
    const paganini = makeCtx(m, ps, { kind: 'band', key: 'band:band_paganini' }, 'onSpend');
    const chiave = makeCtx(m, ps, { kind: 'band', key: 'band:band_chiave' }, 'onRefresh');
    assert.ok(ordinary.rollPool('pool_char_later')?.id.includes('diy'), 'reproduces the old 潘格尼尼 support pool');
    assert.equal(paganini.rollPool('pool_char_later'), null);
    assert.equal(chiave.rollChess({ bond: 'siracusaShip', maxTier: 6 }), null);
    assert.equal(paganini.grantChess(MAKOTO), null);
    assert.equal(chiave.grantChess(ANGELINA), null);
    assert.ok(ordinary.grantChess(ANGELINA), 'support gifts outside strategies keep the established rules');
  } finally { m.dispose(); }
});

test('pool filters apply to explicit item and weighted lists as well as random pools', () => {
  const { m, ps } = setup();
  try {
    const gd = Object.create(m.gd);
    Object.defineProperty(gd, 'choices', { value: { pools: {
      support_test_items: { kind: 'chess', items: [MAKOTO] },
      support_test_weights: { kind: 'chess', weighted: [[ANGELINA, 1]] },
    } } });
    const draw = id => MatchSpDraft.prototype.rollPool.call({ gd, pool: m.pool, rngMeta: m.rngMeta }, id, { filter: cid => !ps.gd.chess(cid)?.isDiy });
    assert.equal(draw('support_test_items'), null);
    assert.equal(draw('support_test_weights'), null);
  } finally { m.dispose(); }
});
