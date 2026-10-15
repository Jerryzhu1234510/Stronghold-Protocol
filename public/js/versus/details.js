import { unitStatsEntry } from '../../../shared/protocol.js';

export function detailUnit(packet, detail, overview = false) {
  if (!detail || detail.shop) return null;
  const field = overview && packet?.field?.overview ? packet.field.overview : packet?.field;
  if (detail.fieldId && detail.fieldId !== packet?.field?.meta.fieldId) return null;
  return field?.meta?.units.find(u => detail.unitId != null ? u.id === detail.unitId
    : u.kind === 'op' && u.uid === detail.uid && u.ownerId === packet.me.id && u.defId === detail.id) || null;
}

export function monsterPreview(card, power) {
  if (card?.kind !== 'monster' || !power) return null;
  const s = { ...card.stats, maxHp: card.stats.maxHp * power.hp, atk: card.stats.atk * power.atk };
  return { ...unitStatsEntry({ side: 'enemy', defId: card.id, base: card.stats, hp: s.maxHp }, s), src: 'prep' };
}
