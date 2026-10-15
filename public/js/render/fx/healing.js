export const HEAL_FX_GAP = 0.1;

// Near-plane projections during camera changes can turn a small additive glow into a full-screen quad.
export function healingPoint(point, screen = {}) {
  if (!point || ![point.x, point.y, point.s].every(Number.isFinite) || point.s <= 0) return null;
  if (Number.isFinite(point.depth) && point.depth <= .05) return null;
  const limit = Math.min(160, Math.max(48, Math.min(screen.width || 640, screen.height || 360) / 3));
  return { x:point.x, y:point.y, s:Math.min(point.s, limit) };
}
