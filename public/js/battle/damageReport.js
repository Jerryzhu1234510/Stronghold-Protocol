/** Read existing HP-damage counters only: no stepping, result building, or mutation. */
export function damageReportOf(battle, ownerId, meta = {}) {
  if (!battle || !ownerId) return null;
  const grouped = new Map();
  for (const u of battle.allyUnits || []) {
    if (u.ownerId !== ownerId || !Number.isFinite(u.stats?.dmg) || u.stats.dmg <= 0) continue;
    const key = u.kind === 'op' ? `op:${u.uid ?? u.id}` : `token:${u.defId}`;
    let row = grouped.get(key);
    if (!row) { row = { key, defId: u.defId, name: u.name, kind: u.kind, dmg: 0 }; grouped.set(key, row); }
    row.dmg += u.stats.dmg;
  }
  const rows = [...grouped.values()].sort((a, b) => b.dmg - a.dmg || a.key.localeCompare(b.key));
  const total = rows.reduce((sum, row) => sum + row.dmg, 0);
  return { ...meta, ownerId, round: battle.round, done: !!battle.finished, time: battle.time || 0, total, rows };
}
