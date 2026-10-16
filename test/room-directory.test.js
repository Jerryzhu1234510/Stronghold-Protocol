import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { RECRUIT_MAX_LEN, boardAppearance } from '../shared/roomDirectory.js';
import { Match } from '../server/match/Match.js';
import { boardPreference } from '../public/js/render/app/view.js';

let srv, clients, clock;
class DirectoryStub extends StubMatch {
  constructor(opts) { super(opts); this.mapVersion = opts.mapVersion; this.gameMode = opts.gameMode; }
}
beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: DirectoryStub });
  clients = []; clock = Date.now(); srv.lobby.now = () => clock;
});
afterEach(async () => { await Promise.all(clients.map((c) => c.terminate().catch(() => {}))); await srv.close(); });
async function player(name, token) {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
  const welcome = await c.hello(name, token); c.id = welcome.playerId; c.token = welcome.token; return c;
}
async function ok(c, msg) { const reply = await c.request(msg); assert.equal(reply.t, 'ok', JSON.stringify(reply)); }
async function denied(c, msg, code) { const reply = await c.request(msg); assert.equal(reply.t, 'error'); assert.equal(reply.code, code); }
function roomOf(c) { return srv.lobby.roomOf(srv.registry.byId(c.id)); }
async function create(c, visibility = 'public', capacity = 4) {
  await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'ABYSS', visibility, description: '终极挑战，新手也欢迎', capacity, experimentalAccepted: capacity > 4 });
  return roomOf(c);
}
async function directory(c) { await ok(c, { t: 'room.list' }); return (await c.waitFor('room.directory')).rooms; }

test('new rooms default to official scenes without replacing explicit appearance choices', async () => {
  const host = await player('Host');
  for (const mode of ['solo', 'coop']) {
    await ok(host, { t: 'room.create', mode, difficulty: 'NORMAL' });
    assert.equal(roomOf(host).toState().mapVersion, 'official');
    await ok(host, { t: 'room.leave' });
    for (const mapVersion of ['classic', 'new']) {
      await ok(host, { t: 'room.create', mode, difficulty: 'NORMAL', mapVersion });
      assert.equal(roomOf(host).toState().mapVersion, mapVersion);
      await ok(host, { t: 'room.leave' });
    }
  }
});

test('clone rooms: only host can switch before start; ready resets, directory and match agree', async () => {
  const a = await player('Host'), b = await player('Member'), viewer = await player('Viewer');
  const room = await create(a);
  await ok(b, { t: 'room.join', code: room.code });
  await ok(b, { t: 'room.ready', ready: true });
  assert.equal(room.seatOf(b.id).ready, true);
  await denied(b, { t: 'room.setGameMode', gameMode: 'clone' }, 'NOT_HOST');
  await ok(a, { t: 'room.setGameMode', gameMode: 'clone' });
  assert.equal(room.seatOf(b.id).ready, false);
  assert.equal(room.toState().gameMode, 'clone');
  assert.equal((await directory(viewer))[0].gameMode, 'clone');
  await ok(viewer, { t: 'room.spectate', code: room.code });
  await denied(viewer, { t: 'room.setGameMode', gameMode: 'normal' }, 'NOT_HOST');
  await ok(a, { t: 'room.setGameMode', gameMode: 'normal' });
  await ok(a, { t: 'room.setGameMode', gameMode: 'clone' });
  await ok(b, { t: 'room.ready', ready: true });
  await ok(a, { t: 'room.start' });
  assert.equal(room.match.gameMode, 'clone');
  await denied(a, { t: 'room.setGameMode', gameMode: 'normal' }, 'ROOM_STARTED');
  assert.equal(validateC2S({ t: 'room.setGameMode', gameMode: 'other' }), 'bad field gameMode');
});

test('directory publishes only explicit public co-op rooms; private codes still invite and chat', async () => {
  const a = await player('公开房主'), b = await player('私有房主'), viewer = await player('路人');
  const publicRoom = await create(a), privateRoom = await create(b, 'private');
  await ok(viewer, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY' });
  let list = await directory(viewer);
  assert.deepEqual(list.map((r) => r.code), [publicRoom.code]);
  assert.equal(list[0].description, publicRoom.description);
  assert.equal(list[0].recruitment, undefined);
  assert.deepEqual(Object.keys(list[0]).sort(), ['capacity','code','createdAt','description','difficulty','gameMode','inMatch','mapVersion','name','occupied','spectatorCount'].sort());
  await ok(viewer, { t: 'room.join', code: privateRoom.code });
  await ok(viewer, { t: 'room.chat', text: '私有也能聊' });
  await b.waitFor('room.chat', (m) => m.message.text === '私有也能聊');
  await ok(a, { t: 'room.setVisibility', visibility: 'private' });
  list = await directory(viewer); assert.equal(list.length, 0); // cache invalidates immediately
  await ok(a, { t: 'room.chat', text: '切换后也能聊' });
  assert.equal(publicRoom.chatEnabled, true);
});

test('recruitment uses saved description only; one post per room, authoritative ten-second cooldown', async () => {
  const a = await player('房主'), viewer = await player('路人'); const room = await create(a);
  await ok(a, { t: 'room.recruit', text: '伪造招募应忽略' });
  let list = await directory(viewer); assert.equal(list[0].recruitment.text, room.description);
  const postedAt = list[0].recruitment.at;
  await denied(a, { t: 'room.recruit' }, 'RATE');
  await ok(a, { t: 'room.setDescription', description: '休闲\n阵容交流 <img onerror=x>' });
  list = await directory(viewer);
  assert.equal(list[0].recruitment.text, '休闲 阵容交流 <img onerror=x>');
  assert.equal(list[0].recruitment.at, postedAt);
  await ok(a, { t: 'room.setVisibility', visibility: 'private' });
  await denied(a, { t: 'room.recruit' }, 'WRONG_PHASE');
  await ok(a, { t: 'room.setVisibility', visibility: 'public' });
  assert.equal((await directory(viewer))[0].recruitment, undefined);
  await denied(a, { t: 'room.recruit' }, 'RATE');
  clock += 9999; await denied(a, { t: 'room.recruit' }, 'RATE');
  clock++; await ok(a, { t: 'room.recruit' });
  list = await directory(viewer); assert.equal(list.length, 1); assert.equal(list[0].recruitment.at, clock);
});

test('host permissions, migration, reconnect, full rooms and disposal preserve discovery rules', async () => {
  const a = await player('A'), b = await player('B'), viewer = await player('路人'); const room = await create(a);
  await ok(b, { t: 'room.join', code: room.code });
  for (const msg of [{ t: 'room.setVisibility', visibility: 'private' }, { t: 'room.setMapVersion', mapVersion: 'classic' },
    { t: 'room.setDescription', description: '乱改' }, { t: 'room.recruit' }]) await denied(b, msg, 'NOT_HOST');
  await ok(a, { t: 'room.recruit' });
  await a.terminate(); await b.waitFor('room.state', (m) => m.seats[0]?.connected === false);
  assert.equal((await directory(viewer)).length, 0);
  const resumed = await player('A', a.token); assert.equal(resumed.id, a.id);
  assert.equal((await directory(viewer)).length, 1);
  await denied(resumed, { t: 'room.recruit' }, 'RATE');
  await ok(resumed, { t: 'room.leave' }); assert.equal(room.hostId, b.id);
  await denied(b, { t: 'room.recruit' }, 'RATE');
  for (let i = 0; i < 3; i++) await ok(b, { t: 'room.addBot' });
  let list = await directory(viewer); assert.equal(list[0].occupied, 4); assert.equal(list[0].recruitment, undefined);
  clock += 10000; await denied(b, { t: 'room.recruit' }, 'ROOM_FULL');
  await ok(b, { t: 'room.leave' }); assert.equal((await directory(viewer)).length, 0);
});

test('five-to-eight player creation still requires warning acceptance; map appearance reaches the match and replay', async () => {
  const a = await player('A'), viewer = await player('路人');
  await denied(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8, visibility: 'public', description: '8人休闲' }, 'BAD_MSG');
  const room = await create(a, 'public', 8);
  await ok(a, { t: 'room.setMapVersion', mapVersion: 'classic' });
  assert.equal((await directory(viewer))[0].mapVersion, 'classic');
  await ok(a, { t: 'room.recruit' }); await ok(a, { t: 'room.start' });
  assert.equal(room.match.mapVersion, 'classic');
  assert.equal((await directory(viewer))[0].inMatch, true);
  assert.equal((await directory(viewer))[0].recruitment, undefined);
  await denied(a, { t: 'room.setMapVersion', mapVersion: 'new' }, 'ROOM_STARTED');
  await denied(a, { t: 'room.setVisibility', visibility: 'private' }, 'ROOM_STARTED');
  await ok(a, { t: 'g.infoReady' });
  assert.equal(room.match, null); assert.equal(room.toState().mapVersion, 'classic');
  assert.equal((await directory(viewer))[0].recruitment, undefined);
  const match = new Match({ roomCode: 'ABCD', mode: 'coop', difficulty: 'FUNNY', mapVersion: 'classic', seats: [{ seat: 0, playerId: 'one', name: 'A' }], data: srv.lobby.safeData(), send() {}, broadcast() {}, onEnd() {} });
  try { assert.equal(match.publicView().mapVersion, 'classic'); } finally { match.dispose(); }
  const previous = globalThis.location; globalThis.location = { search: '?board=3d' };
  try {
    assert.equal(boardPreference(boardAppearance('new').board), '3d');
    assert.equal(boardAppearance('new').boardArt, false);
    globalThis.location.search = '?board=2d';
    assert.equal(boardPreference(boardAppearance('classic').board), '2d');
    assert.equal(boardAppearance('classic').boardArt, true);
  } finally { globalThis.location = previous; }
});

test('protocol rejects invalid visibility, maps and oversized/invisible descriptions', () => {
  for (const msg of [{ t: 'room.setVisibility', visibility: 'friends' }, { t: 'room.setMapVersion', mapVersion: 'other' },
    ...['', '\u200b', 'a'.repeat(RECRUIT_MAX_LEN + 1), null].map((description) => ({ t: 'room.setDescription', description }))]) assert.notEqual(validateC2S(msg), null);
  assert.equal(validateC2S({ t: 'room.recruit' }), null);
});

test('directory refreshes share the expensive-response rate limit', async () => {
  const viewer = await player('路人');
  for (let i = 0; i < 6; i++) await directory(viewer);
  await denied(viewer, { t: 'room.list' }, 'RATE');
});
