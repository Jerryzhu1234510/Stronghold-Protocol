import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssaultRoom } from '../../server/versus/assault.js';
import { VersusRoom } from '../../server/versus/engine.js';
import { MONSTERS, data } from '../../server/versus/catalog.js';
import { remainingDistance } from '../../server/sim/ai.js';
import { spawnChildren } from '../../server/sim/content/enemies/helpers.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const plane = MONSTERS.find(c => c.id === 'enemy_1005_yokai');
function setup(stageId) {
  const room = new AssaultRoom('TEST', { seed: 81, stageId, prepSeconds: 0, infoSeconds: 0 });
  for (let i = 0; i < 4; i++) room.join(`Player ${i}`);
  room.start(room.host);
  room.players.forEach(p => p.bot = false);
  room.tick();
  return room;
}

for (const stage of Object.values(data.stages).filter(s => s.active && s.weight > 0)) {
  test(`aircraft follow native ground routes on both defending halves: ${stage.id}`, () => {
    const room = setup(stage.id), d = room.duels[0];
    for (let leg = 1; leg <= 2; leg++) {
      const attack = d.pair.find(p => p.role === 'attack');
      const defend = d.pair.find(p => p.role === 'defend'), b = room.battleOf(defend);
      let tile;
      for (let row = 5; row >= 2 && !tile; row--) {
        for (const col of room.launchColumns(attack)) {
          if (b.grid.groundPassable(row, col)) { tile = { row, col }; break; }
        }
      }
      assert.ok(tile);
      attack.monsters[plane.id] = 1;
      room.action(attack, { action: 'launch', id: plane.id, ...tile });
      const e = b.aliveEnemies().find(e => e.sourcePlayerId === attack.id);
      assert.equal(e.motion, 'FLY');
      assert.equal(e.isFlying, true);
      assert.equal(e.route.groundPath, true);
      const goal = e.versusGoal;
      const expected = b.grid.waypoints(tile.row, tile.col, ...goal);
      assert.ok(expected.length > 2, 'route bends instead of flying straight into the gate');
      b.step(1 / 30);
      assert.deepEqual(e.route.pts, expected.slice(1).map(([y, x]) => ({ x, y })));
      assert.equal(e.blockedBy, null);
      const preview = VersusRoom.prototype.fieldViews.call(room, d.id)[attack.id].routes.find(r => r.id % 1000000 === e.id);
      assert.deepEqual(preview.cells, b.grid.findPath(Math.round(e.y), Math.round(e.x), ...goal));
      for (let i = 0; i < 4000 && e.alive; i++) {
        b.step(1 / 30);
        assert.ok(b.grid.walkable(Math.round(e.y), Math.round(e.x)), 'does not cut through terrain');
      }
      assert.equal(e.versusLeakCounted, true, 'can reach the blue gate through the ground route');
      assert.equal(defend.stats.leaks, 1);
      if (leg === 1) room.beginLeg(d);
    }
  });
}

test('spawned flying children inherit ground navigation without losing flight attributes', () => {
  const room = setup('act1autochess_m01'), d = room.duels[0];
  const defend = d.pair.find(p => p.role === 'defend'), attack = d.pair.find(p => p.role === 'attack');
  const b = room.battleOf(defend);
  const parent = b.spawnEnemy(plane.id, { pos: [5, 8], sourcePlayerId: attack.id,
    route: { start: [5, 8], end: [2, 2], checkpoints: [] } });
  const [child] = spawnChildren(b, parent, plane.id, 1);
  assert.equal(child.sourcePlayerId, attack.id);
  assert.equal(child.route.groundPath, true);
  assert.equal(child.motion, 'FLY');
  assert.equal(child.isFlying, true);
});

test('ground navigation also drives remaining-distance estimates; normal-mode flight is unchanged', () => {
  const h = makeBattle({ content: 'none', defs: { enemies: {
    walker: enemyRec({ key: 'walker' }), flyer: enemyRec({ key: 'flyer', motion: 'FLY' }),
  } } });
  h.b.grid.setObstacle(10, 6, true);
  h.b.grid.setObstacle(11, 6, true);
  h.b.grid.setObstacle(12, 6, true);
  const route = { start: [12, 10], end: [9, 2], checkpoints: [{ type: 'MOVE', pos: [12, 9] }] };
  const ground = h.spawn('walker', { route }), air = h.spawn('flyer', { route });
  const normal = h.spawn('flyer', { route });
  air.route.groundPath = true;
  assert.equal(remainingDistance(h.b, air), remainingDistance(h.b, ground));
  assert.ok(remainingDistance(h.b, air) > remainingDistance(h.b, normal));
  h.step(1);
  assert.deepEqual(air.route.pts, ground.route.pts);
  assert.deepEqual(normal.route.pts, [{ x: 9, y: 12 }]);
  assert.equal(normal.route.groundPath, undefined);
});
