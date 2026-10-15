import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomExtensions, createExtensionRegistry } from '../shared/roomExtensions.js';
import { validateC2S } from '../shared/protocol.js';
import { getData } from '../server/data.js';
import { Battle } from '../server/sim/Battle.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { DUCK_GUESTS, DUCK_GUESTS_TIER2, addDuckGuest } from '../server/match/roomExtensions.js';
import { makeMatch } from './match/harness.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

const data = getData();
test('extensions are opt-in, bounded, extensible and reject unknown/unsafe options', () => {
  assert.deepEqual(roomExtensions.defaults(), { bossHp: 1, enemyHp: 1, bossNoDamageLimit: false, duckEnhanced: 0 });
  for (const n of [0, 97, 1.5, Infinity, NaN, '96', null]) assert.equal(roomExtensions.validate({ bossHp: n }), false);
  assert.equal(roomExtensions.validate({ bossHp: 96, enemyHp: 96, duckEnhanced: true }), true);
  assert.equal(roomExtensions.validate({ duckEnhanced: 2 }), true);
  for (const v of [-1,3,1.5,'2',null]) assert.equal(roomExtensions.validate({duckEnhanced:v}),false);
  assert.equal(roomExtensions.normalize({duckEnhanced:true}).duckEnhanced,1);
  assert.equal(roomExtensions.normalize({duckEnhanced:false}).duckEnhanced,0);
  assert.equal(roomExtensions.validate({ unknownMod: true }), false);
  assert.ok(validateC2S({ t: 'room.setExtensions', extensions: { bossHp: Infinity } }));
  const mod = createExtensionRegistry([{ id: 'example.extra', type: 'boolean', default: false, label: 'Example' }]);
  assert.equal(mod.validate({ 'example.extra': true }), true);
  assert.throws(() => mod.register({ id: 'example.extra', type: 'boolean', default: true, label: 'Duplicate' }));
});

test('HP multipliers compose once and classify untagged leaders, ordinary enemies and later spawns', () => {
  const normal = Object.values(data.enemies).find(e => e.rank === 'NORMAL' && e.stats.maxHp > 1000);
  const opts = { data, stageId: 'act1autochess_m01', flags: { roomEnemyHp: 2, extensionBossHp: 96, extensionEnemyHp: 3 },
    spawns: [], players: [], content: 'none' };
  const b = new Battle(opts);
  const n = b.spawnEnemy(normal.key, { mods: { hpMul: 4 } });
  assert.equal(n.s.maxHp, normal.stats.maxHp * 2 * 3 * 4);
  const boss = b.spawnEnemy('enemy_1539_reid', {});
  assert.equal(boss.s.maxHp, data.enemies.enemy_1539_reid.stats.maxHp * 2 * 96);
  const later = b.spawnEnemy(normal.key, {});
  assert.equal(later.s.maxHp, normal.stats.maxHp * 2 * 3);
  const replica = createBattleFromSpec(buildBattleSpec({ ...opts, spawns: [], fieldId: 'n:p1' }), data, { content: 'none' });
  assert.equal(replica.spawnEnemy(normal.key, { mods: { hpMul: 4 } }).s.maxHp, n.s.maxHp);
});

test('shared final/hidden boss pools receive custom multiplier once, normal room scaling is retained', () => {
  for (const hidden of [false, true]) {
    const options = { mode: 'coop', difficulty: 'HARD', humans: 1, fake: true, seed: 11 };
    const a = makeMatch(options), b = makeMatch({ ...options, extensions: { bossHp: 96, enemyHp: 2 } });
    try {
      for (const h of [a, b]) { h.m.bossId = 'enemy_1539_reid'; h.m.hiddenBossId = 'enemy_1517_xi'; h.m.startFinalAssault(hidden); }
      assert.equal(b.m.bossPool.maxHp, a.m.bossPool.maxHp * 96);
      assert.equal(b.m.publicView().extensions.bossHp, 96);
      assert.equal(b.m.roomBattleFlags({}).extensionEnemyHp, 2);
    } finally { a.m.dispose(); b.m.dispose(); }
  }
});

const ctx = (seed, overrides = {}) => ({ seed, round: 11, playerId: 'p1', extensions: { duckEnhanced: true },
  bandId: () => 'band_ducklord', teammates: () => [], gd: { enemy: key => data.enemies[key] }, ...overrides });
const ev = () => ({ kind: 'normal', spawns: [{ enemyKey: 'enemy_1001_butcher', time: 20, routeIndex: 0, mods: { hpMul: 2 } }] });
test('Ducklord bonus is 60%, four equal choices, deterministic and disabled before R11', () => {
  const counts = Object.fromEntries(DUCK_GUESTS.map(g => [g.enemyKey, 0]));
  let spawned = 0;
  for (let seed = 1; seed <= 10000; seed++) {
    const a = ev(), b = ev(), guest = addDuckGuest(ctx(seed), a);
    assert.deepEqual(addDuckGuest(ctx(seed), b), guest);
    if (guest) { spawned++; counts[guest.enemyKey]++; assert.equal(guest.bounty.coins, DUCK_GUESTS.find(g => g.enemyKey === guest.enemyKey).coins); }
  }
  assert.ok(spawned > 5700 && spawned < 6300, String(spawned));
  for (const n of Object.values(counts)) assert.ok(n > 1300 && n < 1700, JSON.stringify(counts));
  for (const override of [{ round: 10 }, { extensions: { duckEnhanced: false } }, { bandId: () => 'other' }]) {
    const e = ev(); assert.equal(addDuckGuest(ctx(1, override), e), null); assert.equal(e.spawns.length, 1);
  }
});

function tier2Event(seed) {
  const c = ctx(seed, { extensions: { duckEnhanced: 2 } });
  const e = { kind: 'normal', routes: [{ motion: 'WALK', start: [10, 10], end: [10, 2] }],
    spawns: [{ enemyKey: 'enemy_1001_butcher', time: 0, routeIndex: 0, mods: { hpMul: 3, bountyCoins: 99, bountyId: 'old', slot: 1 } }] };
  addDuckGuest(c, e);
  return { c, e, added: e.spawns.filter(s => s.tag === 'duck-enhanced') };
}

test('tier 2 rolls 60%, picks tombstone or a complete knight pair equally, keeps original schedule immutable', () => {
  const counts = { none: 0, tombstone: 0, knights: 0 };
  for (let seed = 1; seed <= 10000; seed++) {
    const { c, e, added } = tier2Event(seed);
    if (!added.length) { counts.none++; continue; }
    counts[added.length === 1 ? 'tombstone' : 'knights']++;
    assert.deepEqual(added.map(s => s.enemyKey), DUCK_GUESTS_TIER2.find(g => g.length === added.length).map(g => g.enemyKey));
    for (const s of added) {
      assert.equal(s.mods.hpMul, 6); assert.equal(s.bounty.coins, added.length === 1 ? 5 : 3);
      assert.equal(s.time, 0); assert.equal(s.routeIndex, 0); assert.equal(s.ownerPlayerId, 'p1');
      assert.equal(s.mods.bountyCoins, undefined); assert.equal(s.mods.bountyId, undefined); assert.equal(s.mods.slot, undefined);
    }
    assert.equal(e.spawns[0].mods.hpMul, 3); assert.equal(e.spawns[0].mods.bountyCoins, 99);
    assert.deepEqual(tier2Event(seed).added, added);
    assert.equal(addDuckGuest(c, e), null);
  }
  assert.ok(counts.none > 3700 && counts.none < 4300, JSON.stringify(counts));
  assert.ok(counts.tombstone > 2700 && counts.tombstone < 3300, JSON.stringify(counts));
  assert.ok(counts.knights > 2700 && counts.knights < 3300, JSON.stringify(counts));
  const e = tier2Event(1).e; const before = e.spawns.length;
  assert.equal(addDuckGuest(ctx(1, { round: 10, extensions: { duckEnhanced: 2 } }), e), null);
  assert.equal(e.spawns.length, before);
});

test('tier 2 keeps real leader abilities, doubled HP composes once with room scaling, each knight pays 3 once', () => {
  for (const groupSize of [1, 2]) {
    let fixture;
    for (let seed = 1; seed < 100; seed++) { fixture = tier2Event(seed); if (fixture.added.length === groupSize) break; }
    assert.equal(fixture.added.length, groupSize);
    const opts = { data, stageId: 'act1autochess_m01', rect: { r0: 9, r1: 12, c0: 2, c1: 10 },
      spawns: fixture.added, routes: fixture.e.routes, flags: { roomEnemyHp: 2, extensionBossHp: 4, extensionEnemyHp: 96 },
      players: [{ playerId: 'p1', seat: 0, side: 'L', units: [], bonds: {} }], content: 'full', timeLimit: 60 };
    const b = new Battle(opts); b.start(); b.step();
    const units = b.enemies.filter(u => u.tag === 'duck-enhanced'); assert.equal(units.length, groupSize);
    for (const u of units) assert.equal(u.s.maxHp, data.enemies[u.defId].stats.maxHp * 3 * 2 * 2 * 4);
    const replica = createBattleFromSpec(buildBattleSpec(opts), data); replica.start(); replica.step();
    assert.deepEqual(replica.enemies.map(u => u.s.maxHp), units.map(u => u.s.maxHp));
    if (groupSize === 2) {
      b.kill(units[0]); assert.ok(units[1].findBuff('ab:rage'), 'surviving knight retains partner rage');
      assert.equal(b._pp('p1').coins, 3);
      b.kill(units[0]); assert.equal(b._pp('p1').coins, 3, 'duplicate death pays nothing');
      b.kill(units[1]); assert.equal(b._pp('p1').coins, 6);
    } else { b.kill(units[0]); assert.equal(b._pp('p1').coins, 5); }
    assert.equal(b.errorCount, 0);
  }
});

test('bonus supports teammate Ducklord and paired routes; never inserts twice in one field', () => {
  const c = ctx(1, { bandId: () => 'other', teammates: () => [{ bandId: () => 'band_ducklord' }] });
  let e;
  for (let seed = 1; seed < 100; seed++) {
    c.seed = seed; e = { kind: 'boss', side: 'R', routes: [{ end: [0, 0] }, { end: [0, 20] }],
      spawns: [{ time: 5, routeIndex: 0 }, { time: 10, routeIndex: 1 }] };
    if (addDuckGuest(c, e)) break;
  }
  assert.equal(e.spawns.at(-1).routeIndex, 1);
  assert.equal(addDuckGuest(c, e), null);
  assert.equal(e.spawns.filter(s => s.tag === 'duck-enhanced').length, 1);
  const bossOnly = { kind: 'boss', side: 'R', routes: e.routes, spawns: [] };
  assert.equal(addDuckGuest(c, bossOnly).routeIndex, 1);
});

test('new settings reach the real worker thread and are visible in its match snapshot', async () => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, matchWorkers: 1 });
  let c;
  try {
    c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); await c.hello('WorkerExt');
    assert.equal((await c.request({ t:'room.create', mode:'coop', difficulty:'NORMAL' })).t,'ok');
    assert.equal((await c.request({ t:'room.setExtensions', extensions:{ bossHp:96, enemyHp:96, bossNoDamageLimit:true, duckEnhanced:2 } })).t,'ok');
    assert.equal((await c.request({ t:'room.start' })).t,'ok');
    const pub = await c.waitFor('m.public');
    assert.deepEqual(pub.extensions,{bossHp:96,enemyHp:96,bossNoDamageLimit:true,duckEnhanced:2});
  } finally { await c?.terminate(); await srv.close(); }
});

test('actual normal-round pipeline sends the extra spawn and bounty to browser/server specs', () => {
  let checked = false;
  for (let seed = 1; seed < 10 && !checked; seed++) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, fake: true, seed,
      extensions: { duckEnhanced: true, bossHp: 2, enemyHp: 3 } });
    try {
      h.m.round = 11; h.m.order[0].bandId = 'band_ducklord';
      h.m.wave = { spawns: [{ enemyKey: 'enemy_1001_butcher', time: 10, count: 1 }], routes: [], timeLimit: 60 };
      const o = h.m._normalOpts(h.m.order[0]);
      const bonus = o.spawns.find(s => s.tag === 'duck-enhanced');
      if (bonus) {
        checked = true;
        assert.equal(bonus.mods.bountyCoins, bonus.bounty.coins);
        assert.equal(bonus.ownerPlayerId, h.m.order[0].playerId);
        const f = h.m._ccField({ fieldId: 'test', kind: 'normal', players: [h.m.order[0].playerId], opts: o });
        assert.equal(f.spec.flags.extensionBossHp, 2);
        assert.ok(f.spec.spawns.some(s => s.tag === 'duck-enhanced'));
        assert.equal(h.m.dispatcher.errors, 0);
      }
    } finally { h.m.dispose(); }
  }
  assert.ok(checked);
});

test('room extension ownership, readiness and post-start locking use the real WebSocket protocol', async () => {
  class ExtStub extends StubMatch { constructor(o) { super(o); this.extensions = o.extensions; } }
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, MatchClass: ExtStub });
  const clients = [];
  try {
    for (let i = 0; i < 2; i++) { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c); c.id = (await c.hello('Test' + i)).playerId; }
    const [a, b] = clients, req = (c, m) => c.request(m);
    await req(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const room = srv.lobby.roomOf(srv.registry.byId(a.id));
    await req(b, { t: 'room.join', code: room.code }); await req(b, { t: 'room.ready', ready: true });
    assert.equal((await req(b, { t: 'room.setExtensions', extensions: { bossHp: 96 } })).code, 'NOT_HOST');
    assert.equal((await req(b, { t: 'room.setExtensions', extensions: { bossNoDamageLimit: true } })).code, 'NOT_HOST');
    assert.equal((await req(a, { t: 'room.setExtensions', extensions: { bossHp: 97 } })).t, 'error');
    assert.equal((await req(a, { t: 'room.setExtensions', extensions: { bossNoDamageLimit: 1 } })).t, 'error');
    assert.equal((await req(a, { t: 'room.setExtensions', extensions: { arbitrary: true } })).t, 'error');
    assert.equal((await req(a, { t: 'room.setExtensions', extensions: { bossHp: 96, enemyHp: 96, bossNoDamageLimit: true, duckEnhanced: true } })).t, 'ok');
    assert.equal(room.seatOf(b.id).ready, false);
    assert.deepEqual(room.toState().extensions, { bossHp: 96, enemyHp: 96, bossNoDamageLimit: true, duckEnhanced: 1 });
    await req(b, { t: 'room.ready', ready: true }); await req(a, { t: 'room.start' });
    assert.equal(room.match.extensions.bossHp, 96);
    assert.equal(room.match.extensions.bossNoDamageLimit, true);
    assert.equal((await req(a, { t: 'room.setExtensions', extensions: { bossHp: 1 } })).code, 'ROOM_STARTED');
    assert.equal((await req(a, { t: 'room.setExtensions', extensions: { bossNoDamageLimit: false } })).code, 'ROOM_STARTED');
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});
