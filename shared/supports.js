import { t } from './i18n.js';
// Stable ids keep support copies, merging and gifts compatible with ordinary chess.
export const SUPPORT_TIERS = Object.freeze([5, 5, 6, 6]);
export const supportChessId = (charId, tier, golden = false) => `chess_support_${tier}_${charId}_${golden ? 'b' : 'a'}`;

export function checkSupports(picks, catalog = {}) {
  if (!Array.isArray(picks) || picks.length !== 4) return { error: t('请选择四个外援槽位') };
  const seen = new Set();
  for (const id of picks) {
    if (id === null) continue;
    if (typeof id !== 'string' || !Object.hasOwn(catalog, id) || !catalog[id]?.ready) return { error: t('这个外援尚未开放') };
    if (seen.has(id)) return { error: t('同一位干员只能选择一次') };
    seen.add(id);
  }
  return { picks: Object.freeze(picks.slice()) };
}

export function supportIds(picks) {
  return new Set(picks.flatMap((id, i) => id ? [supportChessId(id, SUPPORT_TIERS[i])] : []));
}
