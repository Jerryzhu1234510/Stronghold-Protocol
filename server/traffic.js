// Aggregate process-local counters. No payloads, client identifiers or URLs are retained.
export const TRAFFIC_GROUPS = Object.freeze([
  'images', 'models', 'audio', 'code', 'data', 'httpOther', 'game', 'chat', 'connection', 'monitor',
]);
const GROUP_SET = new Set(TRAFFIC_GROUPS);
const empty = () => Object.fromEntries(TRAFFIC_GROUPS.map(id => [id, { outBytes: 0, inBytes: 0, requests: 0, messagesOut: 0, messagesIn: 0, errors: 0, notModified: 0, aborted: 0 }]));

export function httpCategory(url = '/') {
  const p = String(url).split('?')[0].toLowerCase();
  if (['/healthz', '/stats', '/stats/', '/stats.html', '/stats-data', '/diagnostics-data', '/js/stats.js', '/css/stats.css'].includes(p)) return 'monitor';
  if (p.startsWith('/media/') || /\.(mp3|ogg|oga|opus|wav|m4a|aac)$/.test(p)) return 'audio';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(p)) return 'images';
  if (/\.(skel|atlas|obj|bin|gltf|glb)$/.test(p)) return 'models';
  if (/\.(json|csv)$/.test(p)) return 'data';
  if (p === '/' || /\.(html?|m?js|css|wasm|woff2?|[ot]tf|webmanifest)$/.test(p)) return 'code';
  return 'httpOther';
}

export function payloadBytes(data, encoding) {
  if (typeof data === 'string') return Buffer.byteLength(data, encoding);
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((n, part) => n + payloadBytes(part), 0);
  return 0;
}

// Bound the work per frame; messages without an early type fall into the connection/other group.
export function webSocketCategory(data, isBinary = false) {
  if (isBinary) return 'connection';
  const prefix = typeof data === 'string' ? data.slice(0, 256) : Buffer.isBuffer(data) ? data.toString('utf8', 0, 256) : '';
  const type = /"t"\s*:\s*"([\w.]+)"/.exec(prefix)?.[1] || '';
  if (type.startsWith('room.chat')) return 'chat';
  if (/^(m|b|g)\./.test(type)) return 'game';
  return 'connection';
}

export class TrafficStats {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.startedAt = now();
    this.total = empty();
    this.buckets = new Array(60);
  }

  add(group, field, amount) {
    if (!GROUP_SET.has(group) || !Number.isFinite(amount) || amount <= 0) return;
    const second = Math.floor(this.now() / 1000);
    const index = ((second % 60) + 60) % 60;
    let bucket = this.buckets[index];
    if (!bucket || bucket.second !== second) this.buckets[index] = bucket = { second, values: empty() };
    this.total[group][field] += amount;
    bucket.values[group][field] += amount;
  }

  recordWebSocket(direction, data, isBinary = false) {
    const group = webSocketCategory(data, isBinary);
    this.add(group, direction === 'out' ? 'outBytes' : 'inBytes', payloadBytes(data));
    this.add(group, direction === 'out' ? 'messagesOut' : 'messagesIn', 1);
  }

  // Count encoded response bodies after gzip/WebP selection. These are bytes accepted by Node's
  // response stream, not TCP acknowledgements; headers, WebSocket framing and proxy traffic are excluded.
  observeHttp(req, res) {
    const group = httpCategory(req.url);
    const count = (chunk, encoding) => {
      if (req.method !== 'HEAD' && res.statusCode !== 204 && res.statusCode !== 304) this.add(group, 'outBytes', payloadBytes(chunk, encoding));
    };
    const write = res.write, end = res.end;
    res.write = function (chunk, encoding, callback) {
      const result = write.call(this, chunk, encoding, callback);
      count(chunk, typeof encoding === 'string' ? encoding : undefined);
      return result;
    };
    res.end = function (chunk, encoding, callback) {
      const result = end.call(this, chunk, encoding, callback);
      count(chunk, typeof encoding === 'string' ? encoding : undefined);
      return result;
    };
    let recorded = false;
    const finish = () => {
      if (recorded) return;
      recorded = true;
      this.add(group, 'requests', 1);
      if (res.statusCode >= 400) this.add(group, 'errors', 1);
      if (res.statusCode === 304) this.add(group, 'notModified', 1);
      if (!res.writableFinished) this.add(group, 'aborted', 1);
    };
    res.once('finish', finish);
    res.once('close', finish);
  }

  snapshot() {
    const at = this.now(), second = Math.floor(at / 1000), recent = empty();
    for (const bucket of this.buckets) {
      if (!bucket || bucket.second <= second - 60 || bucket.second > second) continue;
      for (const group of TRAFFIC_GROUPS) for (const field of Object.keys(recent[group])) recent[group][field] += bucket.values[group][field];
    }
    const rows = TRAFFIC_GROUPS.map(id => ({ id, total: { ...this.total[id] }, recent: recent[id] }));
    const sum = (key, field, monitor) => rows.filter(r => monitor || r.id !== 'monitor').reduce((n, r) => n + r[key][field], 0);
    return {
      startedAt: new Date(this.startedAt).toISOString(), sampledAt: new Date(at).toISOString(),
      windowSecs: Math.max(1, Math.min(60, (at - this.startedAt) / 1000)),
      totals: { outBytes: sum('total', 'outBytes', true), inBytes: sum('total', 'inBytes', true), gameOutBytes: sum('total', 'outBytes', false), recentGameOutBytes: sum('recent', 'outBytes', false) },
      groups: rows,
      scope: 'HTTP encoded response bodies and WebSocket application payloads; process-local, excludes protocol headers, proxies and other applications.',
    };
  }
}
