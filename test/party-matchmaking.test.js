import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

let srv, clients;
beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.terminate().catch(() => {})));
  await srv.close();
});
async function player(name, token) {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  clients.push(c);
  const welcome = await c.hello(name, token);
  c.id = welcome.playerId; c.token = welcome.token;
  return c;
}
async function ok(c, msg) { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); }
async function denied(c, msg, code) { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code); }
function roomOf(c) { return srv.lobby.roomOf(srv.registry.byId(c.id)); }
async function party(size = 2, difficulty = 'FUNNY') {
  const people = await Promise.all(Array.from({ length: size }, (_, i) => player(`好友${clients.length}-${i}`)));
  await ok(people[0], { t: 'room.create', mode: 'coop', difficulty });
  const room = roomOf(people[0]);
  for (const c of people.slice(1)) {
    await ok(c, { t: 'room.join', code: room.code });
    await ok(c, { t: 'room.ready', ready: true });
  }
  return { people, host: people[0], room };
}
async function single(name = '单人', difficulty = 'FUNNY') {
  const c = await player(name); await ok(c, { t: 'room.matchmake', difficulty }); return c;
}
function startedTogether(people, room) {
  assert.ok(room.match);
  assert.equal(room.matchCount, 1);
  assert.equal(room.activeHumans().length, 4);
  assert.equal(new Set(room.activeHumans().map((s) => s.playerId)).size, 4);
  for (const c of people) assert.equal(roomOf(c), room);
  assert.equal(room.chatEnabled, true);
}

test('two friends and two individual players start together; chat and support picks survive', async () => {
  assert.equal(validateC2S({ t: 'room.matchmakeParty' }), null);
  const team = await party();
  await ok(team.host, { t: 'room.chat', text: '匹配前聊天' });
  const picks = {};
  await ok(team.people[1], { t: 'room.diy', picks });
  await ok(team.host, { t: 'room.matchmakeParty' });
  const c = await single('路人一');
  assert.equal(team.room.match, null);
  assert.equal(team.room.activeHumans().length, 2, 'partial matching does not change party membership');
  const d = await single('路人二');
  startedTogether([...team.people, c, d], team.room);
  assert.deepEqual(team.room.seatOf(team.people[1].id).diy, picks);
  const state = await c.waitFor('room.state', (m) => m.code === team.room.code);
  assert.equal(state.chatEnabled, true);
  const history = await c.waitFor('room.chatHistory');
  assert.equal(history.messages[0].text, '匹配前聊天');
  await ok(c, { t: 'room.chat', text: '匹配到队友了' });
  await team.people[1].waitFor('room.chat', (m) => m.message.text === '匹配到队友了');
  for (const person of [...team.people, c, d]) await ok(person, { t: 'g.infoReady' });
  assert.equal(team.room.match, null);
  assert.equal(team.room.matchmaking, false);
  assert.equal(team.room.matchmakingParty, false);
  await ok(d, { t: 'room.chat', text: '结束后聊天' });
});

test('two two-person parties merge whole teams without duplicate seats or closing either player', async () => {
  const a = await party(), b = await party();
  await ok(a.host, { t: 'room.matchmakeParty' });
  await ok(b.host, { t: 'room.matchmakeParty' });
  startedTogether([...a.people, ...b.people], a.room);
  assert.equal(srv.lobby.getRoom(b.room.code), null);
  for (const c of b.people) {
    await c.waitFor('room.state', (m) => m.code === a.room.code && m.inMatch);
    assert.equal(c.log.some((m) => m.t === 'room.closed'), false);
  }
  await ok(b.people[1], { t: 'room.chat', text: '双人队汇合' });
  await a.host.waitFor('room.chat', (m) => m.message.text === '双人队汇合');
});

test('three friends can match one single, including when that single queued first', async () => {
  const c = await single();
  const team = await party(3);
  await ok(team.host, { t: 'room.matchmakeParty' });
  startedTogether([...team.people, c], team.room);
  await denied(team.people[1], { t: 'room.cancelMatchmaking' }, ERR.ROOM_STARTED);
  assert.equal(roomOf(team.people[1]), team.room);
});

test('a three-person party never takes part of a two-person party to make four', async () => {
  const trio = await party(3), duo = await party(2);
  await ok(trio.host, { t: 'room.matchmakeParty' }); await ok(duo.host, { t: 'room.matchmakeParty' });
  assert.equal(trio.room.match, null); assert.equal(duo.room.match, null);
  const a = await single();
  startedTogether([...trio.people, a], trio.room);
  for (const c of duo.people) assert.equal(roomOf(c), duo.room);
  assert.equal(duo.room.activeHumans().length, 2); assert.equal(duo.room.matchmaking, true);
  const b = await single(), c = await single();
  startedTogether([...duo.people, b, c], duo.room);
});

test('taking two of three waiting singles keeps the remaining single queued and migrates its host', async () => {
  const singles = [await single('一'), await single('二'), await single('三')];
  const waiting = roomOf(singles[0]);
  const team = await party();
  await ok(team.host, { t: 'room.matchmakeParty' });
  startedTogether([...team.people, ...singles.slice(0, 2)], team.room);
  assert.equal(roomOf(singles[2]), waiting);
  assert.equal(waiting.activeHumans().length, 1);
  assert.equal(waiting.hostId, singles[2].id);
  assert.equal(waiting.matchmaking, true);
  assert.equal(waiting.chatEnabled, false);
  const rest = [await single('四'), await single('五'), await single('六')];
  assert.ok(waiting.match);
  for (const c of [singles[2], ...rest]) assert.equal(roomOf(c), waiting);
  assert.equal(waiting.chatEnabled, false, 'remaining solo group stays chat-free');
});

test('either friend cancels the whole queue without leaving their room, history or other singles', async () => {
  const team = await party(3);
  const other = await single('不同难度', 'HARD'); const otherRoom = roomOf(other);
  await ok(team.host, { t: 'room.chat', text: '保留历史' });
  await ok(team.host, { t: 'room.matchmakeParty' });
  await ok(team.host, { t: 'room.matchmakeParty' });
  await ok(team.people[1], { t: 'room.cancelMatchmaking' });
  assert.equal(team.room.matchmaking, false);
  assert.equal(team.room.activeHumans().length, 3);
  for (const c of team.people) assert.equal(roomOf(c), team.room);
  assert.equal(team.room.chatMessages[0].text, '保留历史');
  assert.equal(otherRoom.matchmaking, true);
  assert.equal(roomOf(other), otherRoom);
  assert.equal(team.people[1].log.some((m) => m.t === 'room.closed'), false);
  await ok(team.host, { t: 'room.start' }); // manual start still works after cancellation
});

test('disconnect cancels the party queue; reconnect preserves the original friend seat without requeueing', async () => {
  const team = await party(); await ok(team.host, { t: 'room.matchmakeParty' });
  await team.people[1].terminate();
  await team.host.waitFor('room.state', (m) => !m.matchmaking && m.seats.some((s) => s?.playerId === team.people[1].id && !s.connected));
  assert.equal(team.room.matchmaking, false);
  assert.equal(team.room.activeHumans().length, 2);
  const resumed = await player('好友重连', team.people[1].token);
  assert.equal(resumed.id, team.people[1].id);
  await resumed.waitFor('room.state', (m) => m.code === team.room.code && !m.matchmaking);
  assert.equal(roomOf(resumed), team.room);
});

test('leaving a queued party cancels it and migrates the host, without matching the remaining friends silently', async () => {
  const team = await party(3); await ok(team.host, { t: 'room.matchmakeParty' });
  await ok(team.host, { t: 'room.leave' });
  assert.equal(team.room.matchmaking, false);
  assert.equal(team.room.activeHumans().length, 2);
  assert.equal(team.room.hostId, team.people[1].id);
  const c = await single(); const d = await single();
  assert.equal(team.room.match, null);
  await ok(team.people[1], { t: 'room.matchmakeParty' });
  startedTogether([...team.people.slice(1), c, d], team.room);
});

test('unready, non-host, AI and spectator requests cannot queue or corrupt a private room', async () => {
  const team = await party();
  await denied(team.people[1], { t: 'room.matchmakeParty' }, ERR.NOT_HOST);
  await ok(team.people[1], { t: 'room.ready', ready: false });
  await denied(team.host, { t: 'room.matchmakeParty' }, ERR.NOT_READY);
  await ok(team.people[1], { t: 'room.ready', ready: true });
  await ok(team.host, { t: 'room.addBot' });
  await denied(team.host, { t: 'room.matchmakeParty' }, ERR.BAD_MSG);
  await ok(team.host, { t: 'room.removeBot', seat: 2 });
  const watcher = await player('观战'); await ok(watcher, { t: 'room.spectate', code: team.room.code });
  await denied(team.host, { t: 'room.matchmakeParty' }, ERR.BAD_MSG);
  assert.equal(team.room.matchmaking, false);
  assert.equal(team.room.activeHumans().length, 2);
  assert.equal(team.room.chatEnabled, true);
});

test('party queue fixes difficulty and membership until cancelled; difficulty pools never mix', async () => {
  const a = await party(3, 'FUNNY'), b = await party(2, 'HARD');
  await ok(a.host, { t: 'room.matchmakeParty' }); await ok(b.host, { t: 'room.matchmakeParty' });
  await denied(a.people[1], { t: 'room.matchmake', difficulty: 'HARD' }, ERR.ALREADY);
  for (const msg of [{ t: 'room.start' }, { t: 'room.ready', ready: false }, { t: 'room.addBot' },
    { t: 'room.setDifficulty', difficulty: 'HARD' }]) await denied(a.host, msg, ERR.WRONG_PHASE);
  const outsider = await player('路人');
  await denied(outsider, { t: 'room.join', code: a.room.code }, ERR.WRONG_PHASE);
  await ok(a.people[1], { t: 'room.chat', text: '等待期间聊天' });
  const c = await single('绝不会加入标准房', 'HARD');
  assert.equal(a.room.match, null); assert.equal(b.room.match, null);
  const d = await single('标准房的第四位');
  startedTogether([...a.people, d], a.room);
  assert.equal(roomOf(c).difficulty, 'HARD'); assert.equal(b.room.match, null);
});

test('failed party match releases exactly the selected four and does not remove leftover singles', async () => {
  const solos = [await single('一'), await single('二'), await single('三')];
  const team = await party();
  srv.lobby.MatchClass = class { constructor() { throw new Error('expected failure'); } };
  await denied(team.host, { t: 'room.matchmakeParty' }, ERR.INTERNAL);
  for (const c of [...team.people, ...solos.slice(0, 2)]) {
    await c.waitFor('room.closed', (m) => m.reason === 'matchmaking_failed');
    assert.equal(roomOf(c), null);
  }
  assert.equal(roomOf(solos[2]).activeHumans().length, 1);
  assert.equal(roomOf(solos[2]).matchmaking, true);
});

for (const capacity of [5, 6, 7, 8]) test(`${capacity}-seat integrated queue forms a complete group and starts with locked capacity`, async () => {
  const people = [];
  for (let i = 0; i < capacity; i++) {
    const c = await player(`preview-${capacity}-${i}`); people.push(c);
    await ok(c, { t: 'room.matchmake', difficulty: 'ABYSS', capacity, experimentalAccepted: true });
  }
  const room = roomOf(people[0]);
  assert.equal(room.capacity, capacity);
  assert.equal(room.activeHumans().length, capacity);
  assert.ok(room.match);
  assert.equal(room.capacityLocked, true);
  for (const c of people) assert.equal(roomOf(c), room);
  const host = people.find(c => c.id === room.hostId);
  await denied(host, { t: 'room.start' }, ERR.WRONG_PHASE);
  await denied(host, { t: 'room.setCapacity', capacity: 4 }, ERR.ROOM_STARTED);
});

test('manual preview room can resize immediately before matchmaking and protects its participants', async () => {
  const team = await party(3);
  await ok(team.host, { t: 'room.setCapacity', capacity: 8, experimentalAccepted: true });
  assert.equal(team.room.seats.length, 8);
  assert.equal(team.room.capacity, 8);
  assert.equal(team.room.seatOf(team.people[1].id).ready, false);
  for (const c of team.people.slice(1)) await ok(c, { t: 'room.ready', ready: true });
  await ok(team.host, { t: 'room.setCapacity', capacity: 4 });
  assert.equal(team.room.seats.length, 4);
  assert.equal(team.room.activeHumans().length, 3);
  await ok(team.host, { t: 'room.setCapacity', capacity: 8, experimentalAccepted: true });
  for (const c of team.people.slice(1)) await ok(c, { t: 'room.ready', ready: true });
  await ok(team.host, { t: 'room.start' });
  assert.ok(team.room.match);
});
