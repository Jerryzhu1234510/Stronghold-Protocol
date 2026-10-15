import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

let srv, clients;
class CapacityStub extends StubMatch {
  constructor(opts) { super(opts); this.capacity = opts.capacity; }
}
beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: CapacityStub });
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map((client) => client.terminate().catch(() => {})));
  await srv.close();
});
async function player() {
  const client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  clients.push(client);
  const welcome = await client.hello(`博士${clients.length}`);
  client.id = welcome.playerId;
  return client;
}
async function ok(client, message) { const reply = await client.request(message); assert.equal(reply.t, 'ok', JSON.stringify(reply)); }
async function denied(client, message, code) { const reply = await client.request(message); assert.equal(reply.t, 'error'); assert.equal(reply.code, code, JSON.stringify(reply)); }
const roomOf = (client) => srv.lobby.roomOf(srv.registry.byId(client.id));
const counts = async () => (await fetch(`http://127.0.0.1:${srv.port}/population`)).json();
async function party(size, capacity) {
  const people = [];
  for (let i = 0; i < size; i++) people.push(await player());
  await ok(people[0], { t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity, experimentalAccepted: true });
  const room = roomOf(people[0]);
  for (const client of people.slice(1)) {
    await ok(client, { t: 'room.join', code: room.code });
    await ok(client, { t: 'room.ready', ready: true });
  }
  return { people, room, host: people[0] };
}

test('population counts entry, matching and started players, excluding bots and spectators from matches', async () => {
  const idle = await player();
  const queued = await player();
  await ok(queued, { t: 'room.matchmake', difficulty: 'FUNNY' });
  const group = await party(2, 4);
  await ok(group.host, { t: 'room.addBot' });
  const spectator = await player();
  await ok(spectator, { t: 'room.spectate', code: group.room.code });
  assert.deepEqual(await counts(), { online: 5, matching: 1, inGame: 0 });
  await ok(group.host, { t: 'room.start' });
  assert.deepEqual(await counts(), { online: 5, matching: 1, inGame: 2 });
  await group.people[1].terminate();
  for (let i = 0; i < 20 && (await counts()).online !== 4; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await counts(), { online: 4, matching: 1, inGame: 1 });
  assert.ok(idle.id);
});

for (const capacity of [5, 6, 7, 8]) test(`${capacity} singles form exactly one locked ${capacity}-player match`, async () => {
  const people = [];
  for (let i = 0; i < capacity; i++) {
    const client = await player(); people.push(client);
    await ok(client, { t: 'room.matchmake', difficulty: 'FUNNY', capacity, experimentalAccepted: true });
    if (i < capacity - 1) assert.equal(roomOf(client).match, null);
  }
  const room = roomOf(people[0]);
  assert.ok(room.match);
  assert.equal(room.capacity, capacity);
  assert.equal(room.seats.filter(Boolean).length, capacity);
  assert.equal(room.match.capacity, capacity);
  assert.equal(room.chatEnabled, true);
  for (const client of people) assert.equal(roomOf(client), room);
  assert.deepEqual(await counts(), { online: capacity, matching: 0, inGame: capacity });
});

test('room sizes and difficulties never mix; queued quick capacity cannot be changed', async () => {
  const a = await player(), b = await player(), c = await player();
  await ok(a, { t: 'room.matchmake', difficulty: 'FUNNY', capacity: 5, experimentalAccepted: true });
  await ok(b, { t: 'room.matchmake', difficulty: 'FUNNY', capacity: 6, experimentalAccepted: true });
  await ok(c, { t: 'room.matchmake', difficulty: 'HARD', capacity: 5, experimentalAccepted: true });
  assert.equal(new Set([roomOf(a), roomOf(b), roomOf(c)]).size, 3);
  await denied(a, { t: 'room.setCapacity', capacity: 6, experimentalAccepted: true }, ERR.WRONG_PHASE);
  await denied(a, { t: 'room.matchmake', difficulty: 'FUNNY', capacity: 6, experimentalAccepted: true }, ERR.WRONG_PHASE);
  assert.equal(roomOf(a).capacity, 5);
  await ok(a, { t: 'room.cancelMatchmaking' });
  await ok(a, { t: 'room.matchmake', difficulty: 'FUNNY', capacity: 6, experimentalAccepted: true });
  assert.equal(roomOf(a), roomOf(b));
});

test('experimental warning acknowledgement and room capacity bounds are enforced', async () => {
  const client = await player();
  await denied(client, { t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity: 5 }, ERR.BAD_MSG);
  await denied(client, { t: 'room.matchmake', difficulty: 'FUNNY', capacity: 8 }, ERR.BAD_MSG);
  for (const capacity of [0, 3, 9, 5.5, '8']) assert.ok(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity }));
  assert.equal(roomOf(client), null);
});

test('host resizing broadcasts immediately, preserves sparse members and loadouts, and resets ready', async () => {
  const group = await party(2, 4), guest = group.people[1];
  await denied(guest, { t: 'room.setCapacity', capacity: 8, experimentalAccepted: true }, ERR.NOT_HOST);
  await ok(group.host, { t: 'room.setCapacity', capacity: 8, experimentalAccepted: true });
  assert.equal(group.room.seats.length, 8);
  const frame = await guest.waitFor('room.state', (state) => state.capacity === 8);
  assert.equal(frame.seats.length, 8);
  assert.equal(group.room.seatOf(guest.id).ready, false);
  // Deliberately sparse last seat: shrinking compacts members instead of losing a player.
  const seat = group.room.seats[1]; group.room.seats[1] = null;
  seat.seat = 7; seat.supportPicks = [null, null, null, null]; group.room.seats[7] = seat;
  await ok(group.host, { t: 'room.setCapacity', capacity: 4 });
  assert.equal(group.room.seats.length, 4);
  assert.equal(group.room.seatOf(guest.id).seat, 1);
  assert.deepEqual(group.room.seatOf(guest.id).supportPicks, [null, null, null, null]);
  await ok(guest, { t: 'room.ready', ready: true });
  await ok(group.host, { t: 'room.start' });
  await denied(group.host, { t: 'room.setCapacity', capacity: 8, experimentalAccepted: true }, ERR.ROOM_STARTED);
});

test('shrinking an occupied large room is refused without removing anyone; seat eight can be managed', async () => {
  const group = await party(1, 8);
  for (let i = 0; i < 7; i++) await ok(group.host, { t: 'room.addBot' });
  assert.equal(group.room.seats.length, 8);
  await denied(group.host, { t: 'room.setCapacity', capacity: 4 }, ERR.ROOM_FULL);
  await ok(group.host, { t: 'room.removeBot', seat: 7 });
  assert.equal(group.room.seats[7], null);
  const eighth = await player();
  await ok(eighth, { t: 'room.join', code: group.room.code });
  await ok(group.host, { t: 'room.kick', seat: 7, playerId: eighth.id });
  assert.equal(roomOf(eighth), null);
});

for (const [capacity, sizes] of [[5, [2, 3]], [7, [3, 3, 1]], [8, [2, 2, 2, 2]]]) {
  test(`whole parties match ${sizes.join('+')} into ${capacity}, preserving every identity`, async () => {
    const all = [], groups = [];
    for (const size of sizes) {
      if (size === 1) {
        const client = await player(); all.push(client);
        await ok(client, { t: 'room.matchmake', difficulty: 'FUNNY', capacity, experimentalAccepted: true });
      } else {
        const group = await party(size, capacity); groups.push(group); all.push(...group.people);
        await ok(group.host, { t: 'room.matchmakeParty' });
      }
    }
    const room = roomOf(all[0]);
    assert.ok(room.match);
    assert.equal(new Set(room.seats.filter(Boolean).map((seat) => seat.playerId)).size, capacity);
    for (const client of all) assert.equal(roomOf(client), room);
    assert.equal(room.chatEnabled, true);
  });
}
