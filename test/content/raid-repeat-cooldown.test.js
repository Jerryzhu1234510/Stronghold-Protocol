import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { AUTO_OP_COOLDOWN } from '../../server/sim/constants.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';

test('Utage deployment skill cannot reset the repeat-raid cooldown by redeploying', () => {
  const h = makeBattle({ autoFinish: false, timeLimit: 60,
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
    units: [{ chessId: 'chess_char_1_18_a', row: 12, col: 3 }],
    enemies: [{ key: 'dummy', pos: [9, 8] }],
    bonds: { raidShip: { active: true, tier: 1, count: 2, layers: 10 } },
  });
  h.step();
  const u = h.allies()[0];
  const times = [];
  h.b.on('deploy', ({ unit, initial }) => { if (unit === u && !initial) times.push(h.b.time); });
  assert.ok(h.runUntil(() => times.length === 1, 2));
  const e = h.enemies()[0];
  for (let jump = 1; jump <= 3; jump++) {
    // The next enemy is deliberately outside the new range, as with kills followed by another wave.
    e.x = u.tileC < 6 ? 9 : 3; e.y = 10;
    h.b._enemyIndexTick = -1;
    h.run(0.8);
    assert.equal(times.length, jump, 'the active deployment skill cannot hop again at every poll');
    assert.ok(h.runUntil(() => times.length === jump + 1, 4));
  }
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= AUTO_OP_COOLDOWN - 1e-9);
  checkInvariants(h.b);
});

for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) test(`Surtr raid preserves ${dir} and keeps its target in reach`, () => {
  const h = makeBattle({ autoFinish: false,
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
    units: [{ chessId: 'chess_char_5_07_a', row: 12, col: 3, dir }],
    enemies: [{ key: 'dummy', pos: [9, 8] }],
    bonds: { raidShip: { active: true, tier: 1, count: 2, layers: 10 } },
  });
  h.step();
  const u = h.allies()[0];
  const jumps=[];
  h.b.on('deploy', ({ unit, initial }) => { if (unit === u && !initial) jumps.push(u.dir); });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => jumps.length > 0, 5));
  assert.equal(u.dir, dir, 'automatic relocation must preserve the chosen direction');
  const event=h.eventsOf('deploy').filter(e=>e[1]===u.id).at(-1);
  assert.equal(event[2],u.dir, 'the renderer receives the direction chosen by the simulation');
  const e=h.enemies()[0];
  assert.ok(absoluteRangeKeys(u.rangeGrid,u.tileR,u.tileC,u.dir,u.s.rangeExtend).includes(Math.round(e.y)*21+Math.round(e.x)));
});
