import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startVersus } from '../../server/versus/index.js';

async function client(url) {
  const ws = new WebSocket(url), messages = [], waiting = [];
  ws.on('message', raw => {
    const value = JSON.parse(String(raw));
    const waiter = waiting.find(w => w.matches(value));
    if (waiter) { waiting.splice(waiting.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(value); }
    else { messages.push(value); if (messages.length > 100) messages.shift(); }
  });
  await once(ws, 'open');
  return { ws, send: (action, args = {}) => ws.send(JSON.stringify({ action, ...args })),
    next: (type, match = () => true) => new Promise((resolve, reject) => {
      const matches = v => v.type === type && match(v), i = messages.findIndex(matches);
      if (i >= 0) { resolve(messages.splice(i, 1)[0]); return; }
      const waiter = { matches, resolve, timer: null };
      waiter.timer = setTimeout(() => { waiting.splice(waiting.indexOf(waiter), 1); reject(new Error(`Timed out waiting for ${type}`)); }, 5000);
      waiting.push(waiter);
    }),
  };
}
test('real WebSocket defaults to self, switches defender by avatar intent, validates focus and reconnects to self', async () => {
  const service = await startVersus({ port: 0 }), sockets = [];
  const url = `ws://127.0.0.1:${service.server.address().port}/versus/socket`;
  try {
    const a = await client(url); sockets.push(a.ws); a.send('create', { name: '房主' });
    const joined = await a.next('joined'); assert.ok(joined.token.length >= 40);
    const b = await client(url); sockets.push(b.ws); b.send('join', { code: joined.code, name: '队友' });
    const second = await b.next('joined'); assert.notEqual(joined.playerId, second.playerId);
    b.send('start', { fillAI: true }); assert.match((await b.next('error')).message, /房主/);
    a.send('start', { fillAI: true }); await a.next('state', s => s.room.status === 'info');
    a.send('infoReady'); b.send('infoReady');
    const state = await a.next('state', s => s.room.status === 'preparation');
    assert.equal(state.room.players.length, 4); assert.equal(state.room.duels.length, 2); assert.ok(state.field.meta.fieldId);
    assert.equal(state.field.playerId, joined.playerId);
    const opponent = state.room.duels.find(d => d.id === state.field.duelId).players.find(id => id !== joined.playerId);
    a.send('watch', { id: state.field.duelId, playerId: opponent });
    const watched = await a.next('state', s => s.field?.playerId === opponent);
    assert.equal(watched.field.side, state.field.side);
    assert.equal(watched.field.meta.fieldId, state.field.meta.fieldId);
    a.send('watch', { id: state.field.duelId, playerId: 'forged' });
    assert.match((await a.next('error')).message, /不在/);
    b.send('deploy', { uid: 999, row: 4, col: 5 }); assert.match((await b.next('error')).message, /待部署|只有守方/);
    a.ws.close(); await once(a.ws, 'close');
    const resumed = await client(url); sockets.push(resumed.ws); resumed.send('resume', { token: joined.token });
    assert.equal((await resumed.next('joined')).playerId, joined.playerId);
    const fresh = await resumed.next('state'); assert.equal(fresh.me.id, joined.playerId); assert.ok(fresh.field.snapshot);
    assert.equal(fresh.field.playerId, joined.playerId);
    const bad = await client(url); sockets.push(bad.ws); bad.send('resume', { token: 'forged' }); assert.match((await bad.next('error')).message, /失效/);
    const html = await fetch(service.url).then(r => r.text()); assert.match(html, /versus\/app.js/);
  } finally { for (const ws of sockets) ws.terminate(); await service.close(); }
});
