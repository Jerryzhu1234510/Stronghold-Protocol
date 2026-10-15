import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { PHASE, roomBossHp } from '../../shared/constants.js';
import { cloneBandWinner } from '../../shared/cloneMode.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { BAND_TURN_SECONDS } from '../../server/match/Match.js';
import { attachAudit } from '../../server/match/audit.js';

function draft(h) {
  h.start();
  for (const ps of h.m.order) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
}

test('clone: concurrent repeated votes and revisions; last confirmation settles immediately', () => {
  const h = makeMatch({ humans: 8, capacity: 8, gameMode: 'clone', seed: 40 });
  try {
    draft(h);
    const m = h.m, deadline = m.deadline;
    assert.equal(m.draftTurn(), null);
    assert.equal(m.publicView().draft.simultaneous, true);
    for (let i = 0; i < 7; i++) assert.deepEqual(m.handle('p_' + i, { t: 'g.band', bandId: i < 5 ? 'band_ducklord' : 'band_lmlee' }), { ok: true });
    assert.equal(m.phase, PHASE.BAND_DRAFT, 'wait for the last vote');
    assert.equal(m.order.every(p => p.bandId == null), true);
    assert.deepEqual(m.handle('p_6', { t: 'g.band', bandId: 'band_ducklord' }), { ok: true });
    assert.equal(m.deadline, deadline, 'revision cannot restart clock');
    assert.equal(m.handle('p_0', { t: 'g.band', bandId: 'invalid' }).error, 'BAD_TARGET');
    assert.equal(m.handle('p_0', { t: 'g.bandSkip' }).error, 'WRONG_PHASE');
    assert.deepEqual(m.handle('p_7', { t: 'g.band', bandId: 'band_lmlee' }), { ok: true });
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    for (const ps of m.order) { assert.equal(ps.bandId, 'band_ducklord'); assert.equal(ps.lp, m.gd.startLp('band_ducklord')); }
    assert.equal(m.handle('p_0', { t: 'g.band', bandId: 'band_lmlee' }).error, 'WRONG_PHASE');
  } finally { h.m.dispose(); }
});

test('clone: incomplete votes settle at the deadline; completed tied votes settle immediately', () => {
  const h = makeMatch({ humans: 4, gameMode: 'clone' });
  try {
    draft(h);
    for (let i = 0; i < 3; i++) h.m.handle('p_' + i, { t: 'g.band', bandId: 'band_ducklord' });
    assert.equal(h.m.phase, PHASE.BAND_DRAFT);
    h.sched.advance(h.m.deadline - h.sched.now() + 1);
    assert.equal(h.m.phase, PHASE.BATTLE_CHECK);
    assert.ok(h.m.order.every(ps => ps.bandId === 'band_ducklord'));
  } finally { h.m.dispose(); }
  for (let seed = 1; seed <= 8; seed++) {
    const tied = makeMatch({ humans: 4, gameMode: 'clone', seed });
    try {
      draft(tied);
      for (let i = 0; i < 4; i++) tied.m.handle('p_' + i, { t: 'g.band', bandId: i < 2 ? 'band_ducklord' : 'band_lmlee' });
      assert.equal(tied.m.phase, PHASE.BATTLE_CHECK);
      assert.ok(['band_ducklord', 'band_lmlee'].includes(tied.ps('p_0').bandId));
      assert.ok(tied.m.order.every(ps => ps.bandId === tied.ps('p_0').bandId));
    } finally { tied.m.dispose(); }
  }
});

test('clone: bot votes count toward immediate finish and a departed unvoted seat cannot hold the draft', () => {
  const bots = makeMatch({ humans: 1, bots: 3, gameMode: 'clone' });
  try {
    draft(bots);
    assert.equal(Object.keys(bots.m.draft.votes).length, 3);
    assert.equal(bots.m.handle('p_0', { t: 'g.band', bandId: 'band_ducklord' }).ok, true);
    assert.equal(bots.m.phase, PHASE.BATTLE_CHECK);
  } finally { bots.m.dispose(); }
  const h = makeMatch({ humans: 4, gameMode: 'clone' });
  try {
    draft(h);
    for (let i = 0; i < 3; i++) h.m.handle('p_' + i, { t: 'g.band', bandId: 'band_ducklord' });
    h.m.onLeave('p_3');
    assert.equal(h.m.phase, PHASE.BATTLE_CHECK);
    assert.equal(h.ps('p_3').lp, 0);
    assert.equal(h.ps('p_3').alive, false);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('clone: ties draw only among highest votes; abstentions, invalid votes, three-way ties', () => {
  const allowed = ['a', 'b', 'c', 'd'];
  const eligible = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const votes = { p1: 'a', p2: 'b', p3: 'a', p4: 'b', p5: 'c', outsider: 'd' };
  assert.equal(cloneBandWinner(votes, eligible, allowed, () => 0, 'd'), 'a');
  assert.equal(cloneBandWinner(votes, eligible, allowed, () => .99, 'd'), 'b');
  assert.equal(cloneBandWinner({}, eligible, allowed, () => 0, 'd'), 'd');
  assert.equal(cloneBandWinner({ p1: 'bogus' }, eligible, allowed, () => 0, 'd'), 'd');
  assert.equal(cloneBandWinner({ p1: 'a', p2: 'b', p3: 'c' }, eligible, allowed, () => .99, 'd'), 'c');
});

test('clone: each capacity has exactly four times its normal already-apportioned pool', () => {
  for (let capacity = 4; capacity <= 8; capacity++) {
    const normal = makeMatch({ humans: capacity, capacity, seed: 88 });
    const clone = makeMatch({ humans: capacity, capacity, seed: 88, gameMode: 'clone' });
    try {
      for (const [id, entry] of normal.m.pool.entries) {
        assert.equal(clone.m.pool.cap(id), entry.cap * 4, capacity + ':' + id);
        assert.equal(clone.m.pool.left(id), entry.left * 4);
      }
      assert.deepEqual(clone.m.gd.shopSlots(4).item, normal.m.gd.shopSlots(4).item);
    } finally { normal.m.dispose(); clone.m.dispose(); }
  }
});

test('clone: own DIY stock also quadruples after capacity rounding and retains clone shop settings', () => {
  const picks = { chess_char_5_diy1_a: { charId: 'char_609_acguad' }, chess_char_6_diy1_a: { charId: 'char_609_acguad' } };
  for (const capacity of [4, 5, 8]) {
    const seats = [{ seat: 0, playerId: 'p_0', name: 'DIY', connected: true, isBot: false, diy: picks }];
    const normal = makeMatch({ seats, capacity }), clone = makeMatch({ seats, capacity, gameMode: 'clone' });
    try {
      const a = normal.ps('p_0'), b = clone.ps('p_0');
      assert.equal(a.diyStock.entries.size, 2);
      for (const [id, entry] of a.diyStock.entries) assert.equal(b.diyStock.cap(id), entry.cap * 4);
      assert.equal(b.gd.focusSlots, 2);
      assert.deepEqual(b.gd.shopSlots(6), clone.m.gd.shopSlots(6));
    } finally { normal.m.dispose(); clone.m.dispose(); }
  }
});

test('clone: strategy refresh hooks cannot replace the two guaranteed focus slots', () => {
  const h = makeMatch({ humans: 4, difficulty: 'FUNNY', gameMode: 'clone', fake: true });
  try {
    h.start(); h.toPrep();
    const ps = h.ps('p_0');
    ps.shop.level = 6;
    ps.shop.focusBondId = ps.shopFocusOptions()[0];
    ps.funds = 1000;
    const bad = [...h.m.pool.entries.keys()].find(id => !ps.gd.chess(id).bonds.includes(ps.shop.focusBondId));
    const dispatch = h.m.dispatch.bind(h.m);
    h.m.dispatch = (player, hook, event, opts) => {
      const result = dispatch(player, hook, event, opts);
      if (hook === 'onRefresh') for (let i = ps.shop.layout.chess - 2; i < ps.shop.layout.chess; i++) event.slots[i] = { kind: 'chess', id: bad, basePrice: 1 };
      return result;
    };
    assert.equal(ps.refresh().ok, true);
    for (const slot of ps.shop.slots.slice(ps.shop.layout.chess - 2, ps.shop.layout.chess)) assert.ok(ps.gd.chess(slot.id).bonds.includes(ps.shop.focusBondId));
    h.invariants();
  } finally { h.m.dispose(); }
});

test('clone: scaled single-human draft passes rule audit and ends once at its deadline', () => {
  const h = makeMatch({ humans: 1, bots: 3, capacity: 4, gameMode: 'clone', timerScale: .5 });
  const audit = attachAudit(h.m);
  try {
    draft(h);
    assert.equal(h.m.deadline, h.m.draft.turnDeadline);
    h.sched.advance(h.m.deadline - h.sched.now() + 1);
    assert.equal(h.m.phase, PHASE.BATTLE_CHECK);
    assert.deepEqual(audit.violations, []);
  } finally { h.m.dispose(); }
});

test('clone: no votes resolves default; single human plus bots still uses the clone countdown', () => {
  const h = makeMatch({ humans: 1, gameMode: 'clone' });
  try {
    draft(h); assert.ok(h.m.deadline > h.sched.now());
    assert.equal(h.m.publicView().draft.untimed, false);
    h.sched.advance(BAND_TURN_SECONDS * 1000 + 1);
    assert.equal(h.ps('p_0').bandId, h.m.gd.bandDraft.timeoutBandId);
  } finally { h.m.dispose(); }
  const bots = makeMatch({ humans: 1, bots: 3, gameMode: 'clone' });
  try { draft(bots); bots.sched.advance(1); assert.equal(Object.keys(bots.m.draft.votes).length, 3); }
  finally { bots.m.dispose(); }
});

test('clone: two focus slots always draw selected eligible bond; normal four-seat room has no focus', () => {
  const h = makeMatch({ humans: 4, capacity: 4, difficulty: 'FUNNY', gameMode: 'clone' });
  const normal = makeMatch({ humans: 4 });
  try {
    const ps = h.ps('p_0');
    assert.equal(normal.ps('p_0').shopFocusOptions().length, 0);
    ps.shop.level = 6;
    ps.shop.focusBondId = ps.shopFocusOptions()[0];
    assert.ok(ps.shop.focusBondId);
    assert.equal(h.m.gd.focusSlots, 2);
    for (let k = 0; k < 100; k++) {
      ps.rollShop();
      const n = ps.shop.layout.chess;
      for (const slot of ps.shop.slots.slice(n - 2, n)) assert.ok(h.m.gd.chess(slot.id).bonds.includes(ps.shop.focusBondId));
    }
    assert.equal(ps.privateView().shop.bonusChessSlots, 2);
    assert.equal(ps.privateView().shop.cloneMode, true);
  } finally { h.m.dispose(); normal.m.dispose(); }
});

test('clone: all difficulties scale full final and hidden teams linearly from the eight-seat target', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) for (const capacity of [4, 5, 6, 7, 8]) for (const hidden of [false, true]) {
    if (hidden && difficulty === 'FUNNY') continue;
    const h = makeMatch({ humans: capacity, capacity, difficulty, gameMode: 'clone', fake: true, seed: 20, clientCombat: true, clients: false });
    try {
      const m = h.m;
      m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
      m.startFinalAssault(hidden);
      const id = hidden ? m.hiddenBossId : m.bossId;
      const base = DATA.bosses[id].bloodPoint[difficulty];
      assert.equal(m.bossPool.maxHp, base * capacity * 6, `${difficulty}:${capacity}:${id}`);
      if (capacity === 8) assert.equal(m.bossPool.maxHp, Math.round(bossPoolHp(m.gd, id, capacity) * roomBossHp(capacity)) * 3 * 5);
      for (const field of m.fields) {
        assert.equal(field.spec.boss.poolMax, m.bossPool.maxHp, 'browser fields share the increased total');
      }
    } finally { h.m.dispose(); }
  }
});

test('clone: four-seat survivor scaling and larger-room fixed capacity remain intact', () => {
  for (const capacity of [4, 5, 6, 7, 8]) for (const hidden of [false, true]) {
    const h = makeMatch({ humans: capacity, capacity, gameMode: 'clone', fake: true, seed: 20 });
    try {
      const m = h.m;
      for (const ps of m.order.slice(0, 2)) ps.alive = false;
      m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
      m.startFinalAssault(hidden);
      const id = hidden ? m.hiddenBossId : m.bossId;
      const base = DATA.bosses[id].bloodPoint[m.gd.difficulty];
      assert.equal(m.bossPool.maxHp, base * (capacity === 4 ? 2 : capacity) * 6);
    } finally { h.m.dispose(); }
  }
});

test('normal: clone HP increase cannot change solo or four-to-eight-seat boss pools', () => {
  for (const mode of ['solo', 'coop']) for (const capacity of [4, 5, 6, 7, 8]) for (const hidden of [false, true]) {
    if (mode === 'solo' && capacity !== 4) continue;
    const humans = mode === 'solo' ? 1 : capacity;
    const h = makeMatch({ mode, humans, capacity, gameMode: 'normal', fake: true, seed: 20 });
    try {
      const m = h.m;
      m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
      m.startFinalAssault(hidden);
      const id = hidden ? m.hiddenBossId : m.bossId;
      assert.equal(m.bossPool.maxHp, Math.round(bossPoolHp(m.gd, id, humans) * (mode === 'solo' ? 1 : roomBossHp(capacity))));
    } finally { h.m.dispose(); }
  }
});

test('clone: eight duck strategies produce every count 0..8, starting at R5, without replacing bosses/flyers', () => {
  const h = makeMatch({ humans: 8, capacity: 8, gameMode: 'clone', seed: 49 });
  try {
    const m = h.m, ps = h.ps('p_0');
    for (const player of m.order) player.bandId = 'band_ducklord';
    const normalKey = Object.values(DATA.enemies).find(e => e.rank === 'NORMAL' && e.stats.motion === 'WALK').key;
    const fly = Object.values(DATA.enemies).find(e => e.rank === 'NORMAL' && e.stats.motion === 'FLY').key;
    const boss = Object.values(DATA.enemies).find(e => e.rank === 'BOSS').key;
    const counts = new Set();
    for (let k = 0; k < 200; k++) {
      m.round = k === 0 ? 4 : 5;
      const spawns = Array.from({ length: 40 }, (_, i) => ({ time: i, enemyKey: i === 38 ? fly : i === 39 ? boss : normalKey, count: 1, routeIndex: 0 }));
      m.dispatch(ps, 'onBattleStart', { kind: 'normal', round: m.round, spawns, input: ps.battleInput({ side: 'L', colOffset: 0 }) });
      const n = spawns.filter(spawn => spawn.tag === 'duck').length;
      if (k === 0) assert.equal(n, 0);
      else { assert.ok(n >= 0 && n <= 8); counts.add(n); }
      assert.ok(spawns.some(s => s.enemyKey === fly)); assert.ok(spawns.some(s => s.enemyKey === boss));
      assert.equal(spawns.length, 40);
    }
    assert.deepEqual([...counts].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  } finally { h.m.dispose(); }
});
