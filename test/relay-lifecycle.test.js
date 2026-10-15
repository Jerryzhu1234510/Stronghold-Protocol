import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createRequire } from 'node:module';
import { SessionCap, createCappedUpgradeHandler } from '../deploy/8443-front/resource-desktop-r01/session-cap.mjs';

test('released relay seat cannot be revived by a delayed welcome', () => {
  const cap = new SessionCap({ limit: 0 });
  const lease = cap.reserve(null, '/ws');
  cap.confirm(lease, 'fixture-token', '/ws');
  assert.equal(cap.status().online, 1);
  cap.release(lease);
  cap.confirm(lease, 'late-token', '/ws');
  assert.equal(cap.status().online, 0);
});

test('disconnect during admission cancels queued hello while a live peer keeps working', async () => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let release, seen;
  const barrier = new Promise(resolve => { release = resolve; });
  const checking = new Promise(resolve => { seen = resolve; });
  const backend = http.createServer(), bws = new WebSocketServer({ server: backend });
  let serial = 0;
  bws.on('connection', ws => ws.on('message', (body, binary) => {
    if (binary) { ws.send(body, { binary: true }); return; }
    const message = JSON.parse(body);
    ws.send(JSON.stringify(message.t === 'hello' ? { t: 'welcome', token: `fixture-${++serial}` } : { t: 'ok', rid: message.rid }));
  }));
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const cap = new SessionCap({ limit: 0, graceMs: 0 });
  const upgrade = createCappedUpgradeHandler({ host: '127.0.0.1', port: backend.address().port,
    wsModule: createRequire(import.meta.url).resolve('ws'), cap,
    authorizeNewRoom: async () => { seen(); await barrier; return true; } });
  const proxy = http.createServer(); proxy.on('upgrade', upgrade);
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${proxy.address().port}/_build/fixture/ws`, clients = [];
  const connect = async () => { const ws = new WebSocket(url); clients.push(ws); await once(ws, 'open'); return ws; };
  try {
    const control = await connect(), welcome = once(control, 'message');
    control.send(JSON.stringify({ t: 'hello', name: 'fixture' })); await welcome;
    const racing = await connect();
    racing.send(JSON.stringify({ t: 'room.ready', rid: 1 }));
    racing.send(JSON.stringify({ t: 'hello', name: 'closed-fixture' }));
    await checking;
    const closed = once(racing, 'close'); racing.close(); await closed; await pause(30);
    release(); await pause(100);
    assert.equal(bws.clients.size, 1); assert.equal(cap.status().online, 1);
    assert.equal(control.readyState, WebSocket.OPEN);
    const echo = once(control, 'message'), bytes = Buffer.alloc(12000, 31);
    control.send(bytes, { binary: true }); const response = await echo;
    assert.equal(response[1], true); assert.deepEqual(response[0], bytes);
    const ack = once(control, 'message'); control.send(JSON.stringify({ t: 'room.ready', rid: 17 }));
    assert.equal(JSON.parse((await ack)[0]).rid, 17);
  } finally {
    release(); for (const client of clients) client.terminate(); upgrade.close();
    for (const ws of bws.clients) ws.terminate();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => backend.close(resolve))]); bws.close();
  }
});
