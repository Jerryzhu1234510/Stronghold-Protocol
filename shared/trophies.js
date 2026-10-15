import { roomExtensions } from './roomExtensions.js';

// HP-only challenge increases, cosmetic Mods and the original DIY lineup keep
// normal scoring. Consumers must not halve the final award again.
export function matchTrophyPolicy({ gameMode = 'normal', extensions } = {}) {
  const values = roomExtensions.normalize(extensions);
  const custom = gameMode === 'clone' || roomExtensions.catalog()
    .some(rule => rule.affectsTrophies !== false && values[rule.id] !== rule.default);
  return { version: 1, custom, multiplier: custom ? 0.5 : 1, reason: custom ? 'custom' : 'normal' };
}

export function resultTrophies(gd, { roundsPassed, hiddenCleared = false, cleared = false,
  capacity = 4, policy = matchTrophyPolicy() } = {}) {
  const table = gd.config.trophies;
  if (!table || gd.isSolo) return 0;
  let base = 0;
  for (const row of table.byRoundsPassed || []) {
    if (roundsPassed <= row.maxRound) { base = Number(row[gd.difficulty]) || 0; break; }
  }
  if (hiddenCleared && Number.isFinite(table.hiddenCore?.[gd.difficulty])) base = table.hiddenCore[gd.difficulty];
  // Hidden Core is an optional continuation, not a second eight-cup award.
  if (gd.difficulty === 'ABYSS' && cleared && Number.isInteger(capacity) && capacity >= 4 && capacity <= 8) base = 8;
  return Math.max(0, base) * (policy.custom ? 0.5 : 1);
}
