import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLEMENTIA_POLL, validPollChoice } from '../shared/playerPoll.js';

export const validVoterKey = key => typeof key === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key);

export class PlayerPollStore {
  constructor(file) { this.file = file; this.votes = {}; this.queue = Promise.resolve(); }
  async load() {
    await mkdir(dirname(this.file), { recursive: true });
    let state;
    try { state = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (state.pollId !== CLEMENTIA_POLL.id || !state.votes || typeof state.votes !== 'object' || Array.isArray(state.votes)
      || Object.entries(state.votes).some(([key, choice]) => !/^[a-f0-9]{64}$/.test(key) || !validPollChoice(choice))) {
      throw new Error('Invalid poll state; refusing to overwrite stored votes');
    }
    this.votes = state.votes;
  }
  hash(key) { return createHash('sha256').update(CLEMENTIA_POLL.id + ':' + key).digest('hex'); }
  snapshot(key = null) {
    const counts = Object.fromEntries(CLEMENTIA_POLL.options.map(option => [option.id, 0]));
    for (const choice of Object.values(this.votes)) counts[choice]++;
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { pollId: CLEMENTIA_POLL.id, choice: key ? this.votes[this.hash(key)] || null : null,
      total, options: CLEMENTIA_POLL.options.map(option => ({ id: option.id, votes: counts[option.id],
        percent: total ? Math.round(counts[option.id] * 1000 / total) / 10 : 0 })) };
  }
  async persist(votes) {
    const temp = this.file + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pollId: CLEMENTIA_POLL.id, votes }));
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temp, this.file);
    } finally {
      await handle?.close();
      await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  vote(key, choice) {
    if (!validVoterKey(key) || !validPollChoice(choice)) return Promise.reject(new Error('Invalid vote'));
    const operation = this.queue.then(async () => {
      const hash = this.hash(key);
      if (this.votes[hash] === choice) return this.snapshot(key);
      if (!this.votes[hash] && Object.keys(this.votes).length >= 50000) throw new Error('Poll capacity reached');
      const next = { ...this.votes, [hash]: choice };
      // Commit to disk before acknowledging or changing the visible tally.
      await this.persist(next);
      this.votes = next;
      return this.snapshot(key);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

export async function startPlayerPollService({ file, port = 14530, host = '127.0.0.1',
  origin = 'https://weishuxieyi.icu', log = console } = {}) {
  const store = new PlayerPollStore(file);
  await store.load();
  const rates = new Map();
  const allowed = (req, kind, limit) => {
    const now = Date.now(), address = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    if (rates.size > 10000) for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    const key = kind + ':' + address;
    let bucket = rates.get(key);
    if (!bucket || bucket.until < now) { bucket = { until: now + 60000, count: 0 }; rates.set(key, bucket); }
    return ++bucket.count <= limit;
  };
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/healthz' && req.method === 'GET') { reply(res, 200, { ok: true, total: store.snapshot().total }); return; }
      if (req.url !== '/api/player-poll') { reply(res, 404, { error: 'NOT_FOUND' }); return; }
      if (!allowed(req, 'read', 180)) { reply(res, 429, { error: 'RATE_LIMIT' }); return; }
      if (req.headers.origin && req.headers.origin !== origin) { reply(res, 403, { error: 'ORIGIN' }); return; }
      if (req.method === 'GET') { reply(res, 200, store.snapshot()); return; }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); reply(res, 405, { error: 'METHOD' }); return; }
      if (!req.headers['content-type']?.startsWith('application/json')) { reply(res, 415, { error: 'CONTENT_TYPE' }); return; }
      let raw = '', size = 0;
      for await (const chunk of req) { size += chunk.length; if (size <= 2048) raw += chunk.toString('utf8'); }
      if (size > 2048) { reply(res, 413, { error: 'TOO_LARGE' }); return; }
      let body;
      try { body = JSON.parse(raw); } catch { reply(res, 400, { error: 'BAD_MSG' }); return; }
      if (!body || !validVoterKey(body.voterKey) || body.pollId !== CLEMENTIA_POLL.id || !['read', 'vote'].includes(body.action)
        || (body.action === 'vote' && !validPollChoice(body.choice))) {
        reply(res, 400, { error: 'BAD_MSG' }); return;
      }
      if (body.action === 'read') { reply(res, 200, store.snapshot(body.voterKey)); return; }
      if (!allowed(req, 'vote', 20)) { reply(res, 429, { error: 'RATE_LIMIT' }); return; }
      reply(res, 200, await store.vote(body.voterKey, body.choice));
    } catch (error) {
      log.error('[player-poll] request failed', error);
      if (!res.headersSent) reply(res, 503, { error: 'UNAVAILABLE' }); else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
  return { server, store, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startPlayerPollService({ file: process.env.SP_POLL_FILE || '/state/player-poll.json',
    host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 14530),
    origin: process.env.SP_POLL_ORIGIN || 'https://weishuxieyi.icu' });
  console.log('Player poll service ready');
}
