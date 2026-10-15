import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PerformanceStats, PERF_LIMITS } from '../server/performance.js';
import { TrafficStats, httpCategory } from '../server/traffic.js';
import { Network, SessionRegistry, NET_DEFAULTS, sendRaw } from '../server/net.js';
import { validateC2S } from '../shared/protocol.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

function rig() {
  let at = 1000, usage = { user: 0, system: 0 };
  const warnings = [], loop = { max: 0, enable() {}, disable() { this.disabled = true; }, percentile() { return this.max; }, reset() { this.max = 0; } };
  const traffic = new TrafficStats({ now: () => at });
  let net = { queueMaxBytes: 0, rttMaxMs: 0, clientReports: 0 };
  const monitor = new PerformanceStats({ traffic, network: { performanceSample: () => net }, counts: () => ({ onlinePlayers: 260 }),
    now: () => at, cpu: () => usage, loop, utilization: () => ({ utilization: .2 }), log: { warn: s => warnings.push(s) }, autoStart: false });
  return { monitor, loop, traffic, warnings, advance(ms, values = {}) { at += ms; net = { queueMaxBytes: 0, rttMaxMs: 0, clientReports: 0, ...values }; usage = { user: usage.user + ms * 500, system: 0 }; return monitor.sample(); } };
}

test('one-second rates retain spikes that the minute average hides; monitor traffic is excluded', () => {
  const r = rig();
  r.traffic.add('images', 'outBytes', 1_000_000); r.traffic.add('monitor', 'outBytes', 99_000_000);
  const row = r.advance(1000);
  assert.equal(row.outMbps, 8); assert.equal(row.cpuPercent, 50); assert.equal(row.online, 260);
  r.advance(1000); assert.equal(r.monitor.snapshot().latest.outMbps, 0); assert.equal(r.monitor.snapshot().peak60.outMbps, 8);
  assert.equal(r.monitor.snapshot().incidents.length, 0); r.monitor.close();
});

test('stalls, queues and player RTT leave bounded incidents and a rate-limited aggregate log', () => {
  const r = rig(); r.loop.max = 600e6;
  r.advance(1500, { queueMaxBytes: 70_000, skippedSnapshots: 5, clientReports: 2, rttMaxMs: 2300, clientStallMaxMs: 200 });
  r.advance(1000, { queueMaxBytes: 80_000, skippedSnapshots: 3, clientReports: 2, rttMaxMs: 3000 });
  const s = r.monitor.snapshot();
  assert.equal(s.incidentCount, 1); assert.equal(s.incidents[0].rttMaxMs, 3000); assert.equal(s.incidents[0].skippedSnapshots, 8);
  assert.deepEqual(s.incidents[0].reasons, ['server-stall', 'send-queue', 'player-latency', 'client-stall']);
  assert.equal(r.warnings.length, 1);
  r.advance(30_000, { clientReports: 1, rttMaxMs: 1000 }); assert.equal(r.warnings.length, 2);
  for (let i = 0; i < 300; i++) r.advance(30_000, { clientReports: 1, rttMaxMs: 1000 });
  assert.equal(r.monitor.snapshot({ history: true }).samples.length, PERF_LIMITS.history);
  assert.equal(r.monitor.snapshot({ history: true }).incidents.length, PERF_LIMITS.incidents);
  assert.equal(r.monitor.snapshot().incidents.length, 10);
  const last = r.monitor.snapshot().latest;
  r.monitor.close(); assert.equal(r.loop.disabled, true); assert.equal(r.monitor.sample(), null); assert.deepEqual(r.monitor.snapshot().latest, last);
});

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames = []; terminated = false;
  send(data, done) { this.frames.push(JSON.parse(data)); done?.(); }
  close() { this.readyState = 3; }
  terminate() { this.terminated = true; this.readyState = 3; }
}

test('congested connections skip pictures early while critical replies and form events survive', () => {
  const ws = new Socket(), net = new Network({ registry: new SessionRegistry(), handler: {}, options: {} });
  try {
    net.handleConnection(ws); ws.bufferedAmount = NET_DEFAULTS.snapDropBytes - 5;
    assert.equal(sendRaw(ws, '{"t":"b.snap","gt":1}', { droppable: true }), false);
    assert.equal(sendRaw(ws, '{"t":"pong","c":1}'), true);
    assert.equal(sendRaw(ws, '{"t":"b.ev","ev":[["fx","form",0,0,{"id":1,"form":null}]]}'), true);
    assert.equal(sendRaw(ws, '{"t":"m.private","shop":[]}'), true);
    assert.deepEqual(ws.frames.map(r => r.t), ['pong', 'b.ev', 'm.private']);
    assert.equal(net.performanceSample().skippedSnapshots, 1); assert.equal(net.performanceSample().skippedSnapshots, 0);
    ws.bufferedAmount = 0;
    assert.equal(sendRaw(ws, JSON.stringify({ t: 'b.snap', large: 'x'.repeat(100_000) }), { droppable: true }), true, 'an isolated big field is still deliverable');
    ws.bufferedAmount = NET_DEFAULTS.hardBufferBytes + 1;
    assert.equal(sendRaw(ws, '{"t":"pong","c":2}'), false); assert.equal(ws.terminated, true);
  } finally { net.close(); }
});

test('foreground diagnostic samples expire, background probes and anonymous connections are excluded', () => {
  let at = 10_000;
  const ws = new Socket(), net = new Network({ registry: new SessionRegistry(), handler: {}, now: () => at });
  try {
    net.handleConnection(ws); const conn = net.conns.get(ws);
    const d = { visible: true, rttMs: 1800, ageMs: 0, stallMs: 0, queueBytes: 100 };
    net.onFrame(conn, Buffer.from(JSON.stringify({ t: 'ping', c: 1, diagnostics: d })), false);
    assert.equal(net.performanceSample(at).clientReports, 0);
    conn.session = { connected: true, ws };
    assert.equal(net.performanceSample(at).rttMaxMs, 1800);
    at += 10_001; assert.equal(net.performanceSample(at).clientReports, 0);
    net.onFrame(conn, Buffer.from(JSON.stringify({ t: 'ping', c: 2, diagnostics: { ...d, visible: false } })), false);
    assert.equal(net.performanceSample(at).clientReports, 0);
    assert.equal(ws.frames.at(-1).t, 'pong');
    assert.deepEqual(Object.keys(ws.frames.at(-1)).sort(), ['c', 's', 't']);
  } finally { net.close(); }
});

test('heartbeat diagnostics are optional, validated and bounded', () => {
  assert.equal(validateC2S({ t: 'ping', c: 1 }), null);
  const base = { visible: true, rttMs: 900, ageMs: 0, stallMs: 50, queueBytes: 0 };
  assert.equal(validateC2S({ t: 'ping', c: 1, diagnostics: base }), null);
  for (const field of ['rttMs', 'ageMs', 'stallMs', 'queueBytes']) {
    for (const value of [-1, Infinity, NaN, '10', 1e10]) assert.notEqual(validateC2S({ t: 'ping', c: 1, diagnostics: { ...base, [field]: value } }), null);
  }
  assert.equal(validateC2S({ t: 'ping', c: 1, diagnostics: { visible: false, stallMs: 0, queueBytes: 0 } }), null);
  assert.ok(Buffer.byteLength(JSON.stringify({ t: 'ping', c: Date.now(), diagnostics: base })) < 200, 'piggyback costs at most 50 B/s per visible player at the existing 4 s heartbeat');
});

test('statistics expose aggregate diagnostics, preserve old health checks and clean up their timer', async t => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(async () => { await c.close(); await srv.close(); });
  await c.hello('不能出现在诊断里的姓名');
  const report = { visible: true, rttMs: 2400, ageMs: 0, stallMs: 120, queueBytes: 0 };
  assert.equal((await c.request({ t: 'ping', c: Date.now(), diagnostics: report })).t, 'pong');
  await new Promise(resolve => setTimeout(resolve, 1050));
  const response = await fetch(srv.url + '/stats-data'), data = await response.json();
  assert.equal(data.performance.latest.rttMaxMs, 2400); assert.equal(data.performance.latest.clientReports, 1);
  assert.equal(data.performance.incidents[0].reasons.includes('player-latency'), true);
  assert.equal((await (await fetch(srv.url + '/healthz')).json()).performance, undefined);
  const dump = await fetch(srv.url + '/diagnostics-data'); assert.equal(dump.headers.get('cache-control'), 'no-store');
  assert.match(dump.headers.get('content-disposition'), /attachment/);
  const body = await dump.text(); assert.ok(JSON.parse(body).performance.samples.length);
  for (const secret of ['不能出现在诊断里的姓名', c.welcome?.token].filter(Boolean)) assert.ok(!body.includes(secret));
  assert.equal(httpCategory('/diagnostics-data'), 'monitor');
  await srv.close(); assert.equal(srv.performanceStats.timer, null); assert.equal(srv.performanceStats.closed, true);
});
