// A timer-drift estimate, not a profiler. Piggybacks bounded numbers on the existing heartbeat.
// Hidden tabs / visibility transitions are excluded so browser timer throttling is not blamed on the server.
export class LagMonitor {
  constructor({ now, timers, doc = globalThis.document } = {}) {
    this.now = now; this.timers = timers; this.doc = doc; this.timer = null;
    this.stallMs = 0; this.lastRtt = null; this.sent = new Map();
    this.onVisibility = () => { this.lastAt = this.now(); this.wasVisible = false; this.stallMs = 0; this.lastRtt = null; this.sent.clear(); };
  }
  visible() { return !this.doc?.hidden; }
  start() {
    this.stop(); this.lastAt = this.now(); this.wasVisible = this.visible();
    this.doc?.addEventListener?.('visibilitychange', this.onVisibility);
    this.timer = this.timers.setInterval(() => {
      const at = this.now(), visible = this.visible();
      if (visible && this.wasVisible) this.stallMs = Math.max(this.stallMs, Math.min(60_000, Math.max(0, at - this.lastAt - 1000)));
      else this.stallMs = 0;
      this.lastAt = at; this.wasVisible = visible;
    }, 1000);
  }
  probe(c) { this.sent.set(c, this.visible()); if (this.sent.size > 8) this.sent.delete(this.sent.keys().next().value); }
  pong(c, rtt) {
    const visible = this.sent.get(c) === true && this.visible(); this.sent.delete(c);
    this.lastRtt = { at: this.now(), rtt, visible };
  }
  report(queueBytes = 0) {
    const previous = this.lastRtt, ageMs = previous ? this.now() - previous.at : Infinity;
    const visible = this.visible() && previous?.visible === true && ageMs >= 0 && ageMs <= 10_000;
    const report = { visible, stallMs: visible ? Math.round(this.stallMs) : 0,
      queueBytes: Math.min(16 << 20, Math.max(0, Math.round(Number(queueBytes) || 0))) };
    if (visible) { report.rttMs = Math.min(60_000, Math.round(previous.rtt)); report.ageMs = Math.round(ageMs); }
    this.stallMs = 0; return report;
  }
  stop() {
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.doc?.removeEventListener?.('visibilitychange', this.onVisibility);
    this.timer = null; this.stallMs = 0; this.sent.clear(); this.lastRtt = null;
  }
}
