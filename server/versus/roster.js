import { COLS } from '../sim/constants.js';

// Roster edits are not combat deaths: never run death, revival or explosion hooks.
export function detachOperator(battle, uid, reason = 'roster') {
  const unit = battle?.allyUnits.find(u => u.uid === uid && !u.removed);
  if (!unit) return;
  battle.releaseBlocked(unit);
  const key = unit.tileR * COLS + unit.tileC;
  if (battle._occ[key] === unit) battle._occ[key] = null;
  unit.alive = false; unit.deployed = false; unit.removed = true;
  unit.removeReason = reason;
  if (unit.skill) unit.skill.active = false;
  battle._ev(['die', unit.id, reason]);
  battle._toRelease.push(unit);
  battle._releaseRemoved();
  const player = battle.getPlayer(unit.ownerId);
  player.input.units = player.input.units.filter(input => input.uid !== uid);
}

export function relocatePair(battle, unit, row, col, other = null) {
  const source = [unit.tileR, unit.tileC];
  if (other) battle._occ[row * COLS + col] = null;
  const moved = battle.relocate(unit, row, col);
  if (!moved) {
    if (other) battle._occ[row * COLS + col] = other;
    return false;
  }
  if (other && !battle.relocate(other, ...source)) {
    battle.relocate(unit, ...source);
    battle._occ[row * COLS + col] = other;
    return false;
  }
  for (const u of [unit, other].filter(Boolean)) {
    u.homeR = u.tileR; u.homeC = u.tileC;
    const input = battle.getPlayer(u.ownerId).input.units.find(i => i.uid === u.uid);
    if (input) { input.row = u.tileR; input.col = u.tileC; }
    battle._ev(['deploy', u.id, u.dir]);
  }
  return true;
}
