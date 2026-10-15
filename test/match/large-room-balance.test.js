import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, legalTileFor } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { roomStartLp, roomOperatorStats } from '../../shared/constants.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const humans of [1, 2, 3, 4]) test(`${humans} humans in a four-seat room receive none of the experimental bonuses`, () => {
  const h = makeMatch({ humans, capacity: 4, fake: true }).start();
  h.toPrep(1);
  const base = new GameData(DATA, 'mode_multi_normal');
  assert.equal(h.m.gd.largeRoomBonus, 0);
  assert.equal(h.m.publicView().capacity, 4);
  assert.deepEqual(h.m.gd.bans('NORMAL'), base.bans('NORMAL'));
  for (const ps of h.m.order) {
    assert.equal(ps.lp, base.startLp(ps.bandId));
    assert.equal(ps.privateView().shop.bonusChessSlots, undefined);
    assert.deepEqual(ps.shopFocusOptions(), []);
    assert.equal(h.m.newBattle(h.m._normalOpts(ps)).opts.flags.roomOperatorStats, undefined);
  }
  h.m.dispose();
});

for (const capacity of [4, 5, 6, 7, 8]) {
  test(`${capacity} seats: every opening's LP is scaled and rounded, including fallback; public LP matches`, () => {
    const base = new GameData(DATA, 'mode_multi_normal');
    const gd = new GameData(DATA, 'mode_multi_normal', { capacity });
    const numerator = { 4: 10, 5: 11, 6: 12, 7: 13, 8: 14 }[capacity];
    for (const id of [...base.bandIds(), 'unknown']) {
      assert.equal(gd.startLp(id), Math.ceil(base.startLp(id) * numerator / 10));
    }
    assert.equal(roomStartLp(19, capacity), Math.ceil(19 * numerator / 10));
    const h = makeMatch({ humans: 1, capacity, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    assert.equal(ps.lp, gd.startLp(ps.bandId));
    assert.equal(h.m.publicView().players[0].lp, ps.lp);
    ps.alive = false;
    assert.equal(gd.startLp(ps.bandId), Math.ceil(base.startLp(ps.bandId) * numerator / 10), 'elimination does not shrink the capacity multiplier');
    h.m.dispose();
  });

  test(`${capacity} seats: all field types carry the same operator bonus to server and browser`, () => {
    const h = makeMatch({ humans: 1, capacity }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const rec = Object.values(DATA.chess).find(c => c.tier === 1 && !c.isGolden && h.m.pool.has(c.chessId));
    give(h.m, ps, rec.chessId, 'board', legalTileFor(h.m, ps, rec.chessId));
    const opts = h.m._normalOpts(ps);
    for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
      const b = h.m.newBattle({ ...opts, kind });
      const field = h.m._ccField({ fieldId: 'qa', kind, players: ['p_0'], opts });
      const replica = createBattleFromSpec(field.spec, h.m.ds);
      assert.equal(b.flags.roomOperatorStats ?? 1, roomOperatorStats(capacity));
      assert.equal(replica.flags.roomOperatorStats ?? 1, roomOperatorStats(capacity));
      assert.ok(b.allyUnits.some(u => u.kind === 'op'));
      for (const u of b.allyUnits.filter(u => u.kind === 'op')) {
        const other = replica.allyUnits.find(x => x.uid === u.uid);
        for (const k of ['maxHp', 'atk', 'def', 'res', 'aspd']) {
          close(u.base[k], u.def.stats[k] * roomOperatorStats(capacity));
          close(other.base[k], u.base[k]);
        }
      }
    }
    h.m.dispose();
  });
}

test('solo ignores an oversized requested capacity for LP and operator stats', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, capacity: 8 }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal(ps.lp, new GameData(DATA, 'mode_single_normal').startLp(ps.bandId));
  const b = h.m.newBattle(h.m._normalOpts(ps));
  assert.equal(b.flags.roomOperatorStats, undefined);
  for (const u of b.allyUnits.filter(u => u.kind === 'op')) close(u.base.atk, u.def.stats.atk);
  h.m.dispose();
});

test('basic operator bonus coexists with buffs, survives repeated revival and leaves shared data unchanged', () => {
  const rec = chessRec({ id: 'qa_guard', skill: null, stats: { maxHp: 1000, atk: 200, def: 100, res: 10, aspd: 100 } });
  const original = JSON.stringify(rec);
  const h = makeBattle({ content: 'none', defs: { chess: { qa_guard: rec } },
    units: [{ chessId: 'qa_guard', row: 10, col: 4 }], flags: { roomOperatorStats: 1.2 } });
  h.battle.start();
  const u = h.unit('qa_guard');
  for (const [key, value] of Object.entries({ maxHp: 1200, atk: 240, def: 120, res: 12, aspd: 120 })) close(u.s[key], value);
  close(u.s.interval, 1 / 1.2);
  assert.equal(u.base.blockCnt, 2);
  assert.equal(u.base.cost, 10);
  assert.equal(u.base.respawnTime, 20);
  assert.equal(u.base.spRecovery, 1);
  h.battle.addBuff(u, { key: 'qa:skill', mods: { atkPct: .5, hpPct: .25, aspd: 30 }, persist: true });
  close(u.s.atk, 360); close(u.s.maxHp, 1500); close(u.s.aspd, 150);
  for (let i = 0; i < 3; i++) {
    h.battle.retreat(u);
    assert.equal(h.battle.redeploy(u), true);
    close(u.base.atk, 240); close(u.base.maxHp, 1200);
  }
  const summon = h.battle.spawnToken(u, 'qa_token', 10, 5, { def: { stats: { maxHp: u.base.maxHp, atk: u.base.atk } } });
  assert.ok(summon);
  close(summon.base.maxHp, 1200); close(summon.base.atk, 240);
  assert.equal(JSON.stringify(rec), original);
  h.invariants();
});

test('prep detail stats include the same boost as the actual battle, and repeated preview requests do not stack it', () => {
  const h = makeMatch({ capacity: 8 }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  const rec = Object.values(DATA.chess).find(c => c.tier === 1 && !c.isGolden && h.m.pool.has(c.chessId));
  const piece = give(h.m, ps, rec.chessId, 'board', legalTileFor(h.m, ps, rec.chessId));
  h.m.handle('p_0', { t: 'g.unitStats', seq: 1 });
  const first = h.lastTo('p_0', 'm.unitStats').units.find(u => u.uid === piece.uid);
  const b = h.m.newBattle(h.m._normalOpts(ps));
  b.start();
  const unit = b.allyUnits.find(u => u.uid === piece.uid);
  assert.equal(first.maxHp, Math.round(unit.s.maxHp));
  assert.equal(first.base.atk, Math.round(unit.def.stats.atk * 1.2));
  h.m.handle('p_0', { t: 'g.unitStats', seq: 2 });
  assert.deepEqual(h.lastTo('p_0', 'm.unitStats').units.find(u => u.uid === piece.uid), first);
  h.m.dispose();
});
