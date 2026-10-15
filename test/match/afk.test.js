import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, checkInvariants } from './harness.js';
import { startServer } from '../../server/index.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { FakeBattle } from './fakeBattle.js';
import { TestClient } from '../helpers/wsClient.js';

function setup(opts = {}) {
  const h = makeMatch({ humans: 2, fake: true, afkKickEnabled: true, ...opts }).start();
  h.toPrep(1);
  return h;
}
function nextPrep(h) {
  const round = h.m.round;
  h.m.guard(() => h.m.prepDeadline());
  assert.ok(h.drive(() => h.m.phase === 'PREP' && h.m.round === round + 1, { ready: false }));
}

test('online idle human is warned after two complete preps and removed after three; stock returns and the team continues', () => {
  const kicked = [], h = setup({ onAfk: id => kicked.push(id) });
  try {
    const ps = h.ps('p_0'), id = h.m.gd.visibleChess[0], before = h.m.pool.left(id);
    ps.acquireChess(id);
    nextPrep(h);
    assert.equal(ps._afkPrepCount, 1);
    assert.equal(h.lastTo('p_0', 'm.toast'), null);
    nextPrep(h);
    assert.equal(ps._afkPrepCount, 2);
    assert.match(h.lastTo('p_0', 'm.toast').text, /连续2个整备回合/);
    assert.equal(ps.left, false);
    h.m.handle('p_1', { t: 'g.ready', ready: true });
    h.m.guard(() => h.m.prepDeadline());
    assert.deepEqual(kicked, ['p_0']);
    assert.equal(ps.left, true);
    assert.equal(ps.alive, false);
    assert.equal(h.m.pool.left(id), before);
    assert.equal(h.ps('p_1').left, false);
    assert.equal(h.m.ended, false);
    assert.equal(h.m.handle('p_0', { t: 'g.freeze' }).error, 'NOT_IN_ROOM');
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('real lobby removes an online AFK host, migrates host, refuses further game actions and does not restore the seat on reconnect', async () => {
  class ScheduledMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler({ instantCombat: true }),
      BattleClass: FakeBattle, clientCombat: false, botRehearsal: 0 }); }
  }
  FakeBattle.reset();
  const errors = [], clients = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', MatchClass: ScheduledMatch,
    log: { info() {}, warn() {}, debug() {}, error: e => errors.push(String(e)) } });
  const connect = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c); c.identity = await c.hello(name, token); return c;
  };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  try {
    const a = await connect('Idle host'), b = await connect('Active guest');
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const state = await a.waitFor('room.state');
    await ok(b, { t: 'room.join', code: state.code });
    await ok(b, { t: 'room.ready', ready: true });
    await ok(a, { t: 'room.start' });
    const room = srv.lobby.rooms.get(state.code), m = room.match;
    for (const ps of m.players.values()) m.handle(ps.playerId, { t: 'g.infoReady' });
    while (m.phase === 'BAND_DRAFT') m.handle(m.draftTurn(), { t: 'g.band', bandId: m.defaultBand(m.draftTurn()) });
    assert.ok(m.sched.runUntil(() => m.phase === 'PREP'));
    for (let i = 0; i < 3; i++) {
      const round = m.round;
      m.handle(b.identity.playerId, { t: 'g.ready', ready: true });
      m.guard(() => m.prepDeadline());
      if (i < 2) assert.ok(m.sched.runUntil(() => m.phase === 'PREP' && m.round === round + 1));
    }
    assert.equal((await a.waitFor('room.closed')).reason, 'afk');
    assert.equal(srv.registry.byId(a.identity.playerId).roomCode, null);
    assert.equal(room.hostId, b.identity.playerId);
    assert.equal(room.match, m);
    assert.equal((await a.request({ t: 'g.ready', ready: true })).code, 'NOT_IN_ROOM');
    await a.terminate();
    const resumed = await connect('Idle host', a.identity.token);
    assert.equal(resumed.identity.resumed, true);
    assert.equal(srv.registry.byId(resumed.identity.playerId).roomCode, null);
    assert.equal((await resumed.request({ t: 'room.ready', ready: true })).code, 'NOT_IN_ROOM');
    assert.deepEqual(errors, []);
  } finally {
    for (const c of clients) await c.terminate();
    await srv.close();
  }
});

test('successful manual prep operation or ready clears the streak, even if the player later unreadies', () => {
  for (const action of [{ t: 'g.freeze' }, { t: 'g.ready', ready: true }]) {
    const h = setup();
    try {
      nextPrep(h); nextPrep(h);
      assert.deepEqual(h.m.handle('p_0', action), { ok: true });
      assert.equal(h.ps('p_0')._afkPrepCount, 0);
      if (action.t === 'g.ready') h.m.handle('p_0', { t: 'g.ready', ready: false });
      nextPrep(h);
      assert.equal(h.ps('p_0')._afkPrepCount, 0);
      nextPrep(h);
      assert.equal(h.ps('p_0')._afkPrepCount, 1);
    } finally { h.m.dispose(); }
  }
});

test('invalid actions, watching, automatic unit stats and more-time requests cannot disguise idle preps', () => {
  const h = setup();
  try {
    nextPrep(h); nextPrep(h);
    assert.ok(h.m.handle('p_0', { t: 'g.buy', slot: 999 }).error);
    h.m.handle('p_0', { t: 'g.unitStats', seq: 1 });
    h.m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1', playerId: 'p_1' });
    h.m.handle('p_0', { t: 'g.prepExtend', seconds: 30 });
    h.m.handle('p_0', { t: 'g.ready', ready: false });
    assert.equal(h.ps('p_0')._prepHumanActive, false);
    h.m.guard(() => h.m.prepDeadline());
    assert.equal(h.ps('p_0').left, true);
  } finally { h.m.dispose(); }
});

test('disconnection and reconnection preserve the original grace mechanism, not the online AFK penalty', () => {
  const h = setup();
  try {
    nextPrep(h); nextPrep(h);
    h.m.onDisconnect('p_0'); h.m.onReconnect('p_0');
    nextPrep(h);
    assert.equal(h.ps('p_0')._afkPrepCount, 0);
    h.m.onDisconnect('p_0');
    nextPrep(h); nextPrep(h);
    assert.equal(h.ps('p_0').left, false);
  } finally { h.m.dispose(); }
});

test('solo, single-human, AI, autoplay, spectators and eliminated players are never kicked for waiting', () => {
  for (const opts of [{ mode: 'solo', humans: 1 }, { humans: 1, bots: 1 }, { bots: 1, spectators: ['s_0'] }]) {
    const h = setup(opts);
    try {
      if (opts.humans !== 1) {
        h.m.handle('p_0', { t: 'g.autoplay', on: true });
        h.ps('p_1').lp = 0; h.ps('p_1').eliminate(1);
      }
      for (let i = 0; i < 3; i++) nextPrep(h);
      for (const ps of h.m.players.values()) assert.equal(ps.left, false);
    } finally { h.m.dispose(); }
  }
});
