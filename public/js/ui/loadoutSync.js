// Operator loadout state + server sync (DESIGN §16).
//
// `loadoutStore` holds the per-browser loadout (`entries`, persisted in localStorage through store.js savePref) and the
// 干员调配 screen state (open / origin / selection / filters). `installLoadoutSync()` (called once by main.js) keeps the
// server's copy current: after every `welcome` (new or resumed session — the server keeps it on the session and on the
// seat, so joining a room needs no resend) and after every edit (debounced; a pending edit goes out at once when the
// overlay closes), it sends `room.loadout { entries }` with
// the entries sanitised against the loaded data/chess.json (ui/loadoutModel.js sanitizeEntries: a stale entry is
// dropped, never the whole loadout). Replies: RATE → retried later; WRONG_PHASE / ROOM_STARTED → the running match has
// locked its loadout (it applies to the next match, the server stored it) — not an error for the player; anything else
// is logged. `sync.state` ∈ 'idle' | 'pending' | 'sending' | 'synced' | 'locked' | 'error' is mirrored into the store
// for the screen's status line.

import { createStore, loadPref, savePref } from '../store.js';
import { data, setChessOverlay } from '../data.js';
import { LOADOUT_PREF, PICKS_PREF, parseStored, parseStoredPicks, picksToStored, sanitizeEntries, sanitizePicks, toStored, waiguanPickChess, waiguanPickedChess, withWaiguan } from './loadoutModel.js';
import { toast } from './toasts.js';

export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  try { return parseStored(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
}

function readStoredPicks() {
  try { return parseStoredPicks(loadPref(PICKS_PREF, null)); } catch { return {}; }
}

/** Loadout + 甄选 (DIY) picks + screen state (separate from the app store: they survive room / match resets). */
export const loadoutStore = createStore({
  entries: readStored(),
  // 外援 / 甄选 (DESIGN §21.2): `{ [slotId]: charId }`, the four 6★ operators this player brings from outside the pool
  picks: readStoredPicks(),
  open: false,
  from: null,          // 'lobby' | 'room' | 'briefing'
  sel: null,           // selected base chess id
  filters: { tier: null, prof: null, bond: null, query: '', changedOnly: false },
  sync: 'idle',
});

/** Replace the stored entries (persisted at once; the sync picks the change up). */
export function setEntries(entries) {
  const next = entries && typeof entries === 'object' ? entries : {};
  savePref(LOADOUT_PREF, toStored(next));
  loadoutStore.set({ entries: next });
}

/** Replace the stored 甄选 selection (persisted at once; the sync picks the change up). */
export function setPicks(picks) {
  const next = parseStoredPicks(picks || {});
  savePref(PICKS_PREF, picksToStored(next));
  loadoutStore.set({ picks: next });
}

/**
 * Apply a parsed entry map (an imported preset). Sanitised against the loaded data first, then persisted and synced
 * like any ordinary edit — so a preset from another build never sends the server an entry it would refuse. An import
 * that keeps nothing (every chess unknown, or every choice already the default) changes NOTHING: wiping the current
 * loadout over it would be a loss the player never asked for.
 * @param {Record<string, any>} entries `parseImport(...).entries`
 * @param {(id: string) => any} lookup chess lookup
 * @returns {{ applied: number, dropped: number }} entries kept / entries that were not imported
 */
export function applyLoadoutEntries(entries, lookup) {
  const asked = Object.keys(entries || {}).length;
  const clean = sanitizeEntries(entries, lookup);
  const applied = Object.keys(clean).length;
  if (applied) setEntries(clean);
  return { applied, dropped: Math.max(0, asked - applied) };
}

/** Open the 干員调配 screen. @param {'lobby'|'room'|'briefing'} from @param {string|null} [sel] */
export function openLoadout(from = 'lobby', sel = null) {
  data.load('chess');
  data.load('bonds');
  data.load('assets');
  data.load('local');
  data.load('waiguan');   // the 外援 / 甄选 roster behind the four slots (DESIGN §21.2)
  loadoutStore.set({ open: true, from, ...(sel ? { sel } : {}) });
}
export const closeLoadout = () => loadoutStore.set({ open: false });

/**
 * Wire the sync once. Dependencies are injectable for tests.
 * @param {{ net: any, getChessReady?: () => Promise<any>, lookupChess?: (id: string) => any,
 *   loadWaiguan?: () => Promise<any>, getWaiguan?: () => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore> }} deps
 * @returns {{ flush: () => Promise<void>, flushPicks: () => Promise<void>, dispose: () => void }}
 */
export function installLoadoutSync({ net, getChessReady, lookupChess, loadWaiguan, getWaiguan, timers, target = loadoutStore, notify } = {}) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const ready = getChessReady || (() => data.load('chess'));
  const lookup = lookupChess || ((id) => data.lookup('chess', id));
  const loadRoster = loadWaiguan || (() => data.load('waiguan'));
  const getRoster = getWaiguan || (() => data.get('waiguan'));
  const tell = notify || ((text) => toast(text, 'warn'));
  let timer = null;
  let seq = 0;            // room.loadout requests sent (the reply of an older one never overrides a newer one's state)
  let pendingJson = null; // JSON of the newest request still awaiting its reply
  let lastSent = null;    // JSON of the last entries the server accepted (on this session)
  let edited = false;     // an edit is waiting to be sent (a lock refusal is then worth telling the player)
  // 外援 / 甄选 (room.pick, DESIGN §21.2): the same pattern, on its own request so a refusal names the right intent
  let pickSeq = 0;
  let pickPending = null;
  let pickLastSent = null;
  let pickEdited = false;
  let disposed = false;
  /** Why the last flush did (or did not) send — surfaced by the 外援自检 (waiguanDoctor). */
  let why = 'idle';

  const setState = (sync) => { if (target.get().sync !== sync) target.set({ sync }); };

  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    // flushAll, never the loadout-only flush: both copies of the pre-match configuration go out on the same debounce
    timer = T.setTimeout(() => { timer = null; void flushAll(); }, ms);
  };

  /**
   * room.pick: the 甄选 selection, sanitised against data/waiguan.json. Sent separately from room.loadout (a refusal
   * then says which of the two was refused) and skipped entirely while the selection is empty and the server has none.
   */
  async function flushPicks() {
    if (disposed || net.status !== 'online') return;
    try {
      const current = target.get().picks || {};
      const empty = Object.keys(current).length === 0;
      if (globalThis.__SP_DBG_PICKS) console.log('[dbg-flush] current =', JSON.stringify(current), ' empty =', empty, ' targetIsStore =', typeof target.reset);
      // an empty selection needs no data: a player who never touched 甄选 must not download waiguan.json in the lobby
      if (!empty) await loadRoster();
      if (disposed) return;
      const picks = empty ? {} : sanitizePicks(current, getRoster());
      // Teach the app's chess lookup this player's own 外援 records (data.js setChessOverlay). The in-match UI resolves
      // every chess id through `lookup('chess', …)`, and those records are NOT in data/chess.json, so a drawn 外援 card
      // used to render as its raw id with no avatar — the loadout screen does the same widening with withWaiguan().
      setChessOverlay(waiguanPickChess(getRoster(), picks));
      const json = JSON.stringify(picks);
      // An empty selection is only worth a frame when the server may still hold an older one (this session sent picks
      // before): a fresh session starts with none, so a player who never touched 甄选 sends nothing at all — which also
      // keeps waiguan.json out of the lobby.
      if (empty && pickLastSent == null) { pickEdited = false; return; }
      if (json === pickPending || (json === pickLastSent && pickPending == null)) { pickEdited = false; return; }
      const my = ++pickSeq;
      const wasEdit = pickEdited;
      pickEdited = false;
      pickPending = json;
      try {
        await net.request('room.pick', { picks });
        if (my !== pickSeq) return;
        pickPending = null;
        pickLastSent = json;
      } catch (err) {
        if (my !== pickSeq) return;
        pickPending = null;
        const code = err && err.code;
        if (code === 'WRONG_PHASE' || code === 'ROOM_STARTED') {
          pickLastSent = json;
          if (wasEdit) tell('本局的外援干员已锁定，修改将在下一局生效');
        } else if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { pickEdited = pickEdited || wasEdit; schedule(RETRY_MS); }
        else if (code === 'BAD_TARGET' || code === 'BAD_MSG') { console.warn('[waiguan] room.pick refused', code, err && err.detail); }
        else console.warn('[waiguan] room.pick failed', code, err && err.detail);
      }
    } catch (e) {
      console.warn('[waiguan] picks sync failed', e);
    }
  }

  // Review fix: a send is never held back behind one still in flight. The socket is ordered and the server applies
  // room.loadout frames in order, so the newest entries always win; holding the edit until the previous reply arrived let
  // a click right after closing the overlay (准备就绪 → INFO_CHECK ends) overtake it, and the edit silently missed the match.
  async function flush() {
    if (disposed) return;
    if (net.status !== 'online') { setState('idle'); return; } // the next welcome resends
    try {
      const current = target.get().entries;
      // an empty loadout needs no data (nothing to sanitise): a player who never opened 干员调配 does not download
      // chess.json in the lobby just for this
      const empty = !current || Object.keys(current).length === 0;
      const loaded = empty ? true : await ready();
      if (disposed) return;
      // never sanitise against missing data: every entry would be dropped and the server's copy cleared. But giving up
      // HERE left the configuration unsent for the rest of the session — the picks go out (they only need waiguan.json)
      // while the loadout never does, so a match starts with defaults and NOTHING says why (owner's report 2026-10-06:
      // 干员调配里换技能局内没变). Retry instead: the data load is what failed, not the choice.
      if (loaded == null) { why = 'data-not-ready'; setState('error'); schedule(RETRY_MS); return; }
      // A 外援 / 甄选 (DIY) entry is a legal loadout entry (DESIGN §21.2), but only against the record of a pick the player
      // actually made — so the same picks the server will check against widen the lookup here (and only then is
      // waiguan.json needed: an untouched selection costs nothing).
      let lookupNow = lookup;
      if (!empty) {
        const picks = target.get().picks || {};
        if (Object.keys(picks).length) {
          await loadRoster();
          if (disposed) return;
          // narrowed to the tier each pick actually fills (waiguanPickedChess): an entry left over from the other tier's
          // phantom roster row is not offered by the screen any more, so it must not be sent / counted either
          lookupNow = withWaiguan(lookup, waiguanPickedChess(getRoster(), picks));
        }
      }
      const entries = empty ? {} : sanitizeEntries(target.get().entries, lookupNow);
      const json = JSON.stringify(entries);
      if (json === pendingJson) return; // the same content is already on its way
      if (json === lastSent && pendingJson == null) { edited = false; setState('synced'); return; }
      const my = ++seq;
      const wasEdit = edited;
      edited = false;
      pendingJson = json;
      setState('sending');
      try {
        await net.request('room.loadout', { entries });
        if (my !== seq) return;
        pendingJson = null;
        lastSent = json;
        setState('synced');
      } catch (err) {
        if (my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'WRONG_PHASE' || code === 'ROOM_STARTED') {
          // the server stored it for the next match; the running one keeps the loadout it locked
          lastSent = json;
          setState('locked');
          if (wasEdit) tell('本局的干员调配已锁定，修改将在下一局生效');
        } else if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { edited = edited || wasEdit; schedule(RETRY_MS); }
        else if (code === 'BAD_TARGET') {
          // An entry naming a 外援 / 甄选 operator is only legal against a pick the server already stored. If `room.pick`
          // has not landed yet (it failed transiently, or a retry is pending), the lobby refuses the entry as an unknown
          // chess — and dropping it here lost the player's skill choice WITH NO EXPLANATION (the flushAll order only
          // guarantees the picks go first while they succeed). Re-send the picks and try again.
          console.warn('[loadout] room.loadout refused', code, err && err.detail, '— 补发选人后重试');
          edited = edited || wasEdit;
          pickLastSent = null;
          schedule(RETRY_MS);
        }
        else { console.warn('[loadout] room.loadout refused', code, err && err.detail); setState('error'); }
      }
    } catch (e) {
      console.warn('[loadout] sync failed', e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; pickLastSent = null; pickPending = null; seq++; pickSeq++; schedule(50); });
  /**
   * A NEW match must be told the configuration again, even when this client already sent the same content for the
   * previous one: the server's copy lives on the session, and a match created from a room that never left the lobby
   * (`inMatch` stays true) is not covered by the reset below — the send was skipped as “already sent”, so the new match
   * started with an EMPTY loadout (owner's report 2026-10-06: 干员调配里换技能局内没变, while localStorage had it).
   * Entering INFO_CHECK is the one transition every new match has; resetting there costs one extra idempotent frame.
   */
  let lastPhase = null;
  const offPhase = net.on('m.public', (msg) => {
    const phase = msg && msg.phase;
    if (phase === lastPhase) return;
    lastPhase = phase;
    if (phase === 'INFO_CHECK') { lastSent = null; pickLastSent = null; reconciled = false; schedule(50); }
  });
  /**
   * Self-healing, because trusting “already sent” left a match with an EMPTY loadout (owner's report 2026-10-06): every
   * `m.private` carries the copy the MATCH holds (`loadout`). When it lacks an entry this browser has — a 外援 entry whose
   * frame was refused, or a session that never got it — re-send the whole configuration while the match still accepts it
   * (INFO_CHECK only), once per match. Without this, the mismatch is invisible forever.
   */
  let reconciled = false;
  const offPriv = net.on('m.private', (msg) => {
    if (reconciled || lastPhase !== 'INFO_CHECK' || !msg || typeof msg !== 'object') return;
    const mine = target.get().entries || {};
    const server = msg.loadout && typeof msg.loadout === 'object' ? msg.loadout : {};
    const diverged = Object.entries(mine).some(([id, e]) => {
      if (!id.includes('_diy_')) return false;                       // 外援 entries are the ones that can be missing
      const s = server[id];
      if (!s) return true;
      return Number.isInteger(e?.skill) && s.skill !== e.skill;
    });
    if (!diverged) return;
    reconciled = true;
    console.warn('[loadout] the match is missing this browser\'s configuration — re-sending it');
    lastSent = null;
    pickLastSent = null;
    schedule(50);
  });
  const offStore = target.subscribe((s, prev) => {
    if (s.entries !== prev.entries) { edited = true; schedule(); }
    if (s.picks !== prev.picks) { pickEdited = true; schedule(); }
    // closing the overlay sends a pending edit at once (review fix): the player's next click — 准备就绪 in the solo
    // briefing, 开始模拟 in the room — must not overtake the debounced room.loadout (the match locks its loadout when
    // INFO_CHECK ends, so a late edit would silently only apply to the next match). Same socket ⇒ ordered.
    if (prev.open && !s.open && timer != null) { T.clearTimeout(timer); timer = null; void flushAll(); }
  });
  // a match leaving INFO_CHECK locks the loadout; a new match (the room back in LOBBY / a new INFO_CHECK) accepts it again
  const offRoom = net.on('room.state', (msg) => { if (msg && !msg.inMatch && target.get().sync === 'locked') { lastSent = null; schedule(); } });

  /**
   * Send both copies of the player's pre-match configuration: the operator loadout (`room.loadout`) and the 甄选 (DIY)
   * selection (`room.pick`). The two are independent requests — a refusal names which of them was refused.
   *
   * The loadout goes LAST on purpose: its entries may name 外援 operators, and the server only accepts those the player's
   * own picks contain — so the picks have to be stored first (a fresh player picking a 外援 and editing its skill in one
   * visit would otherwise have that entry dropped as `unknown chess`).
   */
  async function flushAll() {
    await flushPicks();
    await flush();
  }

  /** What the sync is doing — printed by the 外援自检 (main.js `__SP__.waiguanDoctor()`). */
  const debug = () => ({
    sync: target.get().sync,
    why,
    entries: Object.keys(target.get().entries || {}).length,
    picks: Object.keys(target.get().picks || {}).length,
    lastSent: lastSent ? String(lastSent).slice(0, 300) : null,
  });
  // a side channel for the self-check: it is installed before the app's own debug hook exists
  try { globalThis.__SP_LOADOUT_SYNC__ = { debug }; } catch { /* ignore */ }
  return {
    flush: flushAll,
    flushPicks,
    debug,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offPhase?.();
      offPriv?.();
      offStore?.();
      offRoom?.();
    },
  };
}
