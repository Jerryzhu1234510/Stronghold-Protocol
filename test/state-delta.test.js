import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateEncoder, StateDecoder } from '../shared/stateDelta.js';
import { makeMatch } from './match/harness.js';
import { Net } from '../public/js/net.js';
import { startServer } from '../server/index.js';
import { sendSession } from '../server/net.js';
import { TestClient } from './helpers/wsClient.js';

const big = () => ({ t: 'm.public', matchId: 'a', players: Array.from({ length: 8 }, (_, i) => ({
  playerId: `p${i}`, funds: 50, board: Array.from({ length: 14 }, (_, uid) => ({ uid, id: 'chess_unit', hp: 100, dir: 'UP' })),
})), phase: 'PREP', optional: null });
const transmit = (enc, dec, msg) => { const frame = enc.prepare(msg, JSON.stringify(msg)); frame.commit(); return dec.decode(JSON.parse(frame.data)); };

test('real eight-player match states restore exactly across drafts, preparation, combat and result', () => {
  const h = makeMatch({ humans: 8, capacity: 8, fake: true, instant: true });
  const enc = new StateEncoder(), dec = new StateDecoder();
  let count = 0, originalBytes = 0, wireBytes = 0;
  const capture = msg => {
    if (!['m.public', 'm.private'].includes(msg.t)) return;
    const json = JSON.stringify(msg), frame = enc.prepare(msg, json); frame.commit();
    assert.deepEqual(dec.decode(JSON.parse(frame.data)), JSON.parse(json));
    count++; originalBytes += json.length; wireBytes += frame.data.length;
  };
  h.onBroadcast.push(capture); h.onSend.push((id, msg) => { if (id === 'p_0') capture(msg); });
  try { h.autoHumans().start(); h.runToEnd(); assert.ok(count > 50); assert.ok(wireBytes < originalBytes); }
  finally { h.m.dispose(); }
});

test('null, delete, variable arrays, escaped keys, mutation, periodic checkpoints and failed sends', () => {
  const enc = new StateEncoder(), dec = new StateDecoder(), msg = big();
  const old = transmit(enc, dec, msg); old.players[0].funds = -999;
  const failed = enc.prepare({ ...msg, phase: 'COMBAT' }, JSON.stringify({ ...msg, phase: 'COMBAT' }));
  assert.ok(failed); // no commit: disconnected / congested socket
  msg.players[2].funds = 80; msg.optional = { 'a/b~c': [null, 5] };
  assert.deepEqual(transmit(enc, dec, msg), msg);
  delete msg.optional; msg.players[1].board.pop();
  assert.deepEqual(transmit(enc, dec, msg), msg);
  for (let i = 4; i <= 32; i++) {
    msg.players[0].funds = i;
    const frame = enc.prepare(msg, JSON.stringify(msg)); frame.commit();
    if (i === 32) assert.equal(JSON.parse(frame.data).t, 'm.public');
    assert.deepEqual(dec.decode(JSON.parse(frame.data)), msg);
  }
  const fresh = new StateEncoder();
  assert.equal(JSON.parse(fresh.prepare(msg, JSON.stringify(msg)).data).t, 'm.public');
});

test('missing baselines, sequence gaps and unsafe patch paths fail closed; old servers pass through', () => {
  const enc = new StateEncoder(), dec = new StateDecoder(), msg = big();
  transmit(enc, dec, msg); msg.phase = 'COMBAT';
  const wire = JSON.parse(enc.prepare(msg, JSON.stringify(msg)).data);
  assert.equal(wire.t, 'm.delta');
  assert.throws(() => new StateDecoder().decode(wire));
  assert.throws(() => dec.decode({ ...wire, base: 99 }));
  for (const path of [['__proto__', 'polluted'], ['players', '999', 'funds'], ['constructor']]) {
    assert.throws(() => dec.decode({ ...wire, ops: [[path, true]] }));
  }
  assert.equal({}.polluted, undefined);
  assert.deepEqual(dec.decode(msg), msg);
  dec.reset(); assert.throws(() => dec.decode(wire));
});

test('browser Net emits reconstructed state and reconnects instead of applying a missing delta', () => {
  const net = new Net({ getToken: () => null });
  const enc = new StateEncoder(), msg = big(), received = [];
  let reconnects = 0; net.reconnectNow = () => { reconnects++; };
  net.on('m.public', m => received.push(m));
  for (let i = 0; i < 5; i++) { msg.players[0].funds = i; const f = enc.prepare(msg, JSON.stringify(msg)); f.commit(); net._onMessage(f.data); }
  assert.equal(received.length, 5); assert.equal(received[4].players[0].funds, 4);
  net._onMessage(JSON.stringify({ t: 'm.delta', type: 'm.public', base: 99, seq: 100, ops: [] }));
  assert.equal(reconnects, 1); assert.equal(received.length, 5);
});

test('real negotiated sockets: broadcast, private, mixed legacy client, repeat hello and reconnect', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  const connect = async (extra, token) => { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c); c.welcome = await c.hello('delta-test', token, extra); return c; };
  try {
    const modern = await connect({ stateDelta: true }), legacy = await connect({});
    assert.equal(modern.welcome.stateDelta, true); assert.equal(legacy.welcome.stateDelta, undefined);
    await modern.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const roomState = await modern.waitFor('room.state');
    await legacy.request({ t: 'room.join', code: roomState.code });
    const room = srv.lobby.roomOf(srv.registry.byId(modern.welcome.playerId));
    const value = big();
    srv.lobby.broadcastRoom(room, value);
    const dec = new StateDecoder(); assert.deepEqual(dec.decode(await modern.waitFor('m.public')), value);
    assert.equal((await legacy.waitFor('m.public')).stateSeq, undefined);
    value.players[0].funds++;
    srv.lobby.broadcastRoom(room, value);
    assert.deepEqual(dec.decode(await modern.waitFor('m.delta')), value);
    assert.deepEqual(await legacy.waitFor('m.public'), value);
    const privateMsg = { ...value, t: 'm.private', playerId: modern.welcome.playerId };
    sendSession(srv.registry.byId(modern.welcome.playerId), privateMsg);
    assert.deepEqual(dec.decode(await modern.waitFor('m.private')), privateMsg);
    privateMsg.phase = 'COMBAT'; sendSession(srv.registry.byId(modern.welcome.playerId), privateMsg);
    assert.deepEqual(dec.decode(await modern.waitFor('m.delta')), privateMsg);
    await modern.hello('delta-test', undefined, { stateDelta: true });
    srv.lobby.broadcastRoom(room, value); assert.equal((await modern.waitFor('m.public')).stateSeq, 1);
    const token = modern.welcome.token; await modern.terminate();
    const resumed = await connect({ stateDelta: true }, token); assert.equal(resumed.welcome.resumed, true);
    srv.lobby.broadcastRoom(room, value); assert.equal((await resumed.waitFor('m.public')).stateSeq, 1);
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});
