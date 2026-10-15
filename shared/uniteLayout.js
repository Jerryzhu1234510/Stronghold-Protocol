// A third independent board on the near side of the existing pair, within the original 19×21 tile grid.
export const TRIO_UNITE_RECT = Object.freeze({ r0: 1, r1: 12, c0: 0, c1: 20 });
export const isTrioUnite = (kind, rect) => kind === 'unite' && Number.isInteger(rect?.r0) && rect.r0 < 6;

export function trioUniteStage(stage) {
  if (!Array.isArray(stage?.rows) || stage.rows.length < 14 || stage.trioUnite) return stage;
  const rows = stage.rows.map(row => String(row).split(''));
  for (let r = 2; r <= 5; r++) for (let c = 8; c <= 20; c++) rows[r][c] = stage.rows[r + 7]?.[c - 8] ?? '#';
  // The original pair feeds a portal into the third board, with no walkable connecting corridor.
  for (const r of [1, 7, 8]) for (let c = 0; c <= 20; c++) rows[r][c] = '#';
  // Intermediate gates are ordinary floor; only the original entry and third board's exit remain.
  for (const [r, c] of [[9, 2], [9, 10], [12, 10], [2, 18], [5, 18]]) rows[r][c] = 'U';
  rows[9][2] = 'I';
  rows[2][18] = 'O';
  const floor = { key: 'tile_floor', tileKey: 'tile_floor', height: 'LOW', build: 'NONE', buildable: 'NONE', pass: 'ALL', passable: 'ALL', groundPassable: true, flyPassable: true };
  const devices = (stage.devices || []).filter(d => (d.row ?? d.pos?.[0] ?? 99) > 6);
  const sourceChars = stage.mapChars ?? stage.raw?.mapChars ?? [];
  // The third board is a translated normal board, not the old mirrored boss board.
  // Keep both lower medic slots and translate its own reserve/Touch slot with the terrain.
  const mapChars = sourceChars.filter(m => m?.pos?.[0] >= 9 && m.pos[0] <= 12);
  for (const m of sourceChars) {
    const [r, c] = m?.pos ?? [];
    if (!(r >= 9 && r <= 12 && c <= 10) || /multi_only/.test(String(m.alias))) continue;
    mapChars.push({ ...m, pos: [r - 7, c + 8], alias: `${m.alias || m.key}:trio` });
  }
  for (const d of stage.devices || []) {
    const r = d.row ?? d.pos?.[0], c = d.col ?? d.pos?.[1];
    if (!(r >= 9 && r <= 13 && c >= 0 && c <= 10)) continue;
    devices.push({ ...d, row: r - 7, col: c + 8, pos: [r - 7, c + 8],
      alias: `${d.alias || d.key}:trio`, rangeTiles: d.rangeTiles?.map(([rr, cc]) => [rr - 7, cc + 8]) });
  }
  return { ...stage, trioUnite: true, rows: rows.map(row => row.join('')), devices, mapChars,
    ...(stage.raw ? { raw: { ...stage.raw, mapChars } } : {}),
    legend: { ...(stage.legend || stage.tiles || {}), U: floor }, tiles: { ...(stage.tiles || stage.legend || {}), U: floor } };
}

export function trioUniteRoutes(routes) {
  return (routes || []).map(route => {
    const third = (route.checkpoints || []).filter(([, c]) => c >= 10).map(([r, c]) => [r - 7, c]);
    return { ...route, start: route.start.slice(), end: [2, 10], checkpoints: [
      ...(route.checkpoints || []).map(p => p.slice()), route.end.slice(),
      ['DISAPPEAR', 9, 2], ['WAIT', 9, 2, 0.25], ['APPEAR', 2, 18], ...third,
    ] };
  });
}
