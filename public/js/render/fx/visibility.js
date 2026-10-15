// Another sub-field can be behind the watched camera. Keep sim events, not their oversized additive quads.
export function visibleEffectPoint(p, screen = {}) {
  if (!p || ![p.x, p.y, p.s].every(Number.isFinite) || p.s <= 0) return false;
  if (Number.isFinite(p.depth) && p.depth <= .05) return false;
  const { width, height } = screen;
  if (!(width > 0 && height > 0)) return p.s < 2048;
  const margin = Math.min(256, Math.max(width, height) / 3);
  return p.s < Math.max(width, height) * 2 && p.x >= -margin && p.x <= width + margin
    && p.y >= -margin && p.y <= height + margin;
}
