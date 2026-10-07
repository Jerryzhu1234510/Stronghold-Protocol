// Presence readout (在线人数) — the numbers shown next to the release version on the title screen and in the lobby.
//
// The server pushes the `presence` frame (shared/protocol.js, server/lobby.js `presence`): `{ online, inRoom }`, where
// `online` counts the sessions with a live socket and `inRoom` the humans holding a seat plus the spectators. It arrives
// once right after `welcome` and again whenever the numbers change, so the client never polls `/healthz` for them.
// Both screens render `presenceLabel`, so the wording lives in one place.

/**
 * Normalise the numbers of a `presence` frame (or of the store's `presence` slice): a non-negative whole number, or
 * null while the number is unknown (no frame yet, or the connection is down).
 * @param {any} p `{ online, inRoom }`
 * @returns {{ online: number|null, inRoom: number|null }}
 */
export function presenceFacts(p) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null);
  return { online: n(p?.online), inRoom: n(p?.inRoom) };
}

/** The readout's text: 「在线 3 人 · 房间内 1 人」; a number that is not known yet shows as — (em dash). */
export function presenceLabel(p) {
  const { online, inRoom } = presenceFacts(p);
  return `在线 ${online == null ? '—' : online} 人 · 房间内 ${inRoom == null ? '—' : inRoom} 人`;
}

/** How often a page without a session (the title screen) re-reads the counters from `/healthz`. */
export const PRESENCE_POLL_MS = 10_000;

/** Give up on a `/healthz` that does not answer: a hanging request must not pile up on the next poll. */
export const PRESENCE_FETCH_TIMEOUT_MS = 5_000;

/**
 * Read the counters from `GET /healthz` — the path a page that has not entered yet has to take: the title screen owns a
 * socket but no session (`hello` is sent on entering), so the pushed `presence` frame cannot reach it. The numbers are
 * the same ones the frame carries (server/lobby.js `presence`, both spread into /healthz). Never throws: an offline
 * server, a 404, broken JSON or a slow answer all mean "unknown" (null), and the readout keeps showing — .
 * @param {Function} [fetchFn] injectable for tests
 * @param {{ timeoutMs?: number, setTimeout?: Function, clearTimeout?: Function }} [o]
 * @returns {Promise<{ online: number|null, inRoom: number|null } | null>}
 */
export async function fetchPresence(fetchFn = (url, init) => globalThis.fetch(url, init), o = {}) {
  const setT = o.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = o.clearTimeout || ((id) => globalThis.clearTimeout(id));
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const tooSlow = new Promise((resolve) => { setT(() => resolve('slow'), o.timeoutMs ?? PRESENCE_FETCH_TIMEOUT_MS); });
  try {
    const res = await Promise.race([fetchFn('/healthz', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }), tooSlow]);
    if (res === 'slow') { ctrl?.abort(); return null; }
    if (!res || !res.ok) return null;
    const body = await Promise.race([res.json(), tooSlow]);
    return body && body !== 'slow' ? presenceFacts(body) : null;
  } catch {
    return null;
  } finally {
    clearT(tooSlow);
  }
}
