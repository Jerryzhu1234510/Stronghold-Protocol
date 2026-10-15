// The water boss field has two passages around each fence. Leaders must cross
// the upper water tile (row 5), rather than take the shorter row-4 detour.
// Keep the template's patrol targets, waits and teleports; only add passage
// checkpoints to ground leaders. This also runs for the mirrored leader.
export function waterBossRoute(b, e) {
  if (b.stageId !== 'act2autochess_m04' || !['boss', 'hidden'].includes(b.kind)
      || !e.isBoss || e.motion === 'FLY' || !e.route?.legs?.length) return;
  const legs = [];
  let c = e.x;
  for (const leg of e.route.legs) {
    if (leg.t === 'move') {
      const passages = [5, 15].filter(f => (c < f && leg.c > f) || (c > f && leg.c < f));
      if (leg.c < c) passages.reverse();
      for (const fence of passages) {
        const direction = leg.c > c ? 1 : -1;
        legs.push({ t: 'move', r: 5, c: fence - direction });
        legs.push({ t: 'move', r: 5, c: fence + direction });
      }
      c = leg.c;
    } else if (leg.t === 'appear') c = leg.c;
    legs.push(leg);
  }
  e.route.legs = legs;
  e.route.pts = null;
  e.route.tail = null;
  e.route.tailVersion = -1;
}
