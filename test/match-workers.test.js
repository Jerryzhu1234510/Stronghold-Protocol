import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createMatchWorkerPool, matchWorkerCount } from '../server/match/workers/pool.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';

const fixture = new URL('./fixtures/workerMatch.js', import.meta.url).href;
const quiet = { info() {}, warn() {}, error() {} };
async function until(check, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await delay(20); }
  assert.fail('worker condition did not become true');
}
function options(code, id = code) {
  return { roomCode: code, mode: 'solo', difficulty: 'NORMAL', gameMode: 'normal', capacity: 1,
    seats: [{ playerId: id, name: id, seat: 0, isBot: false, connected: true }],
    spectators: [], seed: 1, matchNo: 1, send() {}, sendMany() {}, broadcast() {}, onEnd() {}, onCrash() {} };
}

test('battle worker count is opt-in and bounded', () => {
  assert.equal(matchWorkerCount(0), 0); assert.equal(matchWorkerCount('2'), 2);
  for (const n of [-1, 1.5, 5, 'invalid']) assert.throws(() => matchWorkerCount(n), RangeError);
});

test('matches stay on their assigned isolate; command errors and end ACKs are real', async () => {
  const pool = await createMatchWorkerPool({ count: 2, matchModule: fixture, log: quiet });
  try {
    const ends = [];
    const a = new pool.MatchClass({ ...options('AAAA'), onEnd: s => ends.push(s) });
    const b = new pool.MatchClass(options('BBBB'));
    a.start(); b.start();
    assert.notEqual(a.slot.worker.threadId, b.slot.worker.threadId);
    assert.deepEqual(pool.snapshot().map(s => s.matches), [1, 1]);
    const original = a.slot;
    assert.equal((await a.handle('AAAA', { t: 'g.pause', on: false })).error, ERR.WRONG_PHASE);
    assert.equal((await a.setLoadout('AAAA', {})).error, ERR.WRONG_PHASE);
    a.onDisconnect('AAAA'); a.onReconnect('AAAA');
    assert.equal(a.slot, original);
    assert.equal((await a.handle('AAAA', { t: 'g.infoReady' })).ok, true);
    await until(() => ends.length === 1);
    a.dispose();
    assert.deepEqual(pool.snapshot().map(s => s.matches), [0, 1]);
    b.dispose();
  } finally { await pool.close(); }
  assert.equal(pool.pending.size, 0); assert.equal(pool.matches.size, 0);
});

test('a busy isolate does not block another; outstanding command queues are bounded', async () => {
  const pool = await createMatchWorkerPool({ count: 2, matchModule: fixture, log: quiet, maxPendingPerMatch: 1 });
  try {
    const a = new pool.MatchClass(options('AAAA')), b = new pool.MatchClass(options('BBBB'));
    a.start(); b.start();
    let done = false;
    const slow = a.handle('AAAA', { t: 'g.pause', on: true }).then(r => { done = true; return r; });
    assert.equal((await a.handle('AAAA', { t: 'g.pause', on: false })).error, ERR.RATE);
    assert.equal((await b.handle('BBBB', { t: 'g.pause', on: false })).error, ERR.WRONG_PHASE);
    assert.equal(done, false, 'the independent isolate responds before the blocked one');
    assert.equal((await slow).error, ERR.WRONG_PHASE);
  } finally { await pool.close(); }
});

test('worker failure ends only its own matches, settles requests and restarts for new matches', async () => {
  const pool = await createMatchWorkerPool({ count: 2, matchModule: fixture, log: quiet });
  try {
    let crashed = false;
    const a = new pool.MatchClass({ ...options('AAAA'), onCrash: () => { crashed = true; } });
    const b = new pool.MatchClass(options('BBBB'));
    a.start(); b.start();
    const pending = a.handle('AAAA', { t: 'g.pause', on: true });
    await a.slot.worker.terminate();
    assert.equal((await pending).error, ERR.INTERNAL);
    assert.equal(crashed, true); assert.equal(b.disposed, false);
    assert.equal((await b.handle('BBBB', { t: 'g.pause', on: false })).error, ERR.WRONG_PHASE);
    await until(() => a.slot.ready);
    const fresh = new pool.MatchClass(options('CCCC'));
    assert.equal(fresh.slot, a.slot);
  } finally { await pool.close(); }
});

test('failed startup does not leave worker threads running', async () => {
  await assert.rejects(createMatchWorkerPool({ count: 2, log: quiet,
    matchModule: new URL('./fixtures/nonexistent-worker-engine.js', import.meta.url).href }), /failed to start/);
});

test('timed-out matches stop accepting commands without taking down the other worker', async () => {
  const pool = await createMatchWorkerPool({ count: 2, matchModule: fixture, log: quiet, requestTimeoutMs: 100 });
  try {
    let crashed = false;
    const a = new pool.MatchClass({ ...options('AAAA'), onCrash: () => { crashed = true; } });
    const b = new pool.MatchClass(options('BBBB')); a.start(); b.start();
    assert.equal((await b.handle('BBBB', { t: 'g.pause', on: false })).error, ERR.WRONG_PHASE);
    const failed = await a.handle('AAAA', { t: 'g.pause', on: true });
    assert.equal(failed.error, ERR.INTERNAL); assert.match(failed.detail, /timed out/);
    assert.equal(crashed, true); assert.equal(a.disposed, true);
    assert.equal((await a.handle('AAAA', { t: 'g.pause', on: false })).error, ERR.INTERNAL);
    assert.equal((await b.handle('BBBB', { t: 'g.pause', on: false })).error, ERR.WRONG_PHASE);
    assert.equal(pool.pending.size, 0);
  } finally { await pool.close(); }
});

test('shared lobby keeps directory, identity, spectators and draining with two battle workers', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, matchWorkers: 2, matchWorkerModule: fixture });
  const clients = [];
  async function player(name, token) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    c.welcome = await c.hello(name, token); return c;
  }
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok', msg.t);
  try {
    const a = await player('host'), b = await player('guest'), c = await player('second'), watcher = await player('watcher');
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', visibility: 'public', description: 'worker test' });
    const room = await a.waitFor('room.state');
    await ok(b, { t: 'room.join', code: room.code });
    await ok(b, { t: 'room.ready', ready: true }); await ok(a, { t: 'room.start' });
    await a.waitFor('m.public');
    await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const other = await c.waitFor('room.state');
    await ok(c, { t: 'room.start' }); await c.waitFor('m.public');
    assert.notEqual(srv.lobby.getRoom(room.code).match.slot.index, srv.lobby.getRoom(other.code).match.slot.index);
    await ok(watcher, { t: 'room.list' });
    const directory = await watcher.waitFor('room.directory');
    assert.equal(directory.rooms.length, 1); assert.equal(directory.rooms[0].code, room.code);
    await ok(watcher, { t: 'room.spectate', code: room.code });
    const forbidden = await watcher.request({ t: 'g.pause', on: false });
    assert.equal(forbidden.code, ERR.SPECTATOR);
    await b.terminate();
    const resumed = await player('guest', b.welcome.token);
    assert.equal(resumed.welcome.playerId, b.welcome.playerId);
    assert.equal(resumed.welcome.resumed, true);
    await resumed.waitFor('room.state', r => r.code === room.code);
    await resumed.waitFor('m.public');
    const rejected = await a.request({ t: 'g.pause', on: false });
    assert.equal(rejected.t, 'error'); assert.equal(rejected.code, ERR.WRONG_PHASE);
    const locked = await a.request({ t: 'room.loadout', entries: {} });
    assert.equal(locked.t, 'error'); assert.equal(locked.code, ERR.WRONG_PHASE);
    const health = await fetch(srv.url + '/healthz').then(r => r.json());
    assert.equal(health.matches, 2); assert.deepEqual(health.matchWorkers.map(w => w.matches), [1, 1]);
    srv.beginDrain();
    assert.equal((await c.request({ t: 'g.pause', on: false })).code, ERR.WRONG_PHASE);
    assert.equal((await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'error');
    await ok(a, { t: 'g.infoReady' }); await ok(resumed, { t: 'g.infoReady' }); await a.waitFor('m.result');
    await until(() => !srv.lobby.getRoom(room.code)?.match);
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});

test('production normal, clone and versus engines run through the same pool without a new client protocol', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, matchWorkers: 2 });
  const clients = [];
  try {
    for (const gameMode of ['normal', 'clone', 'versus']) {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
      await c.hello(gameMode);
      assert.equal((await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', gameMode })).t, 'ok');
      const state = await c.waitFor('room.state');
      if (gameMode === 'versus') {
        for (let i = 0; i < 3; i++) assert.equal((await c.request({ t: 'room.addBot' })).t, 'ok');
      }
      const started = await c.request({ t: 'room.start' });
      assert.equal(started.t, 'ok', JSON.stringify(started));
      await c.waitFor('m.public', () => true, 5000);
      if (gameMode === 'versus') await c.waitFor('m.versus', () => true, 5000);
      else await c.waitFor('m.private', () => true, 5000);
      assert.equal((await c.request({ t: 'room.loadout', entries: {} })).t, 'ok');
      if (gameMode === 'versus') {
        assert.equal((await c.request({ t: 'g.infoReady' })).t, 'ok');
        const prep = await c.waitFor('m.versus', p => p.state.room.status === 'preparation', 5000);
        assert.ok(prep.state.field.snapshot); assert.ok(prep.state.field.meta.fieldId);
        const refreshed = await c.request({ t: 'g.versus', command: { action: 'refresh' } });
        assert.equal(refreshed.t, 'ok', JSON.stringify(refreshed));
        assert.equal((await c.request({ t: 'room.loadout', entries: {} })).code, ERR.ROOM_STARTED);
      }
      const assigned = srv.lobby.getRoom(state.code).match.slot.index;
      await c.terminate();
      await until(() => srv.lobby.getRoom(state.code)?.seats[0]?.connected === false);
      assert.equal(srv.lobby.getRoom(state.code).match.slot.index, assigned);
    }
    assert.equal(srv.lobby.stats().matches, 3);
    assert.ok(srv.matchWorkerPool.snapshot().every(w => w.matches > 0));
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});

test('quick matching is global rather than split into worker-local waiting queues', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, matchWorkers: 2, matchWorkerModule: fixture });
  const clients = [];
  try {
    for (let i = 0; i < 8; i++) {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
      const welcome = await c.hello(`matcher-${i}`); c.id = welcome.playerId;
      assert.equal((await c.request({ t: 'room.matchmake', difficulty: 'NORMAL' })).t, 'ok');
    }
    const rooms = clients.map(c => srv.lobby.roomOf(srv.registry.byId(c.id)));
    assert.equal(new Set(rooms.slice(0, 4)).size, 1);
    assert.equal(new Set(rooms.slice(4)).size, 1);
    assert.notEqual(rooms[0], rooms[4]);
    assert.ok(rooms[0].match); assert.ok(rooms[4].match);
    assert.notEqual(rooms[0].match.slot.index, rooms[4].match.slot.index);
    assert.deepEqual(srv.matchWorkerPool.snapshot().map(w => w.matches), [1, 1]);
    for (const c of clients) await c.waitFor('m.public');
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});
