import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { SharedPool } from '../../server/match/pool.js';
import { bossPoolHp, pairPlayers } from '../../server/match/finalAssault.js';
import { roomScaling, roomBossHp, PHASE } from '../../shared/constants.js';
import { createBattleFromSpec, compactResult } from '../../server/sim/spec.js';
import { generateDraft } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { normalizeSeats } from '../../public/js/screens/room.js';
import { supportChessId } from '../../shared/supports.js';

for (const capacity of [5, 6, 7, 8]) {
  test(`${capacity}-player card pool has the exact rounded tier totals, including support copies`, () => {
    const gd = new GameData(DATA, 'mode_multi_funny');
    const base = new SharedPool(gd);
    const enlarged = new SharedPool(gd, { copiesMultiplier: capacity / 4 });
    for (let tier = 1; tier <= 6; tier++) {
      const total = (pool) => [...pool.entries.values()].filter((entry) => entry.tier === tier).reduce((sum, entry) => sum + entry.cap, 0);
      assert.equal(total(enlarged), Math.round(total(base) * capacity / 4));
    }
    for (const [id, entry] of enlarged.entries) {
      assert.ok(Number.isInteger(entry.cap));
      assert.equal(enlarged.take(id, 999), entry.cap);
      assert.equal(enlarged.left(id), 0);
      assert.equal(enlarged.give(id, 999), entry.cap);
    }
  });

  test(`${capacity}-player normal, unite, offspring and client replica HP use the capped multiplier once`, () => {
    const h = makeMatch({ humans: capacity, difficulty: 'FUNNY', capacity });
    const scale = roomScaling(capacity);
    assert.deepEqual(h.m.roomScale, scale);
    h.start(); h.toPrep(1);
    const opts = h.m._normalOpts(h.m.order[0]);
    const key = 'enemy_1422_lrsldr';
    assert.ok(h.m.ds.getEnemy(key));
    const mods = { hpMul: 2 };
    const normal = h.m.newBattle(opts);
    const enemy = normal.spawnEnemy(key, { mods });
    assert.equal(enemy.s.maxHp, h.m.ds.getEnemy(key).maxHp * 2 * scale.enemyHp);
    const offspring = normal.spawnEnemy(key);
    assert.equal(offspring.s.maxHp, h.m.ds.getEnemy(key).maxHp * scale.enemyHp);
    const unite = h.m.newBattle({ ...opts, kind: 'unite' });
    const reentered = unite.spawnEnemy(key, { mods: enemy.mods });
    assert.equal(reentered.s.maxHp, enemy.s.maxHp, 'leak-to-unite does not double the room multiplier');
    const field = h.m._ccField({ fieldId: 'n:p_0', kind: 'normal', players: ['p_0'], opts });
    assert.equal(field.spec.flags.roomEnemyHp, scale.enemyHp);
    const replica = createBattleFromSpec(field.spec, h.m.ds);
    assert.equal(replica.spawnEnemy(key, { mods }).s.maxHp, enemy.s.maxHp);
    h.m.dispose();
  });

  test(`${capacity}-player choice drafts give enough cards and unique slot indices in every family`, () => {
    const gd = new GameData(DATA, 'mode_multi_funny');
    for (const round of gd.spRounds()) for (let seed = 1; seed <= 12; seed++) {
      const draft = generateDraft(gd, createRng(seed), round, { cardsMultiplier: capacity / 4, stageId: 'act2autochess_m_01' });
      if (!draft) continue;
      assert.ok(draft.cards.length >= capacity, `${round}/${draft.family}: ${draft.cards.length}`);
      assert.ok(draft.cards.length <= 12);
      assert.equal(new Set(draft.cards.map((card) => card.idx)).size, draft.cards.length);
    }
  });
}

for (const clientCombat of [false, true]) test(`eight-player match completes briefing, all drafts, normal battles and four boss pairs (${clientCombat ? 'client' : 'server'})`, () => {
  const h = makeMatch({ humans: 8, capacity: 8, difficulty: 'FUNNY', fake: true, clientCombat,
    script: (battle) => ({ duration: ['boss', 'hidden'].includes(battle.kind) ? Infinity : 0.1, bossDps: 1e8 }) });
  const drafts = new Set();
  h.start();
  assert.equal(h.m.publicView().players.length, 8);
  assert.equal(normalizeSeats({ mode: 'coop', capacity: 8, seats: h.m.order }).length, 8);
  assert.equal(pairPlayers(h.m.order).length, 4);
  const finished = h.drive(() => { if (h.m.sp) drafts.add(h.m.sp); return !!h.ended; });
  assert.equal(finished, true);
  assert.equal(h.m.phase, PHASE.RESULT);
  for (const draft of drafts) assert.equal(Object.keys(draft.picks).length, 8, `${draft.family}: every player must receive a card`);
  assert.ok(drafts.size > 0);
  assert.equal(h.m.bossPool.maxHp, Math.round(bossPoolHp(h.m.gd, h.m.bossId, 8) * roomBossHp(8)));
  assert.equal(h.logs.error.length, 0, h.logs.error.join('\n'));
  h.invariants(); h.m.dispose();
});

test('selected capacity controls scaling even with fewer members and after eliminations; four-player and solo stay unchanged', () => {
  for (const [mode, capacity, humans, expected] of [['coop', 8, 2, { cards: 2, enemyHp: 1.5 }], ['coop', 4, 4, { cards: 1, enemyHp: 1 }], ['solo', 8, 1, { cards: 1, enemyHp: 1 }]]) {
    const h = makeMatch({ mode, capacity, humans, fake: true });
    assert.deepEqual(h.m.roomScale, expected);
    h.m.order[0].alive = false;
    assert.deepEqual(h.m.roomScale, expected);
    h.m.dispose();
  }
});

test('battle result sanitization retains all eight participants instead of silently dropping seats five to eight', () => {
  const perPlayer = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`p_${index}`, {
    killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, unitsEnd: [],
  }]));
  assert.equal(Object.keys(compactResult({ reason: 'cleared', time: 1, perPlayer }).perPlayer).length, 8);
});
