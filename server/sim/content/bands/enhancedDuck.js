import { GEO } from '../../../../shared/constants.js';
import { createRng, deriveSeed } from '../../rng.js';

export const DUCK_GUESTS = Object.freeze([
  { enemyKey: 'enemy_1539_reid', coins: 6 },
  { enemyKey: 'enemy_1512_mcmstr', coins: 5 },
  { enemyKey: 'enemy_1517_xi', coins: 4 },
  { enemyKey: 'enemy_1516_jakill', coins: 4 },
]);

// Pick one group per successful roll. Knights enter together and retain the
// existing rage-on-partner-death content; every body has its own kill bounty.
export const DUCK_GUESTS_TIER2 = Object.freeze([
  Object.freeze([{ enemyKey: 'enemy_2008_flking', coins: 5 }]),
  Object.freeze([{ enemyKey: 'enemy_1513_dekght_2', coins: 3 }, { enemyKey: 'enemy_1513_dekght', coins: 3 }]),
]);

// Independent seeded stream: reconnects/respecs repeat the same roll without
// consuming shop/draft RNG. One per player/round, also in paired boss fields.
export function addDuckGuest(ctx, ev) {
  const tier = ctx.extensions?.duckEnhanced === true ? 1 : ctx.extensions?.duckEnhanced;
  if (![1, 2].includes(tier) || ctx.round <= 10
    || !['normal', 'boss', 'hidden'].includes(ev?.kind) || !Array.isArray(ev.spawns)) return null;
  if (ctx.bandId() !== 'band_ducklord' && !ctx.teammates().some(t => t.bandId() === 'band_ducklord')) return null;
  const rng = createRng(deriveSeed(ctx.seed, `duck-extra:${ctx.round}:${ctx.playerId}`));
  if (!rng.chance(0.6)) return null;
  const guests = tier === 2 ? rng.pick(DUCK_GUESTS_TIER2) : [rng.pick(DUCK_GUESTS)];
  if (guests.some(guest => !ctx.gd.enemy(guest.enemyKey))
    || ev.spawns.some(s => s.tag === 'duck-enhanced' && s.ownerPlayerId === ctx.playerId)) return null;
  const eligible = ev.spawns.filter(s => {
    if (!s || s.tag === 'boss' || s.tag === 'part' || s.countInTotal === false || !Number.isFinite(s.time)) return false;
    if (!ev.side) return true;
    const end = ev.routes?.[s.routeIndex ?? 0]?.end?.[1];
    return Number.isFinite(end) && (ev.side === 'R' ? end > (GEO.BOSS_RECT.c0 + GEO.BOSS_RECT.c1) / 2 : end < (GEO.BOSS_RECT.c0 + GEO.BOSS_RECT.c1) / 2);
  });
  // Some boss waves consist only of the leader. Use an explicit ground route
  // on this player's half instead of silently losing that round's successful roll.
  const routeIndex = ev.routes?.findIndex(route => route?.motion !== 'FLY'
    && (!ev.side || (Number.isFinite(route?.end?.[1]) && (ev.side === 'R'
      ? route.end[1] > (GEO.BOSS_RECT.c0 + GEO.BOSS_RECT.c1) / 2
      : route.end[1] < (GEO.BOSS_RECT.c0 + GEO.BOSS_RECT.c1) / 2))));
  const anchor = eligible[Math.floor(eligible.length / 2)]
    || (routeIndex >= 0 ? { time: 10, routeIndex } : null);
  if (!anchor) return null;
  const added = guests.map(guest => {
    const spawn = { enemyKey: guest.enemyKey, time: anchor.time, routeIndex: anchor.routeIndex ?? 0,
      ...(anchor.route ? { route: anchor.route } : {}), count: 1, interval: 0,
      mods: anchor.mods ? { ...anchor.mods } : {}, tag: 'duck-enhanced', countInTotal: true,
      ownerPlayerId: ctx.playerId, bounty: { coins: guest.coins, ownerPlayerId: ctx.playerId } };
    // No inherited bounty ids/slot overrides from an unrelated template enemy.
    delete spawn.mods.bountyId; delete spawn.mods.bountyCoins; delete spawn.mods.slot;
    if (tier === 2) {
      const inherited = Number.isFinite(spawn.mods.hpMul) && spawn.mods.hpMul > 0 ? spawn.mods.hpMul : 1;
      spawn.mods.hpMul = inherited * 2;
    }
    return spawn;
  });
  ev.spawns.push(...added);
  return added[0];
}
