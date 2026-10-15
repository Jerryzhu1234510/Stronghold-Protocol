import { Transform } from 'node:stream';
import { performance } from 'node:perf_hooks';

// One scheduler for the entire HTTPS process, across every release and download URL.
// Each stream retains at most one input chunk plus the normal stream high-water marks.
export class DownloadBudget {
  constructor({ bytesPerSecond = 3750000, burstBytes = 65536, maxStreams = 2048 } = {}) {
    if (!(bytesPerSecond > 0) || !(burstBytes > 0)) throw Error('Invalid download budget');
    this.rate = bytesPerSecond; this.burst = burstBytes; this.maxStreams = maxStreams;
    this.tokens = 0; this.at = performance.now(); this.clients = new Map();
    this.streams = new Set(); this.timer = null; this.scheduled = false; this.sent = 0;
  }
  open(client = 'unknown') {
    if (this.streams.size >= this.maxStreams) return null;
    const stream = new BudgetStream(this, client); this.streams.add(stream); return stream;
  }
  enqueue(stream) {
    if (!this.clients.has(stream.client)) this.clients.set(stream.client, new Set());
    this.clients.get(stream.client).add(stream); this.schedule();
  }
  remove(stream) {
    this.streams.delete(stream);
    const group = this.clients.get(stream.client); group?.delete(stream);
    if (!group?.size) this.clients.delete(stream.client);
    if (!this.clients.size && this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
  schedule() {
    if (this.scheduled || this.timer || !this.clients.size) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }
  pump() {
    const now = performance.now();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.at) * this.rate / 1000); this.at = now;
    let turns = 0, stalled = 0;
    while (this.tokens >= 1 && this.clients.size && turns++ < 128) {
      const [client, group] = this.clients.entries().next().value;
      this.clients.delete(client); this.clients.set(client, group);
      let stream;
      for (const candidate of group) if (candidate.pending && !candidate.blocked && !candidate.destroyed) { stream = candidate; break; }
      if (!stream) { if (++stalled >= this.clients.size) break; continue; }
      stalled = 0; group.delete(stream); group.add(stream);
      const pending = stream.pending;
      const n = Math.min(16384, Math.floor(this.tokens), pending.chunk.length - pending.offset);
      const part = pending.chunk.subarray(pending.offset, pending.offset + n);
      this.tokens -= n; this.sent += n; pending.offset += n;
      stream.blocked = !stream.push(part);
      if (pending.offset === pending.chunk.length) {
        stream.pending = null; group.delete(stream);
        if (!group.size) this.clients.delete(client);
        pending.callback();
      }
    }
    if (this.clients.size) this.timer = setTimeout(() => { this.timer = null; this.pump(); }, 10);
  }
  status() { return { bytesPerSecond: this.rate, mbps: this.rate * 8 / 1000000, activeDownloads: this.streams.size, sentBytes: this.sent }; }
}

class BudgetStream extends Transform {
  constructor(budget, client) {
    super({ readableHighWaterMark: 32768, writableHighWaterMark: 32768 });
    this.budget = budget; this.client = client; this.pending = null; this.blocked = false;
  }
  _transform(chunk, encoding, callback) {
    if (!chunk.length) return callback();
    this.pending = { chunk, offset: 0, callback }; this.budget.enqueue(this);
  }
  _read(size) { this.blocked = false; super._read(size); this.budget.schedule(); }
  _destroy(error, callback) {
    this.budget.remove(this); const pending = this.pending; this.pending = null;
    if (pending) pending.callback(error || Error('Download cancelled'));
    callback(error);
  }
}

export function isResourceDownload(uri) {
  try {
    let pathname = decodeURIComponent(new URL(uri, 'http://local').pathname).replaceAll('\\', '/');
    pathname = new URL(pathname, 'http://local').pathname.replace(/^\/_build\/[A-Za-z0-9_-]+\//, '/');
    return /^\/(?:assets|fonts|media|packs|vendor|data|sim|shared|js|css)\//.test(pathname)
      || /^\/resource-policy\/(?:download|variants)\//.test(pathname);
  } catch { return false; }
}
