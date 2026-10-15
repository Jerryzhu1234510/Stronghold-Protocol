/** Opening-strategy repetition rules shared by the server and the selection screen. */
const entriesOf = picks => picks instanceof Map ? [...picks] : Object.entries(picks || {});

export function bandRepeatUsage(picks) {
  const counts = new Map();
  for (const [, id] of entriesOf(picks)) if (typeof id === 'string') counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
}

/** A new strategy is always available; a duplicate uses one room-wide allowance, with two picks per strategy. */
export function bandPickBlocked(picks, bandId, { playerId = null, repeatLimit = 0 } = {}) {
  const others = entriesOf(picks).filter(([pid]) => pid !== playerId);
  const count = others.filter(([, id]) => id === bandId).length;
  return count >= 2 || (count > 0 && bandRepeatUsage(new Map(others)) >= Math.max(0, repeatLimit));
}
