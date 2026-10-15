// Negotiated match-state transport. Battle inputs/results and snapshots are never patched.
// Baselines belong to one socket, and only advance after its frame has been queued.
const TYPES = new Set(['m.public', 'm.private']);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const safeKey = k => typeof k === 'string' && !['__proto__', 'prototype', 'constructor'].includes(k);
const container = v => v !== null && typeof v === 'object';
const copy = v => JSON.parse(JSON.stringify(v));
// Reuse identical broadcasts across sockets with the same baseline. Weak keys do not retain past views.
const preparedStates = new WeakMap();

function changes(a, b, path, ops) {
  if (a === b) return;
  // Most of a view (enemy previews, rosters, bond metadata) is unchanged. Native serialization can
  // compare these subtrees without visiting thousands of keys in JavaScript on every private update.
  if (path.length && container(a) && container(b) && JSON.stringify(a) === JSON.stringify(b)) return;
  if (path.length < 24 && container(a) && container(b) && Array.isArray(a) === Array.isArray(b)
      && (!Array.isArray(a) || a.length === b.length)) {
    for (const k of Object.keys(a)) {
      if (!safeKey(k)) throw new Error('unsafe state key');
      if (!own(b, k)) ops.push([path.concat(k)]);
    }
    for (const k of Object.keys(b)) {
      if (!safeKey(k)) throw new Error('unsafe state key');
      if (!own(a, k)) ops.push([path.concat(k), b[k]]);
      else changes(a[k], b[k], path.concat(k), ops);
    }
  } else ops.push([path, b]);
}

export class StateEncoder {
  constructor() { this.states = new Map(); }
  prepare(msg, json) {
    if (!TYPES.has(msg?.t)) return { data: json, commit() {} };
    let cached = preparedStates.get(msg);
    if (!cached || cached.json !== json) {
      cached = { json, value: JSON.parse(json), frames: new Map() };
      preparedStates.set(msg, cached);
    }
    const prev = this.states.get(msg.t);
    const shared = cached.frames.get(prev);
    if (shared) return { data: shared.data, commit: () => this.states.set(msg.t, shared.next) };
    // The server's views contain live nested arrays. Snapshot the encoded value, not those references.
    const value = cached.value;
    const seq = (prev?.seq || 0) + 1;
    let data = JSON.stringify({ ...value, stateSeq: seq });
    if (prev && seq % 32 !== 0 && prev.value.matchId === value.matchId && prev.value.playerId === value.playerId) {
      const ops = [];
      try { changes(prev.value, value, [], ops); } catch { ops.length = 0; }
      if (ops.length && ops.length <= 4096) {
        const delta = JSON.stringify({ t: 'm.delta', type: msg.t, base: prev.seq, seq, ops });
        if (delta.length + 128 < data.length * 0.85) data = delta;
      }
    }
    const next = { seq, value };
    if (cached.frames.size < 32) cached.frames.set(prev, { data, next });
    return { data, commit: () => this.states.set(msg.t, next) };
  }
}

function patch(root, path, value, deleting) {
  if (!Array.isArray(path) || path.length > 24 || path.some(k => !safeKey(k))) throw new Error('bad delta path');
  if (!path.length) {
    if (deleting || !container(value) || Array.isArray(value)) throw new Error('bad root');
    return value;
  }
  // Clone only the ancestry of this edit. Previously emitted states stay unchanged.
  const next = Array.isArray(root) ? root.slice() : { ...root };
  let src = root, dst = next;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    if (!container(src) || (Array.isArray(src) && (!/^(0|[1-9]\d*)$/.test(k) || +k >= src.length))) throw new Error('missing delta parent');
    if (i === path.length - 1) {
      if (deleting) { if (Array.isArray(src) || !own(src, k)) throw new Error('bad delete'); delete dst[k]; }
      else dst[k] = value;
    } else {
      if (!own(src, k) || !container(src[k])) throw new Error('missing delta parent');
      dst[k] = Array.isArray(src[k]) ? src[k].slice() : { ...src[k] };
      src = src[k]; dst = dst[k];
    }
  }
  return next;
}

export class StateDecoder {
  constructor() { this.states = new Map(); }
  reset() { this.states.clear(); }
  decode(msg) {
    if (TYPES.has(msg.t) && own(msg, 'stateSeq')) {
      if (!Number.isSafeInteger(msg.stateSeq) || msg.stateSeq < 1) throw new Error('bad state sequence');
      const { stateSeq, ...value } = msg;
      this.states.set(msg.t, { seq: stateSeq, value });
      return copy(value); // UI consumers may mutate their copy without corrupting the baseline.
    }
    if (msg.t !== 'm.delta') return msg; // old servers and other message types remain compatible
    const prev = this.states.get(msg.type);
    if (!TYPES.has(msg.type) || !prev || msg.base !== prev.seq || msg.seq !== prev.seq + 1
        || !Array.isArray(msg.ops) || msg.ops.length > 4096) throw new Error('state delta out of sequence');
    let value = prev.value;
    for (const op of msg.ops) {
      if (!Array.isArray(op) || op.length < 1 || op.length > 2) throw new Error('bad delta operation');
      value = patch(value, op[0], op[1], op.length === 1);
    }
    if (value.t !== msg.type) throw new Error('changed state type');
    this.states.set(msg.type, { seq: msg.seq, value });
    return copy(value);
  }
}
