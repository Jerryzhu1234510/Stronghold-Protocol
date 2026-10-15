import { createServer } from 'node:http';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { once } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { fork } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';
import { StateEncoder, StateDecoder } from '../shared/stateDelta.js';
import { websocketCompression } from '../server/http/websocket.js';
import { makeMatch } from '../test/match/harness.js';

const mode = process.argv[2];
if (!mode) {
  const results = [];
  for (const scenario of ['full', 'delta', 'delta-compressed']) {
    const child = fork(new URL(import.meta.url), [scenario], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', result => results.push(result));
    const [code] = await once(child, 'exit'); assert.equal(code, 0);
  }
  await mkdir('../../outputs/performance-r18', { recursive: true });
  await writeFile('../../outputs/performance-r18/transport-benchmark.json', JSON.stringify({
    note: 'Local loopback replay of real eight-player match state. CPU includes server, decoder and clients; not production bandwidth or FPS.', results,
  }, null, 2));
  console.log(JSON.stringify(results));
} else {
  const fixtures = [], h = makeMatch({ humans: 8, capacity: 8, fake: true, instant: true });
  const capture = msg => { if (['m.public', 'm.private'].includes(msg.t)) fixtures.push(JSON.parse(JSON.stringify(msg))); };
  h.onBroadcast.push(capture); h.onSend.push((id, msg) => { if (id === 'p_0') capture(msg); });
  h.autoHumans().start(); h.runToEnd(); h.m.dispose();
  const perClient = fixtures.map(msg => Array.from({ length: 64 }, (_, i) => msg.t === 'm.private' ? { ...msg, playerId: `bench_${i}` } : msg));
  const http = createServer(), wss = new WebSocketServer({ server: http,
    perMessageDeflate: mode === 'delta-compressed' ? websocketCompression() : false });
  const sockets = [];
  wss.on('connection', ws => sockets.push(ws));
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const clients = [], received = [];
  // 64 connections, 20 state updates/second each (public + private), for 5 seconds.
  for (let i = 0; i < 64; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}`), dec = new StateDecoder();
    let index = 0;
    ws.on('message', raw => {
      const actual = dec.decode(JSON.parse(raw)); assert.deepEqual(actual, perClient[index % fixtures.length][i]); index++;
    });
    await once(ws, 'open'); clients.push(ws); received.push(() => index);
  }
  const encoders = sockets.map(() => new StateEncoder()), bytes0 = sockets.map(ws => ws._socket.bytesWritten);
  const loop = monitorEventLoopDelay({ resolution: 5 }); loop.enable();
  const cpu0 = process.cpuUsage(), started = performance.now();
  let peakRss = process.memoryUsage().rss, peakQueue = 0, pings = [], tick = 0;
  for (; tick < 100; tick++) {
    const messages = perClient[tick % fixtures.length];
    const publicJson = messages[0].t === 'm.public' ? JSON.stringify(messages[0]) : null;
    for (let i = 0; i < sockets.length; i++) {
      const msg = messages[i], json = publicJson || JSON.stringify(msg);
      const frame = mode === 'full' ? { data: json, commit() {} } : encoders[i].prepare(msg, json);
      sockets[i].send(frame.data); frame.commit(); peakQueue = Math.max(peakQueue, sockets[i].bufferedAmount);
    }
    if (tick % 10 === 0) {
      const ws = clients[0], sent = performance.now();
      ws.once('pong', () => pings.push(performance.now() - sent)); ws.ping();
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, started + (tick + 1) * 50 - performance.now())));
  }
  const deadline = performance.now() + 5000;
  while (received.some(n => n() < tick) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(received.every(n => n() === tick), 'all states arrived and decoded exactly');
  const elapsed = performance.now() - started, cpu = process.cpuUsage(cpu0); loop.disable();
  const result = { mode, clients: 64, messages: tick * 64, fixtureCount: fixtures.length,
    wireBytes: sockets.reduce((sum, ws, i) => sum + ws._socket.bytesWritten - bytes0[i], 0),
    elapsedMs: Math.round(elapsed), cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    peakRssMB: Math.round(peakRss / 1048576), peakQueueBytes: peakQueue,
    loopP99Ms: +(loop.percentile(99) / 1e6).toFixed(2), loopMaxMs: +(loop.max / 1e6).toFixed(2),
    pingMaxMs: +Math.max(...pings).toFixed(2), allStatesExact: true,
    negotiatedCompression: clients[0].extensions || 'none' };
  for (const ws of clients) ws.terminate();
  await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => http.close(resolve));
  process.send(result);
}
