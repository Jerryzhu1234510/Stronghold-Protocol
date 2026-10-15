import { meleeOnHighGround } from './highGround.js';

export function versusCanStand(grid, stage, row, col, record) {
  const ranged = record?.position === 'RANGED' || meleeOnHighGround(record);
  const devices = (stage?.devices || []).filter(d => d.pos?.[0] === row && d.pos?.[1] === col
    && (typeof d.active === 'boolean' ? d.active : !d.hidden));
  if (devices.some(d => ['crate', 'mound'].includes(d.role))) return false;
  if (devices.some(d => d.role === 'platform')) return ranged;
  if (devices.some(d => d.role === 'waterPlatform')) return true;
  return grid.canStand(row, col, { ranged });
}
