/** Cosmetic selections never change a character's combat record. */
export function sanitizeCosmetics(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [charId, skinId] of Object.entries(raw)) {
    if (/^char_\d+_[a-z0-9]+$/i.test(charId) && typeof skinId === 'string' && skinId.length <= 150 && skinId.startsWith(charId + '@')) result[charId] = skinId;
  }
  return result;
}

export function selectedSkin(manifest, charId) {
  const base = String(charId || '').replace(/_[12]$/, '');
  const skin = manifest?.cosmeticChoices?.[base];
  return skin && Object.hasOwn(manifest?.chars?.[base]?.skins || {}, skin) ? manifest.chars[base].skins[skin] : null;
}
