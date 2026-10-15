// Hidden pipe shares the ordinary skeleton, but its fixed body rectangle is centred one tile from its spawn origin.
export function enemyModelPivotX(info, rec) {
  if (info?.side !== 'enemy' || (info.defId || info.enemyKey) !== 'enemy_9021_acduml_2') return 0;
  const dx = Number(rec?.hitArea?.dx);
  return Number.isFinite(dx) && Math.abs(dx) <= 2 ? dx : 0;
}
