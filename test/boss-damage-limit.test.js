import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomExtensions } from '../shared/roomExtensions.js';
import { BOSS_HIT_LIMIT, GEO } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { getData } from '../server/data.js';
import { SharedBossPool } from '../server/match/finalAssault.js';
import { LocalBossPool, buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { GameData } from '../server/match/gamedata.js';
import { buildBossWave, setupMatchWaves } from '../server/match/waves.js';
import { createRng } from '../server/sim/rng.js';
import { abOf } from '../server/sim/content/enemies.js';
import { makeMatch } from './match/harness.js';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';

const DATA = getData();
const LIMIT = BOSS_HIT_LIMIT;
const PLAYER = { playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
  units: [], bonds: {}, playerEffects: [] };
const trueHit = amount => ({ amount, type: 'true', canDodge: false });

function field({ kind = 'boss', enabled, pool = null, tag = 'boss' } = {}) {
  const h = makeBattle({ kind, sharedBoss: pool, content: 'none', autoFinish: false,
    flags: enabled === undefined ? {} : { extensionBossNoDamageLimit: enabled },
    defs: {
      chess: { t_guard: chessRec({ id: 't_guard', stats: { atk: 0, maxHp: 1e9 }, skill: null }) },
      enemies: { enemy_lead: enemyRec({ key: 'enemy_lead', rank: 'BOSS', hp: 1e9, speed: 0 }) },
    },
    players: [{ ...PLAYER, units: [{ uid: 1, chessId: 't_guard', row: 10, col: 2 }] }],
    enemies: [{ key: 'enemy_lead', pos: kind === 'boss' || kind === 'hidden' ? [3, 9] : [10, 9], tag }],
  });
  h.step();
  return { h, b: h.b, leader: h.enemy('enemy_lead'), source: h.unit(1) };
}

test('Boss limit removal is strictly boolean, off by default and allowed in the existing room-setting envelope', () => {
  assert.equal(roomExtensions.defaults().bossNoDamageLimit, false);
  assert.equal(roomExtensions.normalize({}).bossNoDamageLimit, false);
  assert.equal(roomExtensions.normalize({ bossNoDamageLimit: true }).bossNoDamageLimit, true);
  for (const v of [1, 0, 'true', null, undefined, {}, []]) {
    assert.equal(roomExtensions.validate({ bossNoDamageLimit: v }), false);
  }
  assert.equal(validateC2S({ t: 'room.setExtensions', extensions: { bossNoDamageLimit: true } }), null);
});

test('default and false retain whole-hit cancellation at ceil(300000); true enables every HP damage kind and passed loss', () => {
  for (const kind of ['boss', 'hidden']) {
    for (const enabled of [undefined, false, 1, 'true']) {
      const { b, leader, source } = field({ kind, enabled });
      assert.equal(b.dealDamage(source, leader, trueHit(LIMIT - 1)), LIMIT - 1);
      assert.equal(b.dealDamage(source, leader, trueHit(LIMIT - 0.5)), 0);
      assert.equal(b.dealDamage(source, leader, trueHit(LIMIT)), 0);
      assert.equal(b.loseHp(leader, LIMIT, { source }), 0);
    }
    const { h, b, leader, source } = field({ kind, enabled: true });
    for (const type of ['phys', 'arts', 'true', 'elemental']) {
      assert.equal(b.dealDamage(source, leader, { amount: LIMIT, type, canDodge: false }), LIMIT, type);
    }
    assert.equal(b.dealDamage(source, leader, { ...trueHit(LIMIT * 2), tags: ['dot'], sourceless: true }), LIMIT * 2);
    assert.equal(b.loseHp(leader, LIMIT * 3, { source }), LIMIT * 3);
    assert.equal(h.eventsOf('fx').filter(e => e[1] === 'hitCap').length, 0);
    assert.equal(b.errorCount, 0);
  }
});

test('large hits credit shared/server and browser pools exactly once and stop at remaining HP', () => {
  for (const Pool of [SharedBossPool, LocalBossPool]) {
    const pool = new Pool(1e6);
    const { b, leader, source } = field({ enabled: true, pool });
    assert.equal(b.dealDamage(source, leader, trueHit(700000)), 700000);
    assert.equal(pool.hp, 300000);
    assert.equal(source.stats.dmg, 700000);
    assert.equal(b._pp('p1').bossDamage, 700000);
    assert.equal(Pool === SharedBossPool ? pool.byPlayer.get('p1') : pool.cum, 700000);
    assert.equal(b.dealDamage(source, leader, trueHit(1e9)), 300000, 'overkill does not inflate credit');
    assert.equal(pool.hp, 0);
    assert.equal(source.stats.dmg, 1e6);
    assert.equal(Pool === SharedBossPool ? pool.byPlayer.get('p1') : pool.cum, 1e6);
  }
});

test('removing the cap preserves mitigation, invulnerability, HP shields, hit barriers, hit-count and HP phase hooks', () => {
  const { b, leader, source } = field({ enabled: true });
  const initial = leader.hp;
  b.addBuff(leader, { key: 'test:invul', flags: { invulnerable: true } });
  assert.equal(b.dealDamage(source, leader, trueHit(1e8)), 0);
  assert.equal(leader.hp, initial);
  b.removeBuff(leader, 'test:invul');
  b.addBuff(leader, { key: 'test:shield', shield: 100000 });
  assert.equal(b.dealDamage(source, leader, trueHit(400000)), 300000);
  assert.equal(leader.findBuff('test:shield'), null);
  b.addBuff(leader, { key: 'test:barrier', shieldHits: 1 });
  assert.equal(b.dealDamage(source, leader, trueHit(1e8)), 0);
  assert.equal(leader.findBuff('test:barrier'), null);
  b.addBuff(leader, { key: 'test:resist', mods: { resFlat: 50 } });
  assert.equal(b.dealDamage(source, leader, { amount: 800000, type: 'arts', canDodge: false }), 400000);
  b.removeBuff(leader, 'test:resist');
  b.addBuff(leader, { key: 'test:hits', flags: { hitCount: true } });
  assert.equal(b.dealDamage(source, leader, trueHit(1e8)), 1);
  b.removeBuff(leader, 'test:hits');
  let phases = 0;
  b.on('hpDamage', ctx => { if (ctx.target === leader) { phases++; ctx.amount = Math.min(ctx.amount, 123); } });
  assert.equal(b.dealDamage(source, leader, trueHit(1e8)), 123);
  assert.equal(phases, 1);
  assert.equal(b.errorCount, 0);
});

test('room option wins over supplied flags and survives 96x pool scaling, JSON specs and browser replicas', () => {
  const off = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, fake: true });
  const on = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, fake: true,
    extensions: { bossNoDamageLimit: true, bossHp: 96, duckEnhanced: 2 } });
  try {
    assert.equal(off.m.roomBattleFlags({ extensionBossNoDamageLimit: true }).extensionBossNoDamageLimit, false);
    assert.equal(on.m.roomBattleFlags({ extensionBossNoDamageLimit: false }).extensionBossNoDamageLimit, true);
    for (const h of [off, on]) { h.m.bossId = 'boss_1'; h.m.startFinalAssault(false); }
    assert.equal(on.m.bossPool.maxHp, off.m.bossPool.maxHp * 96);
    const spec = buildBattleSpec({ kind: 'boss', stageId: 'act2autochess_m01', rect: { ...GEO.BOSS_RECT },
      players: [PLAYER], spawns: [], flags: on.m.roomBattleFlags({}), content: 'none',
      boss: { poolHp: on.m.bossPool.maxHp, poolMax: on.m.bossPool.maxHp } });
    assert.equal(spec.flags.extensionBossNoDamageLimit, true);
    const replica = createBattleFromSpec(JSON.parse(JSON.stringify(spec)), DATA, { content: 'none' });
    replica.start();
    const enemy = replica.spawnEnemy('enemy_9013_acstmk', { tag: 'boss', pos: [3, 9] });
    const before = enemy.bossPool.hp;
    assert.equal(replica.dealDamage(null, enemy, trueHit(LIMIT * 3)), LIMIT * 3);
    assert.equal(enemy.bossPool.hp, before - LIMIT * 3);
    assert.equal(replica.flags.extensionBossHp, 96);
  } finally { off.m.dispose(); on.m.dispose(); }
});

test('normal/unite Ducklord guests and other untagged leaders retain their original uncapped behavior', () => {
  for (const enabled of [false, true]) {
    for (const kind of ['normal', 'unite']) {
      const { b, leader, source } = field({ enabled, kind, tag: 'duck-enhanced' });
      assert.equal(b.dealDamage(source, leader, trueHit(LIMIT * 2)), LIMIT * 2);
      assert.equal(leader.isBoss, false, 'additional leaders do not acquire a shared-pool Boss tag');
    }
  }
});

test('real hidden Boss regeneration barrier still blocks one hit, then an uncapped hit reaches its pool', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const setup = setupMatchWaves(gd, createRng(3));
  const wave = buildBossWave(gd, createRng(1), setup.factions, 15, { bossId: 'boss_10', solo: false });
  const max = gd.boss('boss_10').bloodPoint.HARD * 96;
  const pool = new SharedBossPool(max);
  const spec = buildBattleSpec({ kind: 'hidden', seed: 5, round: 15, modeId: 'mode_multi_hard',
    stageId: 'act2autochess_m01', rect: { ...GEO.BOSS_RECT }, players: [PLAYER],
    spawns: wave.spawns.filter(s => s && gd.enemy(s.enemyKey)), routes: wave.routes,
    flags: { extensionBossNoDamageLimit: true, extensionBossHp: 96, ...gd.dp },
    enemyOverrides: wave.overrides, waveId: wave.templateId, bossId: 'boss_10', boss: { poolHp: max, poolMax: max } });
  const b = createBattleFromSpec(spec, DATA, { sharedBoss: pool, quiet: true });
  b.start();
  for (let i = 0; i < 900 && !b.enemies.some(e => e.alive && e.isBoss); i++) b.step();
  const boss = b.enemies.find(e => e.alive && e.isBoss);
  assert.ok(boss);
  abOf(b, boss).hitShield = 1;
  const before = pool.hp;
  const hit = { amount: 2e6, type: 'phys', defIgnorePct: 1, canDodge: false };
  assert.equal(b.dealDamage(null, boss, hit), 0);
  assert.equal(abOf(b, boss).hitShield, 0);
  assert.equal(pool.hp, before);
  assert.equal(b.dealDamage(null, boss, hit), 2e6);
  assert.equal(pool.hp, before - 2e6);
  assert.equal(b.errorCount, 0);
});
