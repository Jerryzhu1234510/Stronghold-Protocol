export const HISTORY_KEY = 'sp.match-history.v1';
export const HISTORY_LIMIT = 20;
const MAX_ENTRY = 256 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const valid = entry => plain(entry) && typeof entry.id === 'string' && entry.id.length <= 160
  && Number.isFinite(entry.savedAt) && plain(entry.result) && Array.isArray(entry.result.players)
  && entry.result.players.length <= 8 && entry.result.players.every(plain);

function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36) + ':' + text.length;
}

/** Small local-only archive; replays dedupe and a blocked/quota-full store cannot break settlement. */
export function createMatchHistory(storage = null) {
  let entries = [];
  const listeners = new Set();
  try {
    const text = storage?.getItem(HISTORY_KEY);
    if (text && text.length <= MAX_TOTAL) {
      const saved = JSON.parse(text);
      if (saved?.version === 1 && Array.isArray(saved.entries))
        entries = saved.entries.filter(valid).slice(0, HISTORY_LIMIT);
    }
  } catch { /* No storage, malformed data or privacy mode: use memory for this page. */ }
  const persist = () => {
    while (entries.length > 1 && JSON.stringify(entries).length > MAX_TOTAL - 1024) entries.pop();
    try { storage?.setItem(HISTORY_KEY, JSON.stringify({ version: 1, entries })); }
    catch {
      // Retain the latest result even when old records need to be evicted for quota.
      let saved = entries.slice();
      while (saved.length > 1) {
        saved.pop();
        try { storage?.setItem(HISTORY_KEY, JSON.stringify({ version: 1, entries: saved })); entries = saved; break; }
        catch { /* Keep trying a smaller archive. */ }
      }
    }
    for (const listener of listeners) listener(entries);
  };
  return {
    list: () => entries,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    save(result, pub = {}, myId = null, now = Date.now()) {
      try {
        if (!plain(result) || !Array.isArray(result.players) || !result.players.length || result.players.length > 8) return false;
        const text = JSON.stringify(result);
        if (text.length > MAX_ENTRY) return false;
        const id = typeof result.resultId === 'string' && result.resultId.length <= 160 ? result.resultId : 'legacy:' + fingerprint(text);
        if (entries.some(entry => entry.id === id)) return false;
        const context = {};
        for (const key of ['modeId', 'difficulty', 'capacity', 'gameMode', 'lastRound', 'bossId', 'hiddenBossId', 'hiddenReached'])
          if (typeof pub[key] === 'string' || typeof pub[key] === 'number' || typeof pub[key] === 'boolean') context[key] = pub[key];
        const entry = { id, myId, savedAt: Number.isFinite(result.endedAt) ? result.endedAt : now, result: JSON.parse(text), public: context };
        if (!valid(entry)) return false;
        entries = [entry, ...entries].slice(0, HISTORY_LIMIT); persist(); return true;
      } catch { return false; }
    },
    clear() { entries = []; persist(); },
  };
}

let storage = null;
try { storage = globalThis.localStorage || null; } catch { /* Browser policy can deny even reading localStorage. */ }
export const matchHistory = createMatchHistory(storage);
