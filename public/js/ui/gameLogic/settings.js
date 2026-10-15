// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键). */
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'cn', muted: false, damageNumbers: true, officialDamageNumbers: false, ammoCount: false, quality: 'high', frameRate: 60, keys: DEFAULT_HOTKEYS });
const QUALITIES = ['high', 'medium', 'low'];

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, ammoCount: boolean, quality: 'high'|'medium'|'low', frameRate: number,
 *   keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: ['cn', 'jp', 'en', 'off'].includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    ammoCount: typeof r.ammoCount === 'boolean' ? r.ammoCount : DEFAULT_SETTINGS.ammoCount,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    frameRate: r.frameRate === 30 ? 30 : DEFAULT_SETTINGS.frameRate,
    keys: sanitizeHotkeys(r.keys),
  };
}
