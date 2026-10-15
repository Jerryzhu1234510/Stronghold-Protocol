import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LagMonitor } from '../public/js/lagMonitor.js';

function rig() {
  let at = 1000, callback = null; const events = new Map();
  const doc = { hidden: false, addEventListener(k, fn) { events.set(k, fn); }, removeEventListener(k) { events.delete(k); } };
  const timers = { setInterval(fn) { callback = fn; return 1; }, clearInterval() { callback = null; } };
  const m = new LagMonitor({ now: () => at, timers, doc }); m.start();
  return { m, doc, events, at(ms, tick = false) { at = ms; if (tick) callback?.(); }, tick() { callback?.(); }, callback: () => callback };
}
test('foreground stalls and measured RTT ride the next heartbeat without a second network timer', () => {
  const r = rig(); r.m.probe(1000); r.at(2300); r.m.pong(1000, 1300); r.at(2600, true);
  assert.deepEqual(r.m.report(123), { visible: true, rttMs: 1300, ageMs: 300, stallMs: 600, queueBytes: 123 });
  assert.equal(r.m.report().stallMs, 0); r.m.stop(); assert.equal(r.callback(), null); assert.equal(r.events.size, 0);
});
test('background throttling, visibility changes and stale pongs cannot become foreground incidents', () => {
  const r = rig(); r.m.probe(1000); r.doc.hidden = true; r.events.get('visibilitychange')();
  r.at(60_000, true); r.m.pong(1000, 59_000); assert.equal(r.m.report().visible, false);
  r.doc.hidden = false; r.events.get('visibilitychange')(); r.at(61_000, true);
  assert.equal(r.m.report().stallMs, 0); assert.equal(r.m.report().visible, false);
  r.m.probe(61_000); r.at(61_050); r.m.pong(61_000, 50); assert.equal(r.m.report().visible, true);
  r.at(80_000); assert.equal(r.m.report().visible, false); r.m.stop();
});
test('probe history and reported numbers are bounded and restart clears the previous connection', () => {
  const r = rig(); for (let i = 0; i < 100; i++) r.m.probe(i); assert.equal(r.m.sent.size, 8);
  assert.equal(r.m.report(1e12).queueBytes, 16 << 20); r.m.start(); assert.equal(r.m.sent.size, 0); assert.equal(r.m.lastRtt, null); r.m.stop();
});
