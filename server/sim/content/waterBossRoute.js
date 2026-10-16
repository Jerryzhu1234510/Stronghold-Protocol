// The water boss field has two passages around each fence. Leaders must cross
// the upper water tile (row 5), rather than take the shorter row-4 detour.
// Keep the template's patrol targets, waits and teleports; only add passage
// checkpoints to ground leaders. This also runs for the mirrored leader.
export function waterBossRoute(b, e, patrol = false) {
  if (b.stageId !== 'act2autochess_m04' || !['boss', 'hidden'].includes(b.kind)
      || !e.isBoss || e.motion === 'FLY' || !e.route?.legs?.length) return;
  const legs = [];
  const start = patrol ? e.route.legs.find(l => l.t === 'move' && !l.final) || { r: e.y, c: e.x } : { r: e.y, c: e.x };
  let c = e.x;
  for (const leg of e.route.legs) {
    // The template's last goal is a sentinel, not a patrol waypoint. The official
    // patrol hook rewinds before it; never take a leader to that (possibly opposite-side) goal.
    if (patrol && leg.final) continue;
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
  // Leave one tick for the boss patrol hook to rewind. A fast last MOVE can otherwise
  // consume the final point and leak in the same AI tick, before that hook observes it.
  if (patrol) {
    // Close the circuit at its first patrol checkpoint before rewinding. Otherwise the next
    // first leg can cross a fence from a different side without its passage points.
    const crossings = [5, 15].filter(f => (c < f && start.c > f) || (c > f && start.c < f));
    if (start.c < c) crossings.reverse();
    for (const fence of crossings) {
      const direction = start.c > c ? 1 : -1;
      legs.push({ t: 'move', r: 5, c: fence - direction }, { t: 'move', r: 5, c: fence + direction });
    }
    legs.push({ t: 'move', r: start.r, c: start.c }, { t: 'wait', time: 1 });
  }
  e.route.legs = legs;
  e.route.pts = null;
  e.route.tail = null;
  e.route.tailVersion = -1;
}
