import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, legalTileFor, chessOfTier, checkInvariants } from './harness.js';
import { planUnite, uniteBattleOpts, uniteTimeLimit } from '../../server/match/unite.js';
import { TRIO_UNITE_RECT, trioUniteStage } from '../../shared/uniteLayout.js';
import { Battle } from '../../server/sim/Battle.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { PHASE } from '../../shared/constants.js';
import { cameraLayers, layerCamera, sidesOf } from '../../public/js/battle/observe.js';
import { playerLayer, bondOwnerId } from '../../public/js/ui/watchBonds.js';
import { boardArea, bandFor, fieldRows } from '../../public/js/render/app.js';
import { buildBoard } from '../../public/js/render/board3d/layout.js';

function uniteScenario(capacity, clientCombat = false, perfectCount = 4) {
  const h = makeMatch({ capacity, humans: capacity, fake: true, clientCombat, clients: false, instant: false }).start();
  h.toPrep(1); const m = h.m;
  m.wave.timeLimit = 60;
  const id = chessOfTier(1, c => c.position === 'MELEE').find(id => m.pool.has(id));
  for (const ps of m.order.slice(0, perfectCount)) give(m, ps, id, 'board', legalTileFor(m, ps, id));
  const enemyKey = Object.keys(DATA.enemies).find(k => DATA.enemies[k].motion !== 'FLY');
  m.lastResults = new Map(m.order.map((ps, i) => [ps.playerId, {
    perfect: i < perfectCount, leaked: i < perfectCount ? [] : [{ enemyKey, counted: true, lpr: 1 }],
    unitsEnd: ps.allChess().map(p => ({ uid: p.uid, alive: true, hpPct: .4, sp: 12 })),
  }]));
  return { h, m, plan: planUnite(m, m.lastResults) };
}

for (const capacity of [4, 5, 6, 7, 8]) for (const clientCombat of [false, true]) {
  test(`${capacity} seats / ${clientCombat ? 'client' : 'server'}: helpers, field and both countdown/simulation limits follow room capacity`, () => {
    const { h, m, plan } = uniteScenario(capacity, clientCombat, Math.min(4, capacity - 1));
    const helpers = capacity >= 7 ? 3 : 2;
    assert.equal(plan.helpers.length, helpers);
    assert.equal(uniteTimeLimit(m, 60), capacity >= 7 ? 105.6 : capacity === 4 ? 60 : 66);
    m.startUnite(plan);
    assert.equal(m.phase, PHASE.UNITE);
    assert.equal(m.deadline - h.sched.now(), (capacity >= 7 ? 105.6 : capacity === 4 ? 60 : 66) / m.gameSpeed * 1000);
    const field = m.fields[0], opts = clientCombat ? field.spec : field.battle.opts;
    assert.equal(opts.timeLimit, capacity >= 7 ? 105.6 : capacity === 4 ? 60 : 66);
    assert.equal(opts.players.length, helpers);
    assert.deepEqual(opts.players.map(p => [p.rowOffset ?? 0, p.colOffset]), helpers === 3 ? [[0, 8], [0, 0], [-7, 8]] : [[0, 8], [0, 0]]);
    assert.equal(opts.rect.r0, helpers === 3 ? 1 : 9);
    m.dispose();
  });
}

test('large room with only one or two perfect players never recruits a leaker or eliminated player', () => {
  for (const n of [1, 2]) {
    const { m, plan } = uniteScenario(8, false, n);
    assert.equal(plan.helpers.length, n); assert.ok(plan.helpers.every(p => m.lastResults.get(p.playerId).perfect));
    assert.equal(uniteTimeLimit(m, 60), 105.6); m.dispose();
  }
});

test('three independent boards carry units’ HP/SP and can deploy in server and browser replicas without tile collisions', () => {
  const { m, plan } = uniteScenario(8);
  const opts = m._uniteOpts(plan, 96);
  const b = new Battle({ ...opts, data: m.ds, content: 'full', logger: { warn() {}, error() {} } });
  const spec = buildBattleSpec({ ...opts, battleId: 'trio-review' });
  const replica = createBattleFromSpec(spec, new DataSource(DATA));
  const owned = new Set(opts.players.flatMap(p => p.units.map(u => u.uid)));
  for (const battle of [b, replica]) {
    for (let i = 0; i < 100; i++) battle.step();
    const allies = battle.allyUnits.filter(u => owned.has(u.uid));
    assert.equal(allies.length, 3);
    assert.equal(new Set(allies.map(u => `${u.homeR},${u.homeC}`)).size, 3);
    assert.ok(allies.every(u => battle.grid.canStand(u.homeR, u.homeC)));
    assert.ok(allies.some(u => u.homeR <= 5));
    assert.deepEqual(battle.fieldMeta().sides, { p_0: 'R', p_1: 'L', p_2: 'T' });
    assert.equal(battle.errorCount, 0);
  }
  assert.deepEqual(b.snapshot(), replica.snapshot());
  assert.deepEqual(m._uniteOpts(plan, 96).rect, TRIO_UNITE_RECT);
  const original = JSON.stringify(DATA.stages[m.stageId]);
  const st = trioUniteStage(DATA.stages[m.stageId]);
  assert.equal(JSON.stringify(DATA.stages[m.stageId]), original, 'never mutate the normal/boss stage');
  assert.equal(trioUniteStage(st), st, 'do not copy again');
  m.dispose();
});

test('camera, observing a teammate, and bond strip include the third board', () => {
  const field = { fieldId: 'u', kind: 'unite', rect: TRIO_UNITE_RECT, players: ['a', 'b', 'c'] };
  const pub = { players: ['a', 'b', 'c', 'd'].map(playerId => ({ playerId, name: playerId })), fields: [field] };
  assert.deepEqual(sidesOf(field), { a: 'R', b: 'L', c: 'T' });
  assert.deepEqual(cameraLayers(field, pub, 'a').map(x => x.key), ['T', 'L', 'ALL', 'R']);
  assert.equal(playerLayer(field, pub, 'd', 'a'), 'R');
  assert.equal(bondOwnerId({ pub, myId: 'd', fieldId: 'u', field, layer: 'T', halves: true }), 'c');
  assert.ok(layerCamera(field, 'T').rect.r1 <= 6);
  assert.ok(layerCamera(field, 'R').rect.r0 >= 9);
  assert.deepEqual(layerCamera(field, 'ALL').rect, TRIO_UNITE_RECT);
});

test('all active stage layouts draw the upper board in 2D/3D and preserve normal-stage tile types', () => {
  for (const st of Object.values(DATA.stages).filter(s => s.active !== false)) {
    const trio = trioUniteStage(st);
    const board = buildBoard(trio, { area: boardArea('unite', TRIO_UNITE_RECT) });
    assert.ok(board.grid[3][11].drawn, st.id);
    assert.deepEqual(bandFor('unite', TRIO_UNITE_RECT), [0, 13]);
    assert.deepEqual(fieldRows('unite', TRIO_UNITE_RECT), [1, 13]);
    for (let r = 2; r <= 5; r++) for (let c = 10; c <= 18; c++) {
      if ((r === 2 || r === 5) && c === 18) assert.equal(trio.rows[r][c], r === 2 ? 'O' : 'U');
      else assert.equal(trio.rows[r][c], st.rows[r + 7][c - 8]);
    }
    assert.equal(trio.rows[9][2], 'I', 'pair exit is the portal entrance');
    assert.equal(trio.rows[2][10], 'E', 'third board is the only final exit');
    assert.ok([1, 7, 8].every(r => /^#+$/.test(trio.rows[r])), 'no long corridor or unused preview pads');
  }
});

test('ground and flying leaks traverse the third board and are charged to their source only once on every active stage', () => {
  const { m, plan } = uniteScenario(8), base = m._uniteOpts(plan, 180);
  const cases = [base.spawns.find(s => base.routes[s.routeIndex].motion === 'WALK')];
  const fly = 'enemy_1005_yokai';
  const flyingOpts = uniteBattleOpts(m, { ...plan, leaked: [{ enemyKey: fly, sourcePlayerId: 'p_4' }] }, 180);
  cases.push(flyingOpts.wave.spawns[0]);
  for (const st of Object.values(DATA.stages).filter(s => s.active !== false)) for (const [i, spawn] of cases.entries()) {
    assert.ok(spawn);
    const routes = i ? flyingOpts.wave.routes : base.routes;
    const b = new Battle({ ...base, stageId: st.id, players: base.players.map(p => ({ ...p, units: [], bonds: {}, playerEffects: [] })),
      routes, spawns: [{ ...spawn, time: 0, count: 1, interval: 0, mods: { speedMul: 4 } }], data: m.ds,
      logger: { warn() {}, error() {} } });
    const visited = [];
    let hiddenInPortal = false, teleported = false, previous = null;
    for (let tick = 0; tick < 5401 && !b.finished; tick++) {
      b.step();
      for (const e of b.enemies) {
        if (e.hidden && Math.abs(e.x - 2) < .1 && Math.abs(e.y - 9) < .1) hiddenInPortal = true;
        if (previous && previous.y >= 9 && e.y <= 5 && e.x >= 17) teleported = true;
        previous = { x: e.x, y: e.y };
        const r = Math.round(e.y), c = Math.round(e.x);
        const area = r >= 9 && r <= 12 ? c >= 10 ? 'R' : c <= 8 ? 'L' : null : r >= 2 && r <= 5 && c >= 10 && c <= 18 ? 'T' : null;
        if (area && !visited.includes(area)) visited.push(area);
        if (visited.length < 2) assert.ok(r >= 9, `${st.id}: do not take the connector before crossing the pair`);
      }
    }
    assert.deepEqual(visited, ['R', 'L', 'T'], `${st.id} / ${i ? 'fly' : 'ground'}: original connected pair first, third board last`);
    assert.ok(hiddenInPortal && teleported, `${st.id}: use disappearance/reappearance instead of walking a corridor`);
    const leaks = Object.values(b.result().perPlayer).flatMap(p => p.leaked);
    assert.equal(leaks.length, 1, `${st.id} / ${i ? 'fly' : 'ground'} must reach the final exit`);
    assert.equal(leaks[0].sourcePlayerId, 'p_4');
    assert.equal(b.errorCount, 0);
  }
  m.dispose();
});
