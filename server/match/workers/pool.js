import { Worker } from 'node:worker_threads';
import { ERR } from '../../../shared/constants.js';

const unavailable = () => ({ error: ERR.INTERNAL, detail: 'battle worker unavailable' });

export function matchWorkerCount(value = process.env.SP_MATCH_WORKERS ?? 0) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new RangeError('SP_MATCH_WORKERS must be 0..4');
  return n;
}

// Sessions and matchmaking stay in the lobby. Only complete matches live in these isolates.
export async function createMatchWorkerPool({ count, dataDir, log, matchModule, requestTimeoutMs = 5000,
  maxPendingPerMatch = 64, heapMb = 1024 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new RangeError('invalid match worker count');
  if (!Number.isInteger(heapMb) || heapMb < 128 || heapMb > 4096) throw new RangeError('invalid battle worker heap limit');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new RangeError('invalid battle command timeout');
  if (!Number.isInteger(maxPendingPerMatch) || maxPendingPerMatch < 1) throw new RangeError('invalid battle command queue limit');
  const pool = { slots: [], matches: new Map(), pending: new Map(), closing: false, serial: 0, rid: 0 };
  const finish = (rid, result) => {
    const p = pool.pending.get(rid);
    if (!p) return;
    pool.pending.delete(rid); clearTimeout(p.timer); p.match.pending--;
    p.resolve(result);
  };
  const post = (slot, msg) => {
    if (pool.closing || !slot.ready) throw new Error('battle worker unavailable');
    slot.worker.postMessage(msg);
  };
  const remove = match => {
    if (match.disposed) return;
    match.disposed = true;
    pool.matches.delete(match.id); match.slot.matches.delete(match.id);
    for (const [rid, p] of pool.pending) if (p.match === match) finish(rid, unavailable());
  };
  const crashMatch = (match, reason) => {
    remove(match);
    log?.error?.(`[battle-worker] ${match.opts.roomCode}: ${reason}`);
    // Never move a half-finished battle to a fresh isolate and silently lose its authoritative state.
    try { match.opts.onCrash?.(reason); } catch (e) { log?.error?.('[battle-worker] crash callback', e); }
  };
  function spawn(slot) {
    slot.ready = false;
    const worker = new Worker(new URL('./runtime.js', import.meta.url), {
      workerData: { dataDir, matchModule }, resourceLimits: { maxOldGenerationSizeMb: heapMb },
    });
    slot.worker = worker;
    let ready = false;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('battle worker startup timeout')); void worker.terminate(); }, 30000);
      worker.on('message', msg => {
        if (slot.worker !== worker || pool.closing) return;
        if (msg?.op === 'ready') {
          ready = true; slot.ready = true; clearTimeout(timer); resolve(); return;
        }
        if (msg?.op === 'log') {
          if (msg.level === 'warn' || msg.level === 'error') log?.[msg.level]?.(`[battle-worker ${slot.index}] ${msg.message}`);
          return;
        }
        if (msg?.op === 'reply') {
          // A reply belongs to this worker's match, not merely a globally guessable sequence number.
          const p = pool.pending.get(msg.rid);
          if (p?.match.slot === slot && p.match.id === msg.id) finish(msg.rid, msg.result);
          return;
        }
        const match = pool.matches.get(msg?.id);
        if (!match || match.slot !== slot || match.disposed) return;
        try {
          if (msg.op === 'send') match.opts.send(msg.playerId, msg.msg);
          else if (msg.op === 'sendMany') match.opts.sendMany?.(msg.playerIds, msg.msg);
          else if (msg.op === 'broadcast') match.opts.broadcast(msg.msg);
          else if (msg.op === 'end') match.opts.onEnd(msg.summary);
          else if (msg.op === 'afk') match.opts.onAfk?.(msg.playerId);
          else if (msg.op === 'fatal') { crashMatch(match, msg.error); worker.postMessage({ op: 'dispose', id: msg.id }); }
        } catch (e) { log?.error?.('[battle-worker] delivery failed', e); }
      });
      worker.on('error', e => { log?.error?.(`[battle-worker ${slot.index}]`, e.message); });
      worker.once('exit', code => {
        clearTimeout(timer);
        if (!ready) reject(new Error(`battle worker failed to start (${code})`));
        if (slot.worker !== worker) return;
        slot.ready = false;
        if (pool.closing) return;
        for (const id of [...slot.matches]) {
          const match = pool.matches.get(id);
          if (match) crashMatch(match, `worker exited (${code})`);
        }
        // A bounded restart policy prevents a broken release from endlessly spawning workers.
        slot.failures = slot.failures.filter(at => Date.now() - at < 60000);
        slot.failures.push(Date.now());
        if (ready && slot.failures.length <= 3) {
          slot.restartTimer = setTimeout(() => {
            slot.restartTimer = null;
            if (!pool.closing) spawn(slot).catch(e => log?.error?.('[battle-worker] restart failed', e.message));
          }, 250);
        }
      });
    });
  }
  class WorkerMatch {
    constructor(opts) {
      const slots = pool.slots.filter(s => s.ready);
      slots.sort((a, b) => {
        const weight = s => [...s.matches].reduce((n, id) => n + (pool.matches.get(id)?.weight || 0), 0);
        return weight(a) - weight(b) || a.matches.size - b.matches.size || a.index - b.index;
      });
      if (pool.closing || !slots.length) throw new Error('no healthy battle worker');
      this.id = String(++pool.serial); this.slot = slots[0]; this.opts = opts;
      this.asyncMatch = true; this.disposed = false; this.pending = 0;
      this.weight = opts.gameMode === 'versus' ? 4 : Math.max(1, opts.seats.length);
      pool.matches.set(this.id, this); this.slot.matches.add(this.id);
      const fields = ['roomCode', 'mode', 'difficulty', 'modeId', 'capacity', 'mapVersion', 'gameMode', 'extensions', 'seats', 'spectators', 'seed', 'matchNo'];
      const init = Object.fromEntries(fields.filter(k => opts[k] !== undefined).map(k => [k, opts[k]]));
      try { post(this.slot, { op: 'create', id: this.id, opts: init }); }
      catch (e) { remove(this); throw e; }
    }
    call(method, args, reply = false) {
      if (this.disposed || !this.slot.ready || pool.closing) return reply ? Promise.resolve(unavailable()) : undefined;
      if (!reply) { post(this.slot, { op: 'call', id: this.id, method, args }); return; }
      if (this.pending >= maxPendingPerMatch || pool.pending.size >= 4096) return Promise.resolve({ error: ERR.RATE, detail: 'battle command queue full' });
      return new Promise(resolve => {
        const rid = ++pool.rid;
        const timer = setTimeout(() => {
          finish(rid, { error: ERR.INTERNAL, detail: 'battle command timed out' });
          // Do not accept an unbounded stream of replacements behind a stalled match.
          crashMatch(this, 'battle command timed out');
          try { post(this.slot, { op: 'dispose', id: this.id }); } catch { /* worker already stopped */ }
        }, requestTimeoutMs);
        this.pending++; pool.pending.set(rid, { match: this, resolve, timer });
        try { post(this.slot, { op: 'call', id: this.id, method, args, rid }); }
        catch { finish(rid, unavailable()); }
      });
    }
    start() { this.call('start', []); }
    handle(id, msg) { return this.call('handle', [id, msg], true); }
    setLoadout(id, loadout) { return this.call('setLoadout', [id, loadout], true); }
    onDisconnect(id) { this.call('onDisconnect', [id]); }
    onReconnect(id) { this.call('onReconnect', [id]); }
    onLeave(id) { this.call('onLeave', [id]); }
    addSpectator(id) { this.call('addSpectator', [id]); }
    removeSpectator(id) { this.call('removeSpectator', [id]); }
    dispose() {
      if (this.disposed) return;
      try { post(this.slot, { op: 'dispose', id: this.id }); } catch { /* worker already stopped */ }
      remove(this);
    }
  }
  pool.MatchClass = WorkerMatch;
  pool.snapshot = () => pool.slots.map(s => ({ index: s.index, threadId: s.worker?.threadId,
    healthy: s.ready, matches: s.matches.size,
    pending: [...pool.pending.values()].filter(p => p.match.slot === s).length,
    eventLoop: s.ready ? s.worker.performance.eventLoopUtilization() : null }));
  pool.close = async () => {
    pool.closing = true;
    for (const slot of pool.slots) { clearTimeout(slot.restartTimer); slot.ready = false; }
    for (const match of [...pool.matches.values()]) remove(match);
    await Promise.all(pool.slots.map(slot => slot.worker?.terminate()));
  };
  for (let index = 0; index < count; index++) pool.slots.push({ index, ready: false, matches: new Set(), failures: [], restartTimer: null });
  try { await Promise.all(pool.slots.map(spawn)); }
  catch (e) { await pool.close(); throw e; }
  return pool;
}
