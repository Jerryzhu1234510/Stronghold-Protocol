import { N_ } from './i18n.js';
// Presentation only. Read the committed spawn schedule; never roll or alter it.
export const DUCK_WARNING_HINTS = Object.freeze({
  enemy_1539_reid: N_('低血量会强化，并有一次复起；为后续形态保留输出。'),
  enemy_1512_mcmstr: N_('首次倒下后会爆炸并眩晕周围单位，留意后续形态。'),
  enemy_1517_xi: N_('注意十字范围攻击与护盾；进入后续形态后攻势增强。'),
  enemy_1516_jakill: N_('具有远程法术与眩晕，后续形态具备破甲能力。'),
  enemy_2008_flking: N_('会削弱我方攻击、防御与费用回复，并周期性生成护盾。'),
  enemy_1513_dekght: N_('双骑士联动：一只倒下后，另一只会强化。'),
  enemy_1513_dekght_2: N_('双骑士联动：一只倒下后，另一只会强化。'),
});

export function duckReinforcements(spawns, routes = [], enemyName = key => key) {
  const groups = new Map();
  for (const spawn of Array.isArray(spawns) ? spawns : []) {
    if (spawn?.tag !== 'duck-enhanced' || !DUCK_WARNING_HINTS[spawn.enemyKey]
      || !Number.isFinite(spawn.time)) continue;
    const time = Math.max(0, spawn.time), owner = String(spawn.ownerPlayerId || '');
    const route = spawn.route || routes[spawn.routeIndex ?? 0];
    const start = spawn.pos || route?.start;
    const tile = Array.isArray(start) && start.length === 2 && start.every(Number.isFinite)
      ? start.map(Math.round) : null;
    const id = JSON.stringify([owner, time, tile]);
    if (!groups.has(id)) {
      if (groups.size >= 16) continue;
      groups.set(id, { id, time, ownerPlayerId: owner, tile, enemies: [] });
    }
    const group = groups.get(id);
    if (group.enemies.length >= 4) continue;
    const coins = Number(spawn.bounty?.coins ?? spawn.mods?.bountyCoins);
    group.enemies.push({ key: spawn.enemyKey, name: String(enemyName(spawn.enemyKey) || spawn.enemyKey),
      coins: Number.isInteger(coins) && coins > 0 && coins <= 100 ? coins : 0,
      hint: DUCK_WARNING_HINTS[spawn.enemyKey] });
  }
  return [...groups.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

// Driven by simulation time, so pause/speed-up/reconnect do not use a wall timer.
export function activeDuckWarnings(groups, gameTime) {
  if (!Number.isFinite(gameTime)) return [];
  return (Array.isArray(groups) ? groups : []).filter(g => g && Number.isFinite(g.time)
    && Array.isArray(g.enemies) && g.enemies.length && gameTime >= g.time - 5 && gameTime < g.time + 4)
    .map(g => ({ ...g, remaining: Math.max(0, Math.ceil(g.time - gameTime)), arrived: gameTime >= g.time }));
}
