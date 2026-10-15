import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { roomEnemyStats, roomBossHp } from '../../shared/constants.js';

const rows = [[5, 1.25, 1.3, 1.1, 2], [6, 1.5, 1.4, 1.15, 2.4],
  [7, 1.5, 1.5, 1.2, 2.8], [8, 1.5, 1.6, 1.25, 3.2]];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

for (const [capacity, hp, atk, def, bossHp] of rows) {
  test(`${capacity} seats: highest-difficulty normal/offspring/unite/boss/hidden enemies and browser replicas agree`, () => {
    const h = makeMatch({ capacity, difficulty: 'ABYSS' }).start();
    h.toPrep(1);
    const opts = h.m._normalOpts(h.m.order[0]);
    const key = 'enemy_1422_lrsldr';
    const mods = { hpMul: 2, atkMul: 1.5, defMul: .5 };
    for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
      const b = h.m.newBattle({ ...opts, kind });
      const field = h.m._ccField({ fieldId: 'qa', kind, players: ['p_0'], opts: { ...opts, kind } });
      const replica = createBattleFromSpec(field.spec, h.m.ds);
      for (const battle of [b, replica]) {
        const u = battle.spawnEnemy(key, { mods });
        close(u.s.maxHp, u.def.maxHp * 2 * hp);
        close(u.s.atk, u.def.atk * 1.5 * atk);
        close(u.s.def, u.def.def * .5 * def);
        close(u.s.res, u.def.res);
        close(u.s.moveSpeed, u.def.moveSpeed);
        const child = battle.spawnEnemy(key);
        close(child.s.atk, child.def.atk * atk);
        close(child.s.def, child.def.def * def);
        const transfer = battle.spawnEnemy(key, { mods: u.mods });
        close(transfer.s.atk, u.s.atk);
        close(transfer.s.def, u.s.def);
      }
    }
    h.m.dispose();
  });

  for (const hidden of [false, true]) test(`${capacity} seats: ${hidden ? 'hidden' : 'final'} boss uses ONE larger pool even after eliminations`, () => {
    const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', clientCombat: true, clients: false }).start();
    h.toPrep(1);
    // Selected capacity remains the difficulty even when not all original members survive.
    h.m.order[0].alive = false;
    h.m.round = hidden ? h.m.gd.hiddenRound : h.m.gd.bossRound;
    h.m.startFinalAssault(hidden);
    const id = hidden ? h.m.hiddenBossId : h.m.bossId;
    const base = bossPoolHp(h.m.gd, id, capacity - 1);
    assert.equal(h.m.bossPool.maxHp, Math.round(base * bossHp));
    assert.equal(h.m.fields.length, Math.ceil((capacity - 1) / 2));
    for (const field of h.m.fields) {
      assert.equal(field.spec.boss.poolMax, h.m.bossPool.maxHp);
      const replica = createBattleFromSpec(field.spec, h.m.ds);
      assert.equal(replica.sharedBoss.maxHp, h.m.bossPool.maxHp);
    }
    h.m.dispose();
  });
}

for (const humans of [1, 2, 3, 4]) test(`${humans} humans in a four-seat room: enemy damage/defence and boss HP retain original rules`, () => {
  const h = makeMatch({ humans, capacity: 4, difficulty: 'ABYSS', clientCombat: true, clients: false }).start();
  h.toPrep(1);
  const b = h.m.newBattle(h.m._normalOpts(h.m.order[0]));
  const u = b.spawnEnemy('enemy_1422_lrsldr');
  assert.equal(b.flags.roomEnemyAtk, undefined);
  assert.equal(b.flags.roomEnemyDef, undefined);
  assert.equal(u.s.atk, u.def.atk);
  assert.equal(u.s.def, u.def.def);
  h.m.round = h.m.gd.bossRound;
  h.m.startFinalAssault(false);
  assert.equal(h.m.bossPool.maxHp, bossPoolHp(h.m.gd, h.m.bossId, humans));
  h.m.dispose();
});

test('solo and invalid requested capacities receive no new difficulty multiplier', () => {
  for (const capacity of [1, 2, 3, 4, 0, 9, null, undefined]) {
    assert.deepEqual(roomEnemyStats(capacity), { atk: 1, def: 1 });
    assert.equal(roomBossHp(capacity), 1);
  }
  const h = makeMatch({ mode: 'solo', capacity: 8, difficulty: 'ABYSS', clientCombat: true, clients: false }).start();
  h.toPrep(1);
  assert.equal(h.m.newBattle(h.m._normalOpts(h.m.order[0])).flags.roomEnemyAtk, undefined);
  h.m.round = h.m.gd.bossRound;
  h.m.startFinalAssault(false);
  assert.equal(h.m.bossPool.maxHp, bossPoolHp(h.m.gd, h.m.bossId, 1));
  h.m.dispose();
});

test('eight-seat combat becomes more dangerous in an actual fight while retaining the operator bonus', () => {
  const fight = (stronger) => {
    const h = makeBattle({ content: 'none', autoFinish: false,
      defs: { chess: { tank: chessRec({ id: 'tank', skill: null, stats: { maxHp: 2000, atk: 0, def: 500 } }) },
        enemies: { test: enemyRec({ key: 'test', hp: 100000, atk: 800, def: 100, bat: 1 }) } },
      units: [{ chessId: 'tank', row: 9, col: 5 }],
      enemies: [{ key: 'test', pos: [9, 5.4] }],
      flags: { roomOperatorStats: 1.2, roomEnemyHp: 1.5, ...(stronger ? { roomEnemyAtk: 1.6, roomEnemyDef: 1.25 } : {}) } });
    h.battle.start();
    const u = h.unit('tank');
    assert.equal(u.s.maxHp, 2400); assert.equal(u.s.def, 600);
    h.run(5);
    h.invariants();
    return { alive: u.alive, hp: u.hp };
  };
  assert.equal(fight(false).alive, true, 'the former rules let an unsupported tank survive');
  assert.equal(fight(true).alive, false, 'the new enemy pressure defeats that same unsupported tank');
});
