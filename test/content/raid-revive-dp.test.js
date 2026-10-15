import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const raid = { active: true, tier: 1, count: 2, layers: 10 };
const indom = { active: true, tier: 2, count: 3, layers: 300 };
const members = ['1_18', '2_09', '3_05', '3_12', '4_04', '4_16', '5_07', '6_15', '6_17'];
const cases = members.map(member => ({ member, skillIndex: undefined })).concat(
  [0, 2].map(skillIndex => ({ member: '4_04', skillIndex })),
);

for (const stageId of ['flat', 'act1autochess_m01']) for (const form of ['a', 'b']) for (const { member, skillIndex } of cases) {
  test(`raid resumes after paid revival: ${stageId} ${member}_${form} skill ${skillIndex ?? 'default'}`, () => {
    const h = makeBattle({ stageId, autoFinish: false, timeLimit: 180,
      flags: { dpInit: 99, dpPerSec: 0, dpMax: 999 },
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0 }) } },
      units: [{ chessId: `chess_char_${member}_${form}`, row: 12, col: 3, dir: 'RIGHT', skillIndex }],
      enemies: [{ key: 'dummy', pos: [9, 8] }], bonds: { raidShip: raid },
    });
    h.step();
    const u = h.allies()[0], e = h.enemies()[0];
    assert.ok(h.runUntil(() => u.tileC !== u.homeC, 12), 'first raid');
    h.b.kill(u);
    assert.equal(u.alive, false);
    const cost = u.base.cost;
    h.b.getPlayer('p1').dp = 99;
    let paidAtDeploy = null;
    h.b.on('deploy', ({ unit }) => { if (unit === u && paidAtDeploy === null) paidAtDeploy = h.b.getPlayer('p1').dp; }, { priority: 100 });
    assert.ok(h.runUntil(() => u.alive, 100), 'normal respawn');
    assert.equal(paidAtDeploy, 99 - cost, 'full deployment cost, not half');
    const seq = u.deploySeq;
    e.x = u.tileC < 6 ? 9 : 3; e.y = 10;
    h.b._enemyIndexTick = -1;
    assert.ok(h.runUntil(() => u.deploySeq !== seq, 0.5), 'raid resumes on the first poll after revival, without another idle wait');
    assert.equal(u.dir, 'RIGHT');
    assert.equal(h.b.errorCount, 0);
    checkInvariants(h.b);
  });
}

for (const form of ['a', 'b']) test(`Ines S2 raid and immediate indom revival do not spend DP: ${form}`, () => {
  const h = makeBattle({ autoFinish: false, timeLimit: 120,
    flags: { dpInit: 80, dpPerSec: 0, dpMax: 999 },
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0 }) } },
    units: [{ chessId: `chess_char_4_04_${form}`, row: 12, col: 3, skillIndex: 1 }],
    enemies: [{ key: 'dummy', pos: [9, 8] }], bonds: { raidShip: raid, indomShip: indom },
  });
  h.step();
  const u = h.allies()[0], e = h.enemies()[0], ps = h.b.getPlayer('p1');
  const dpAtDeploy = [];
  h.b.on('deploy', ({ unit }) => { if (unit === u) dpAtDeploy.push(ps.dp); }, { priority: 100 });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => dpAtDeploy.length > 0, 2));
  assert.equal(dpAtDeploy[0], 80, 'raid does not halve the DP pool');
  const dp = ps.dp;
  h.b.kill(u);
  assert.ok(u.alive && u.deployed, 'guaranteed indom revival');
  assert.equal(ps.dp, dp, 'no spend/refund cycle on immediate revival');
  assert.equal(dpAtDeploy.at(-1), dp);
  const seq = u.deploySeq;
  e.x = u.tileC < 6 ? 9 : 3; e.y = 10;
  h.b._enemyIndexTick = -1;
  assert.ok(h.runUntil(() => u.deploySeq !== seq, 12), 'raid resumes after indom revival');
  assert.equal(h.b.errorCount, 0);
  checkInvariants(h.b);
});

function revivedGuard(extra = {}) {
  const h = makeBattle({ autoFinish: false, timeLimit: 60,
    flags: { dpInit: 99, dpPerSec: 0 },
    defs: { chess: { guard: chessRec({ id: 'guard', bonds: ['raidShip'], skill: null, stats: { respawnTime: 4 } }) },
      enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0 }) } },
    units: [{ chessId: 'guard', row: 12, col: 3 }],
    enemies: [{ key: 'dummy', pos: [9, 8] }], bonds: { raidShip: raid }, ...extra,
  });
  h.step();
  const u = h.allies()[0], e = h.enemies()[0];
  h.b.kill(u);
  assert.ok(h.runUntil(() => u.alive, 5));
  return { h, u, e };
}

test('normal revival retries even before the operator has ever raided', () => {
  const { h, u } = revivedGuard();
  const seq = u.deploySeq;
  assert.ok(h.runUntil(() => u.deploySeq !== seq, 0.5));
  assert.notEqual(u.tileC, u.homeC);
});

test('revival retry does not abandon an enemy already in attack range', () => {
  const { h, u, e } = revivedGuard();
  const seq = u.deploySeq;
  e.x = u.tileC + 1; e.y = u.tileR;
  h.b._enemyIndexTick = -1;
  h.run(0.5);
  assert.equal(u.deploySeq, seq);
  assert.equal(u.mem['bond:raidShip:resume'], undefined);
  e.x = 8; e.y = 9; h.b._enemyIndexTick = -1;
  h.run(1);
  assert.equal(u.deploySeq, seq, 'the consumed revival retry cannot cause another immediate jump');
});

test('revival retry never lands on occupied tiles and resumes once a legal tile opens', () => {
  const { h, u } = revivedGuard();
  const seq = u.deploySeq;
  const reserved = h.b.isReservedTile.bind(h.b);
  h.b.isReservedTile = () => true;
  h.run(0.5);
  assert.equal(u.deploySeq, seq);
  assert.equal(u.alive, true, 'no retreat when there is no legal landing');
  h.b.isReservedTile = reserved;
  assert.ok(h.runUntil(() => u.deploySeq !== seq, 0.5));
  checkInvariants(h.b);
});

test('revival prioritizes a reachable enemy near the blue gate over a trailing enemy already in range', () => {
  const { h, u, e } = revivedGuard();
  e.x = u.tileC + 1; e.y = u.tileR;
  const leading = h.b.spawnEnemy('dummy', { pos: [9, 7], ownerPlayerId: 'p1', route: { start: [9, 7], end: [9, 10], checkpoints: [] } });
  // Keep the far enemy's native route long while the leading enemy is three tiles from its gate.
  assert.ok(h.b.remainingDistance(leading) < h.b.remainingDistance(e));
  h.b._enemyIndexTick = -1;
  h.step();
  assert.ok(h.b.enemiesInKeys(u.rangeKeys, u, u.profile).includes(e));
  const seq = u.deploySeq;
  assert.ok(h.runUntil(() => u.deploySeq !== seq, 0.5));
  assert.ok(h.b.enemiesInKeys(u.rangeKeys, u, u.profile).includes(leading));
  assert.equal(u.mem['bond:raidShip:resume'], undefined);
  checkInvariants(h.b);
});

test('revival retry does not bypass the repeat-raid cooldown or alter initial deployment', () => {
  const { h, u, e } = revivedGuard();
  const seq = u.deploySeq;
  u.mem['bond:raidShip'] = h.b.time;
  h.run(0.5);
  assert.equal(u.deploySeq, seq);
  assert.ok(h.runUntil(() => u.deploySeq !== seq, 3));
  e.x = u.tileC < 6 ? 9 : 3; e.y = 10; h.b._enemyIndexTick = -1;
  const landed = u.deploySeq;
  h.run(0.5);
  assert.equal(u.deploySeq, landed, 'revival retry is consumed by one raid');
  const fresh = makeBattle({ autoFinish: false,
    units: [{ chessId: 'chess_char_4_04_a', row: 12, col: 3 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0 }) } },
    enemies: [{ key: 'dummy', pos: [9, 8] }], bonds: { raidShip: raid },
  });
  fresh.step(); const initial = fresh.allies()[0].deploySeq;
  fresh.run(0.5);
  assert.equal(fresh.allies()[0].deploySeq, initial, 'unchanged initial idle/SP condition');
});
