// One bounded, process-local sample per second. No names, IPs, tokens, room IDs or message bodies.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import os from 'node:os';

export const PERF_LIMITS = Object.freeze({ sampleMs: 1000, history: 120, incidents: 64, loopMs: 100, rttMs: 500, clientStallMs: 100, queueBytes: 32 << 10 });
const finite = v => Number.isFinite(v) ? Math.max(0, v) : 0;
const rounded = v => Math.round(finite(v) * 100) / 100;
const peak = (rows, key) => rows.reduce((v, r) => Math.max(v, finite(r[key])), 0);

export class PerformanceStats {
  constructor({ traffic, network, counts = () => ({}), log = {}, now = Date.now, cpu = process.cpuUsage,
    loop = monitorEventLoopDelay({ resolution: 20 }), utilization = performance.eventLoopUtilization.bind(performance), autoStart = true } = {}) {
    this.traffic = traffic; this.network = network; this.counts = counts; this.log = log;
    this.now = now; this.cpu = cpu; this.loop = loop; this.utilization = utilization;
    this.startedAt = now(); this.lastAt = this.startedAt; this.lastCpu = cpu(); this.lastElu = utilization();
    this.lastOut = this.outBytes(); this.history = []; this.incidents = []; this.timer = null; this.closed = false;
    this.loop.enable();
    if (autoStart) {
      this.timer = setInterval(() => { try { this.sample(); } catch { /* optional monitoring never stops the game */ } }, PERF_LIMITS.sampleMs);
      this.timer.unref?.();
    }
  }

  outBytes() { return Object.entries(this.traffic?.total || {}).reduce((n, [id, v]) => n + (id === 'monitor' ? 0 : finite(v.outBytes)), 0); }

  sample() {
    if (this.closed) return null;
    const at = this.now(), elapsedMs = at - this.lastAt;
    if (elapsedMs <= 0) return null;
    const cpu = this.cpu(), elu = this.utilization(), activity = this.utilization(elu, this.lastElu);
    const out = this.outBytes(), net = this.network.performanceSample(at), counts = this.counts();
    const row = {
      at: new Date(at).toISOString(), intervalMs: rounded(elapsedMs), online: finite(counts.onlinePlayers),
      outMbps: rounded(Math.max(0, out - this.lastOut) * 8 / elapsedMs / 1000),
      cpuPercent: rounded((cpu.user - this.lastCpu.user + cpu.system - this.lastCpu.system) / (elapsedMs * 10)),
      loopBusyPercent: rounded(activity.utilization * 100), loopMaxMs: rounded(this.loop.max / 1e6),
      loopP95Ms: rounded(this.loop.percentile(95) / 1e6), queueMaxBytes: finite(net.queueMaxBytes),
      queueTotalBytes: finite(net.queueTotalBytes), congestedConnections: finite(net.congestedConnections),
      skippedSnapshots: finite(net.skippedSnapshots), clientReports: finite(net.clientReports),
      rttMaxMs: finite(net.rttMaxMs), rttP95Ms: finite(net.rttP95Ms), clientStallMaxMs: finite(net.clientStallMaxMs),
      clientQueueMaxBytes: finite(net.clientQueueMaxBytes),
    };
    // A late sampling timer is itself evidence of a stall, even if the histogram callback has not run yet.
    row.loopMaxMs = Math.max(row.loopMaxMs, rounded(elapsedMs - PERF_LIMITS.sampleMs));
    this.history.push(row); if (this.history.length > PERF_LIMITS.history) this.history.shift();
    this.loop.reset(); this.lastAt = at; this.lastCpu = cpu; this.lastElu = elu; this.lastOut = out;
    const reasons = [];
    if (row.loopMaxMs >= PERF_LIMITS.loopMs) reasons.push('server-stall');
    if (row.queueMaxBytes >= PERF_LIMITS.queueBytes || row.skippedSnapshots) reasons.push('send-queue');
    if (row.clientReports && row.rttMaxMs >= PERF_LIMITS.rttMs) reasons.push('player-latency');
    if (row.clientReports && row.clientStallMaxMs >= PERF_LIMITS.clientStallMs) reasons.push('client-stall');
    if (reasons.length) this.recordIncident(row, reasons, at);
    return row;
  }

  recordIncident(row, reasons, at) {
    const bucket = Math.floor(at / 30_000), last = this.incidents.at(-1);
    if (last?.bucket === bucket) {
      last.lastAt = row.at; last.samples++;
      last.reasons = [...new Set([...last.reasons, ...reasons])];
      for (const key of ['outMbps', 'cpuPercent', 'loopMaxMs', 'queueMaxBytes', 'rttMaxMs', 'clientStallMaxMs', 'clientReports']) last[key] = Math.max(last[key], row[key]);
      last.skippedSnapshots += row.skippedSnapshots;
      return;
    }
    const incident = { bucket, at: row.at, lastAt: row.at, samples: 1, reasons, outMbps: row.outMbps, cpuPercent: row.cpuPercent,
      loopMaxMs: row.loopMaxMs, queueMaxBytes: row.queueMaxBytes, rttMaxMs: row.rttMaxMs,
      clientStallMaxMs: row.clientStallMaxMs, clientReports: row.clientReports, skippedSnapshots: row.skippedSnapshots };
    this.incidents.push(incident); if (this.incidents.length > PERF_LIMITS.incidents) this.incidents.shift();
    // At most one aggregate line per 30 seconds; existing Docker log rotation bounds disk use.
    try { this.log.warn?.('[performance] ' + JSON.stringify(incident)); } catch { /* diagnostics never interrupt play */ }
  }

  snapshot({ history = false } = {}) {
    const at = this.now(), rows = this.history.filter(r => Date.parse(r.at) > at - 60_000);
    const exported = this.incidents.slice(history ? 0 : -10).map(({ bucket, ...event }) => ({ ...event, reasons: [...event.reasons] }));
    return {
      startedAt: new Date(this.startedAt).toISOString(), sampledAt: new Date(at).toISOString(), sampleMs: PERF_LIMITS.sampleMs,
      latest: this.history.at(-1) ? { ...this.history.at(-1) } : null,
      peak60: Object.fromEntries(['outMbps', 'cpuPercent', 'loopMaxMs', 'queueMaxBytes', 'rttMaxMs', 'clientStallMaxMs'].map(k => [k, peak(rows, k)])),
      incidentCount: this.incidents.length, incidents: exported,
      ...(history ? { samples: this.history.map(r => ({ ...r })) } : {}),
      logicalCpus: os.availableParallelism(), thresholds: { ...PERF_LIMITS },
      scope: 'Process-local counters and foreground client reports. CPU 100% equals one logical core. Outbound body/payload rate is not TCP-acknowledged wire speed. RTT includes server, network and browser waiting. Client reports are not trusted gameplay input. Memory history resets on restart; aggregate incidents also enter the server log.',
    };
  }

  close() { if (this.closed) return; this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = null; this.loop.disable(); }
}
