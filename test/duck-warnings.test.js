import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duckReinforcements, activeDuckWarnings } from '../shared/duckWarnings.js';
import { getData } from '../server/data.js';
import { Battle } from '../server/sim/Battle.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';

const data = getData();
const pair = ['enemy_1513_dekght_2', 'enemy_1513_dekght'].map(enemyKey => ({
  enemyKey, time: 20, routeIndex: 0, tag: 'duck-enhanced', ownerPlayerId: 'p1', bounty: { coins: 3 },
}));
const routes = [{ motion: 'WALK', start: [10, 10], end: [10, 2] }];

test('knight pair forms one warning with accurate individual bounties and one shared mechanic', () => {
  const original = JSON.stringify(pair);
  const groups = duckReinforcements(pair, routes, key => data.enemies[key].name);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tile, [10, 10]);
  assert.equal(groups[0].time, 20);
  assert.deepEqual(groups[0].enemies.map(e => e.coins), [3, 3]);
  assert.equal(new Set(groups[0].enemies.map(e => e.hint)).size, 1);
  assert.equal(JSON.stringify(pair), original);
  assert.equal(duckReinforcements([...pair, { ...pair[0], ownerPlayerId: 'p2' }], routes).length, 2);
  assert.equal(duckReinforcements([{ ...pair[0], tag: 'boss' }], routes).length, 0);
});

test('prewarning uses battle time, closes after arrival and skips stale catch-up without a wall timer', () => {
  const groups = duckReinforcements(pair, routes);
  assert.equal(activeDuckWarnings(groups, 14.99).length, 0);
  assert.equal(activeDuckWarnings(groups, 15)[0].remaining, 5);
  assert.equal(activeDuckWarnings(groups, 19.5)[0].remaining, 1);
  assert.equal(activeDuckWarnings(groups, 20)[0].arrived, true);
  assert.equal(activeDuckWarnings(groups, 23.75).length, 1);
  assert.equal(activeDuckWarnings(groups, 24).length, 0);
  assert.equal(activeDuckWarnings(groups, 60).length, 0);
  assert.deepEqual(activeDuckWarnings(groups, 16), activeDuckWarnings(groups, 16), 'pause is stable');
  assert.equal(activeDuckWarnings(groups, NaN).length, 0);
});

test('scheduled metadata is bounded and tolerates missing routes or invalid spawn data', () => {
  assert.deepEqual(duckReinforcements(null), []);
  const inputs = [null, {}, { ...pair[0], time: Infinity }, { ...pair[0], enemyKey: 'nope' }];
  assert.deepEqual(duckReinforcements(inputs), []);
  const many = Array.from({ length: 500 }, (_, i) => ({ ...pair[0], ownerPlayerId: String(i) }));
  assert.equal(duckReinforcements(many).length, 16);
  assert.equal(duckReinforcements(pair)[0].tile, null);
  assert.equal(duckReinforcements([{ ...pair[0], bounty: undefined, mods: { bountyCoins: 3 } }])[0].enemies[0].coins, 3);
});

test('real sim and browser-spec reconstruction expose equal warnings without changing battle results', () => {
  const opts = { data, stageId: 'act1autochess_m01', fieldId: 'n:p1', kind: 'normal', round: 11,
    players: [], spawns: pair, routes, content: 'none', autoFinish: false, timeLimit: 40 };
  const a = new Battle(opts), b = new Battle(opts);
  const c = createBattleFromSpec(buildBattleSpec(opts), data, { content: 'none' });
  assert.deepEqual(a.fieldMeta().reinforcements, c.fieldMeta().reinforcements);
  for (let i = 0; i < 780; i++) {
    a.step(); b.step();
    if (i % 3 === 0) a.fieldMeta();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.result(), b.result());
  assert.ok(a.fieldMeta().warningTime >= 24);
  assert.deepEqual(activeDuckWarnings(a.fieldMeta().reinforcements, a.fieldMeta().warningTime), []);
  const ordinary = new Battle({ ...opts, spawns: [] });
  assert.equal(ordinary.fieldMeta().reinforcements, undefined, 'normal matches get no additional payload');
});
