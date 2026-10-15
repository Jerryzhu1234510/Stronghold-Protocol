import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { SharedPool } from '../../server/match/pool.js';
import { DataSource } from '../../server/sim/simdata.js';
import { withUnitLoadouts } from '../../server/sim/spec.js';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { loadoutOptions } from '../../shared/protocol.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const D = getData({ log: { warn() {}, error() {}, info() {} } });
const BASE = 'chess_char_4_27_a', ELITE = 'chess_char_4_27_b';
const BONDS = ['egirShip', 'swiftShip', 'indomShip'];
const bs = (active) => ({ count: active ? 3 : 1, active, tier: active ? 1 : 0, layers: 0 });
function field({ elite = false, active = BONDS, kind = 'normal', flags = {}, deploy = true } = {}) {
  const friend = chessRec({ id: 'friend', stats: { atk: 0 }, skill: null });
  const bonds = Object.fromEntries([...BONDS, 'yanShip', 'raidShip'].map(id => [id, bs(active.includes(id))]));
  const h = makeBattle({ kind, autoFinish: false, timeLimit: 400, bonds,
    flags: { layerGainsEnabled: true, dpPerSec: 0, ...flags },
    defs: { chess: { friend }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000000, atk: 0, speed: 0 }) } },
    units: [{ uid: 1, chessId: elite ? ELITE : BASE, row: 10, col: 5 },
      { uid: 2, chessId: 'friend', row: 11, col: 3 }],
  });
  if (deploy) h.step();
  return { h, u: h.unit(1), friend: h.unit(2) };
}
const gains = h => h.result().perPlayer.p1.layerGains;
const kill = (h, killer) => h.b.kill(h.spawn('dummy', { pos: [12, 8] }), killer);
const finish = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };

test('Clementia is a visible five-tier shop piece, normal merges into elite, with three selectable skills and all bond rosters', () => {
  const a = D.chess[BASE], b = D.chess[ELITE];
  for (const c of [a, b]) {
    assert.equal(c.charId, 'char_4231_clemnt'); assert.equal(c.nationId, 'egir');
    assert.equal(c.tier, 5); assert.equal(c.price, 4); assert.equal(c.visible, true); assert.equal(c.isDiy, false);
    assert.deepEqual(c.bonds, BONDS); assert.equal(c.skills.length, 3);
    assert.match(D.garrisons[c.garrisonIds[0]].desc, /联防不生效/);
  }
  assert.equal(a.upgradeNum, 3); assert.equal(a.upgradeChessId, ELITE);
  assert.equal(b.baseId, BASE); assert.equal(b.isGolden, true);
  assert.deepEqual(loadoutOptions(a, b).skills, [0, 1, 2]);
  for (const id of BONDS) { assert.ok(D.bonds[id].members.includes(BASE)); assert.ok(D.bonds[id].visibleMembers.includes(BASE)); }
  for (const field of ['members', 'visibleMembers']) assert.ok(!D.bonds.raidShip[field].includes(BASE));
  const gd = new GameData(D, 'mode_multi_normal'), pool = new SharedPool(gd);
  assert.ok(pool.has(BASE)); assert.ok(!pool.has(ELITE));
  assert.equal(pool.entries.get(BASE).cap, gd.economy.poolCopies[5]);
  assert.equal(pool.roll(() => .5, { maxTier: 4, filter: id => id === BASE }), null);
  assert.equal(pool.roll(() => .5, { maxTier: 5, filter: id => id === BASE }), BASE);
});

test('Clementia contributes to each real prep-side bond count; a single member does not activate them', () => {
  const gd = new GameData(D, 'mode_multi_normal');
  const ps = { board: new Map([[1, { kind: 'chess', id: BASE, items: [] }]]), hand: [], layers: {} };
  const bonds = computeBonds(gd, ps);
  for (const id of BONDS) { assert.equal(bonds[id].count, 1); assert.equal(bonds[id].active, false); }
});

test('every native normal / elite skill selection resolves to the existing handwritten Clementia battle logic', () => {
  for (const chessId of [BASE, ELITE]) for (const skillIndex of [0, 1, 2]) {
    const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
      units: [{ uid: 1, chessId, row: 10, col: 5, skillIndex }] }];
    const h = makeBattle({ players, data: withUnitLoadouts(new DataSource(D, null), players), autoFinish: false });
    h.step(); const u = h.unit(chessId);
    assert.equal(u.kit.skillSource, 'skills'); assert.ok(!u.kit.generic);
    assert.equal(u.skill.id, `skchr_clemnt_${skillIndex + 1}`);
    finish(h);
  }
});

test('normal shared allied kills trigger every three; elite every two; each of the three active bonds gains one', () => {
  for (const elite of [false, true]) {
    const { h, u, friend } = field({ elite }), n = elite ? 2 : 3;
    for (let i = 0; i < n - 1; i++) kill(h, friend);
    for (const id of BONDS) assert.equal(gains(h)[id] ?? 0, 0);
    kill(h, u);
    for (const id of BONDS) assert.equal(gains(h)[id], 1);
    for (let i = 0; i < n; i++) kill(h, i % 2 ? u : friend);
    for (const id of BONDS) assert.equal(gains(h)[id], 2);
    finish(h);
  }
});

test('each activation combination filters gains independently; unrelated active bonds never receive layers', () => {
  for (let mask = 0; mask < 8; mask++) {
    const active = BONDS.filter((_, i) => mask & (1 << i));
    const { h, friend } = field({ active: [...active, 'yanShip', 'raidShip'] });
    for (let i = 0; i < 3; i++) kill(h, friend);
    for (const id of BONDS) assert.equal(gains(h)[id] ?? 0, active.includes(id) ? 1 : 0, `${mask}: ${id}`);
    assert.equal(gains(h).yanShip ?? 0, 0); assert.equal(gains(h).raidShip ?? 0, 0); finish(h);
  }
});

test('no retroactive gain from kills while bonds were inactive; future threshold checks the current active state', () => {
  const { h, friend } = field({ active: [] });
  for (let i = 0; i < 3; i++) kill(h, friend);
  Object.assign(h.b.getPlayer('p1').bonds.egirShip, bs(true));
  for (let i = 0; i < 2; i++) kill(h, friend);
  assert.equal(gains(h).egirShip ?? 0, 0);
  kill(h, friend); assert.equal(gains(h).egirShip, 1); finish(h);
});

test('all friendly units includes a real summon; enemy kills, friendly victims and environmental deaths do not count', () => {
  const { h, u, friend } = field();
  const token = h.b.spawnToken(friend, 'token_10000_silent_healrb', 11, 4);
  assert.ok(token); assert.equal(token.side, 'ally'); assert.equal(token.kind, 'token');
  for (let i = 0; i < 2; i++) kill(h, token);
  kill(h, null);
  const enemy = h.spawn('dummy', { pos: [12, 8] }); kill(h, enemy);
  h.b.kill(friend, u);
  for (const id of BONDS) assert.equal(gains(h)[id] ?? 0, 0);
  kill(h, token);
  for (const id of BONDS) assert.equal(gains(h)[id], 1);
  finish(h);
});

test('kills before deployment, while hidden or after retirement do not advance the holder counter', () => {
  const { h, u, friend } = field({ deploy: false });
  for (let i = 0; i < 8; i++) kill(h, friend);
  h.step();
  h.b._setHidden(u, true);
  for (let i = 0; i < 8; i++) kill(h, friend);
  h.b._setHidden(u, false);
  for (let i = 0; i < 2; i++) kill(h, friend);
  for (const id of BONDS) assert.equal(gains(h)[id] ?? 0, 0);
  kill(h, friend);
  for (const id of BONDS) assert.equal(gains(h)[id], 1);
  h.b.retreat(u, { permanent: true });
  for (let i = 0; i < 8; i++) kill(h, friend);
  for (const id of BONDS) assert.equal(gains(h)[id], 1);
  finish(h);
});

test('联防 never triggers, even when the harness explicitly enables layer gains; engine-disabled gains stay disabled too', () => {
  for (const opts of [{ kind: 'unite' }, { flags: { layerGainsEnabled: false } }]) {
    for (const elite of [false, true]) {
      const { h, friend } = field({ ...opts, elite });
      for (let i = 0; i < 12; i++) kill(h, friend);
      for (const id of BONDS) assert.equal(gains(h)[id] ?? 0, 0);
      finish(h);
    }
  }
});

test('independent battles reset the kill progress', () => {
  for (let pass = 0; pass < 2; pass++) {
    const { h, friend } = field();
    for (let i = 0; i < 2; i++) kill(h, friend);
    for (const id of BONDS) assert.equal(gains(h)[id] ?? 0, 0);
    finish(h);
  }
});
