// Response payload bytes after HTTP/WS compression. TLS/IP overhead is excluded.
export class ExitMetrics {
  constructor() { this.startedAt = new Date().toISOString(); this.rows = Object.create(null); this.samples = []; }
  add(kind, bytes) { if (Number.isFinite(bytes) && bytes > 0) this.rows[kind] = (this.rows[kind] || 0) + bytes; }
  snapshot() {
    const now = Date.now(), totals = { ...this.rows };
    const old = this.samples[0];
    this.samples.push({ at: now, totals });
    while (this.samples.length > 1 && this.samples[1].at < now - 60000) this.samples.shift();
    const seconds = old ? (now - old.at) / 1000 : 0;
    return { startedAt: this.startedAt, measurement: 'compressed response/WS bytes; excludes TLS/IP and other processes',
      bytes: totals, windowSeconds: seconds, mbps: Object.fromEntries(Object.entries(totals).map(([k, n]) => [k, seconds ? (n - (old.totals[k] || 0)) * 8 / seconds / 1000000 : 0])) };
  }
}
export function trafficClass(uri) {
  const p = new URL(uri, 'http://local').pathname.replace(/^\/_build\/[A-Za-z0-9_-]+\//, '/');
  if (/^\/resource-policy\/variants\//.test(p) || /^\/(assets|fonts|media|packs)\//.test(p)) return 'assets';
  if (/^\/data\//.test(p)) return 'data';
  if (/^\/(js|css|vendor|shared|sim)\//.test(p) || /^\/resource-policy\/(entry|client|style)/.test(p)) return 'code';
  return 'other';
}
export function observeResponse(res, metrics, kind) {
  const write = res.write, end = res.end;
  const size = (body, encoding) => typeof body === 'string' ? Buffer.byteLength(body, typeof encoding === 'string' ? encoding : undefined) : body?.byteLength || 0;
  res.write = function(body, encoding, callback) { metrics.add(kind, size(body, encoding)); return write.call(this, body, encoding, callback); };
  res.end = function(body, encoding, callback) { metrics.add(kind, size(body, encoding)); return end.call(this, body, encoding, callback); };
}
