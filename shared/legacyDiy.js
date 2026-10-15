// One-way migration of the four pre-0.2 support preferences. Existing DIY choices always win.
import { diySlotIds, diySlot, validateDiyPicks } from './diy.js';
import { supportChessId } from './supports.js';

export function migrateLegacyDiy({ legacy, entries = {}, existing = {}, data, kitted } = {}) {
  if (!Array.isArray(legacy) || legacy.length !== 4 || Object.keys(existing || {}).length) return existing || {};
  const slots = diySlotIds(data);
  const picks = {};
  legacy.forEach((charId, i) => {
    const slot = diySlot(slots[i], data);
    if (!slot || typeof charId !== 'string') return;
    const lo = entries[supportChessId(charId, slot.tier)] || {};
    const pick = { charId, skillIndex: Number.isInteger(lo.skill) ? lo.skill : 2,
      ...(typeof lo.module === 'string' ? { uniEquipId: lo.module } : {}) };
    let checked = validateDiyPicks({ ...picks, [slot.baseId]: pick }, { data, kitted });
    if (!checked.ok && pick.uniEquipId) {
      delete pick.uniEquipId;
      checked = validateDiyPicks({ ...picks, [slot.baseId]: pick }, { data, kitted });
    }
    if (checked.ok) Object.assign(picks, checked.picks);
  });
  return picks;
}
