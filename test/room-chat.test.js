import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { CHAT_MAX_LEN, CHAT_HISTORY_LIMIT, sanitizeChat } from '../shared/chat.js';
import { emptyChat, receiveChat, latestFriendMessage, latestChatPreview, chatPosition, chatAnchor, normalizeChatAnchor } from '../public/js/ui/chatState.js';

let srv, clients, clock;
beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
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
async function friend(c, mode = 'coop') {
  await ok(c, { t: 'room.create', mode, difficulty: 'FUNNY' });
  return roomOf(c);
}
async function join(c, room) { await ok(c, { t: 'room.join', code: room.code }); }

test('protocol accepts Unicode and rejects empty, invisible, oversized and non-text chat', () => {
  for (const text of ['你好', '😀'.repeat(CHAT_MAX_LEN), '<img onerror=alert(1)>']) assert.equal(validateC2S({ t: 'room.chat', text }), null);
  for (const text of ['', '  ', '\u200b\u202e\u0000', '😀'.repeat(CHAT_MAX_LEN + 1), 'a'.repeat(CHAT_MAX_LEN + 1), null, 12])
    assert.notEqual(validateC2S({ t: 'room.chat', text }), null);
  assert.equal(sanitizeChat('  你\n好\u202e\u0000 😀\ud800  '), '你 好 😀');
  assert.equal(sanitizeChat('👨‍👩‍👧'), '👨‍👩‍👧');
});

test('friend-room chat works before start and server supplies identity; other rooms never receive it', async () => {
  const a = await player('房主'), b = await player('队友'), outside = await player('路人'), other = await player('别的房主');
  const room = await friend(a); await join(b, room); await friend(other);
  assert.equal((await a.waitFor('room.state')).chatEnabled, true);
  await a.waitFor('room.chatHistory', (m) => m.messages.length === 0);
  assert.equal(room.match, null);
  await ok(a, { t: 'room.chat', text: '你好\n<img onerror=alert(1)>', playerId: b.id, name: '伪造', code: roomOf(other).code, at: 1 });
  const received = await b.waitFor('room.chat');
  assert.equal(received.code, room.code);
  assert.deepEqual(received.message, { id: 1, playerId: a.id, name: '房主', text: '你好 <img onerror=alert(1)>', at: clock });
  await a.waitFor('room.chat', (m) => m.message.id === 1);
  await Promise.all([other.expectNone('room.chat'), outside.expectNone('room.chat')]);
  await denied(outside, { t: 'room.chat', text: '试图发言' }, ERR.NOT_IN_ROOM);
});

test('solo and matchmaking rooms cannot chat, including during and after a matched game', async () => {
  const solo = await player('单人'); await friend(solo, 'solo');
  assert.equal(roomOf(solo).toState().chatEnabled, undefined);
  await denied(solo, { t: 'room.chat', text: '单人' }, ERR.WRONG_PHASE);
  const people = await Promise.all(['A', 'B', 'C', 'D'].map((n) => player(n)));
  await ok(people[0], { t: 'room.matchmake', difficulty: 'FUNNY' });
  const room = roomOf(people[0]);
  await denied(people[0], { t: 'room.chat', text: '等待' }, ERR.WRONG_PHASE);
  for (const c of people.slice(1)) await ok(c, { t: 'room.matchmake', difficulty: 'FUNNY' });
  assert.ok(room.match); assert.equal(room.chatEnabled, false);
  await denied(people[0], { t: 'room.chat', text: '局内' }, ERR.WRONG_PHASE);
  for (const c of people) await ok(c, { t: 'g.infoReady' });
  assert.equal(room.match, null); assert.equal(room.matchmaking, false); assert.equal(room.chatEnabled, false);
  await denied(people[0], { t: 'room.chat', text: '结束后' }, ERR.WRONG_PHASE);
  assert.equal(room.chatMessages.length, 0);
  for (const c of people) assert.equal(c.log.some((m) => m.t === 'room.chatHistory' || m.t === 'room.chat'), false);
});

test('chat survives start, result, host migration and spectator membership', async () => {
  const a = await player('A'), b = await player('B'), spectator = await player('观战');
  const room = await friend(a); await join(b, room);
  await ok(spectator, { t: 'room.spectate', code: room.code });
  await ok(b, { t: 'room.ready', ready: true }); await ok(a, { t: 'room.start' });
  await ok(a, { t: 'room.chat', text: '开局了' }); await spectator.waitFor('room.chat', (m) => m.message.text === '开局了');
  await ok(spectator, { t: 'room.chat', text: '加油' }); await b.waitFor('room.chat', (m) => m.message.text === '加油');
  for (const c of [a, b]) await ok(c, { t: 'g.infoReady' });
  clock += 1000; await ok(b, { t: 'room.chat', text: '下一局' });
  await ok(a, { t: 'room.leave' }); assert.equal(room.hostId, b.id); assert.equal(room.chatEnabled, true);
  clock += 1000; await ok(b, { t: 'room.chat', text: '我来开' });
  assert.deepEqual(room.chatMessages.map((m) => m.text), ['开局了', '加油', '下一局', '我来开']);
});

test('cooldown persists through reconnection; history is sent to the returning player only', async () => {
  const a = await player('A'), b = await player('B'); const room = await friend(a); await join(b, room);
  await ok(a, { t: 'room.chat', text: '一' });
  await denied(a, { t: 'room.chat', text: '二' }, ERR.RATE);
  await a.terminate(); await b.waitFor('room.state', (m) => m.seats.some((s) => s?.playerId === a.id && !s.connected));
  b.clearInbox(); const resumed = await player('A', a.token); assert.equal(resumed.id, a.id);
  const history = await resumed.waitFor('room.chatHistory'); assert.equal(history.messages[0].text, '一');
  await denied(resumed, { t: 'room.chat', text: '重连刷屏' }, ERR.RATE);
  clock += 999; await denied(resumed, { t: 'room.chat', text: '还差一毫秒' }, ERR.RATE);
  clock++; await ok(resumed, { t: 'room.chat', text: '二' });
  await b.expectNone('room.chatHistory');
  assert.equal(room.chatMessages.length, 2);
});

test('late joins receive only the newest 50 messages and no history is attached to ordinary state broadcasts', async () => {
  const people = await Promise.all(['A', 'B', 'C'].map((n) => player(n))); const room = await friend(people[0]);
  for (const c of people.slice(1)) await join(c, room);
  for (let i = 1; i <= CHAT_HISTORY_LIMIT + 5; i++) {
    clock += 1000; await ok(people[i % people.length], { t: 'room.chat', text: `消息${i}` });
  }
  assert.equal(room.chatMessages.length, CHAT_HISTORY_LIMIT);
  const late = await player('后来'); await join(late, room);
  const history = await late.waitFor('room.chatHistory');
  assert.equal(history.messages.length, CHAT_HISTORY_LIMIT);
  assert.equal(history.messages[0].text, '消息6'); assert.equal(history.messages.at(-1).text, '消息55');
  const before = people[0].log.filter((m) => m.t === 'room.chatHistory').length;
  await ok(late, { t: 'room.ready', ready: true });
  const state = await late.waitFor('room.state'); assert.equal(state.messages, undefined);
  assert.equal(people[0].log.filter((m) => m.t === 'room.chatHistory').length, before);
});

test('leaving, kicking and switching rooms immediately revoke access to the old chat', async () => {
  const a = await player('A'), b = await player('B'), c = await player('C'); const room = await friend(a); await join(b, room); await join(c, room);
  await ok(a, { t: 'room.kick', seat: 1, playerId: b.id });
  await denied(b, { t: 'room.chat', text: '被踢后' }, ERR.NOT_IN_ROOM);
  await friend(c); await ok(a, { t: 'room.chat', text: '旧房间' });
  await Promise.all([b.expectNone('room.chat'), c.expectNone('room.chat')]);
  await ok(a, { t: 'room.leave' }); assert.equal(srv.lobby.getRoom(room.code), null);
  await denied(a, { t: 'room.chat', text: '离开后' }, ERR.NOT_IN_ROOM);
});

test('client merges history and live events without duplicates, ignores stale rooms and bounds memory', () => {
  let state = { room: { code: 'ABCD', chatEnabled: true }, chat: emptyChat('ABCD') };
  const message = (id) => ({ id, name: 'A', text: `${id}`, at: id, playerId: 'A' });
  const live = (id) => ({ t: 'room.chat', code: 'ABCD', message: message(id) });
  state.chat = receiveChat(state, live(2)); state.chat = receiveChat(state, live(2)); assert.equal(state.chat.liveSeq, 1);
  state.chat = receiveChat(state, { t: 'room.chatHistory', code: 'ABCD', messages: [message(1), message(2)] });
  assert.deepEqual(state.chat.messages.map((m) => m.id), [1, 2]); assert.equal(state.chat.liveSeq, 1);
  assert.equal(receiveChat(state, { ...live(3), code: 'OTHER' }), state.chat);
  assert.equal(receiveChat({ ...state, room: { code: 'ABCD' } }, live(3)), state.chat);
  for (let id = 3; id <= 70; id++) state.chat = receiveChat(state, live(id));
  assert.equal(state.chat.messages.length, CHAT_HISTORY_LIMIT); assert.equal(state.chat.messages[0].id, 21);
});

test('collapsed preview uses latest teammate message from history or live updates, ignoring own replies and unread', () => {
  const state = { me: { playerId: 'me' }, room: { code: 'ABCD', chatEnabled: true }, chat: emptyChat('ABCD') };
  const message = (id, playerId, text) => ({ id, playerId, name: playerId, text, at: id });
  assert.equal(latestFriendMessage(state.chat.messages, 'me'), null);
  state.chat = receiveChat(state, { t: 'room.chatHistory', code: 'ABCD', messages: [message(2, 'B', '<hello>😀'), message(3, 'me', '我的回复'), message(1, 'A', '旧消息')] });
  assert.equal(latestFriendMessage(state.chat.messages, 'me').text, '<hello>😀');
  assert.equal(state.chat.liveSeq, 0);
  state.chat = receiveChat(state, { t: 'room.chat', code: 'ABCD', message: message(4, 'me', '再次回复') });
  assert.equal(state.chat.liveSeq, 0);
  assert.equal(latestFriendMessage(state.chat.messages, 'me').playerId, 'B');
  state.chat = receiveChat(state, { t: 'room.chat', code: 'ABCD', message: message(5, 'A', '最新队友消息') });
  assert.equal(state.chat.liveSeq, 1);
  assert.equal(latestFriendMessage(state.chat.messages, 'me').text, '最新队友消息');
});

test('single-player review previews our latest line until a teammate has spoken, without counting own lines as unread', () => {
  const state = { me: { playerId: 'me' }, room: { code: 'ABCD', chatEnabled: true }, chat: emptyChat('ABCD') };
  const message = (id, playerId, text) => ({ id, playerId, name: playerId, text, at: id });
  assert.equal(latestChatPreview([], 'me'), null);
  state.chat = receiveChat(state, { t: 'room.chat', code: 'ABCD', message: message(1, 'me', '自己测试聊天') });
  assert.equal(latestChatPreview(state.chat.messages, 'me').text, '自己测试聊天');
  assert.equal(state.chat.liveSeq, 0);
  state.chat = receiveChat(state, { t: 'room.chat', code: 'ABCD', message: message(2, 'me', '第二条测试') });
  assert.equal(latestChatPreview(state.chat.messages, 'me').text, '第二条测试');
  state.chat = receiveChat(state, { t: 'room.chat', code: 'ABCD', message: message(3, 'friend', '队友发来的消息') });
  state.chat = receiveChat(state, { t: 'room.chat', code: 'ABCD', message: message(4, 'me', '我回复队友') });
  assert.equal(latestChatPreview(state.chat.messages, 'me').text, '队友发来的消息');
  assert.equal(state.chat.liveSeq, 1);
});

test('floating chat stays inside resized viewports, even with a mobile keyboard or invalid saved preference', () => {
  const anchors = [null, { x: -5, y: 20 }, { x: NaN, y: Infinity }, { x: 0.4, y: 0.8 }];
  for (const view of [{ x: 0, y: 0, width: 1440, height: 900 }, { x: 0, y: 0, width: 375, height: 280 }, { x: 0, y: 120, width: 844, height: 250 }]) {
    const size = { width: Math.min(312, view.width - 16), height: Math.min(302, view.height - 16) };
    for (const anchor of anchors) {
      const p = chatPosition(anchor, size, view);
      assert.ok(p.x >= view.x + 8 && p.x + size.width <= view.x + view.width - 8);
      assert.ok(p.y >= view.y + 8 && p.y + size.height <= view.y + view.height - 8);
      const roundTrip = chatPosition(chatAnchor(p, size, view), size, view);
      assert.ok(Math.abs(roundTrip.x - p.x) < 0.001 && Math.abs(roundTrip.y - p.y) < 0.001);
    }
  }
  assert.deepEqual(normalizeChatAnchor({ x: -1, y: 2 }), { x: 0, y: 1 });
});
