import { getData } from '../data.js';
import { enemyEnabled } from '../../shared/customEnemyPolicy.js';
import { TIMES_KITS } from '../sim/content/enemies/times.js';
import { N_ } from '../../shared/i18n.js';

export const data = getData();
const starters = [
  ['enemy_1007_slime', 1, 1], ['enemy_1000_gopro_2', 2, 1],
  ['enemy_1046_agent', 3, 2], ['enemy_1005_yokai_2', 4, 2],
  ['enemy_1006_shield', 5, 3], ['enemy_1010_demon', 6, 3],
  ['enemy_1045_hammer', 8, 4], ['enemy_1081_sotisd', 10, 5],
];
// Explicit bounty leaders only; the final-assault/hidden-core Boss pool is never imported.
const bountyLeaders = [
  ['enemy_1001_bigbo', 10, 6], ['enemy_1050_lslime', 12, 6],
  ['enemy_1500_skulsr', 9, 6], ['enemy_1501_demonk', 10, 6],
  ['enemy_1502_crowns', 8, 6], ['enemy_1504_cqbw', 11, 6],
];
const starterIds = new Set(starters.map(([id]) => id));
// These hit-count forms are spawned by their parents, not separate shop goods.
export const DERIVED_MONSTERS = new Set([
  'enemy_1196_msfyin', 'enemy_1198_msfshu', 'enemy_1200_msfjin', 'enemy_1202_msfzhi',
  'enemy_1204_msfhu', 'enemy_1208_msfji', 'enemy_1210_msfden',
].flatMap(id => [id, `${id}_2`]));
const expanded = Object.entries(data.enemies).filter(([id,e]) => !starterIds.has(id) && e.rank !== 'BOSS' && !e.tokenOnly
  && !DERIVED_MONSTERS.has(id)
  && (e.acTypes?.length || TIMES_KITS[id] || /^深池/.test(e.name))).map(([id,e]) => {
  const hits = e.stats.maxHp <= 100 && /需要\d+次伤害/.test(e.desc);
  const weight = hits ? Math.max(3, Math.ceil(e.stats.maxHp / 3) + 3)
    : Math.max(3, Math.ceil(e.stats.maxHp / 1800 + e.stats.atk / 250 + e.stats.def / 400 + e.stats.res / 25) + (e.acTypes?.length ? 2 : 0));
  const tier = weight <= 4 ? 2 : weight <= 7 ? 3 : weight <= 11 ? 4 : weight <= 17 ? 5 : 6;
  const price = Math.min(10, Math.max(2, Math.ceil(weight / 3)));
  return [id, price, tier];
});
export const MONSTERS = [...starters, ...expanded, ...bountyLeaders].filter(([id]) => data.enemies[id] && enemyEnabled(id)).map(([id, price, tier]) => ({
  id, kind: 'monster', name: data.enemies[id].name,
  price: id === 'enemy_1007_slime' ? 3 : tier <= 3 ? Math.max(2, Math.floor(Math.ceil(price * 1.3) * 0.7)) : Math.ceil(price * 1.3),
  tier, quantity: tier <= 3 ? 2 : 1,
  avatar: data.enemies[id].iconId, stats: data.enemies[id].stats,
  desc: data.enemies[id].desc, bounty: data.enemies[id].rank === 'BOSS',
}));
function operatorPrice(c) {
  const fixed = (c.garrisonIds || []).map(id => data.garrisons[id]).find(g => g?.eventType === 'SERVER_PRICE');
  return fixed?.bb?.price ?? [0, 2, 3, 3, 3, 4, 4][c.tier];
}
export const OPERATORS = Object.values(data.chess).filter(c => !c.isGolden && !c.hideInShop && !c.isDiy && !c.diySlot && c.charId && !c.standInFor && c.stats && c.tier >= 1 && c.tier <= 6)
  .filter(c => !c.chessId.includes('diy')).map(c => ({
    id: c.chessId, kind: 'operator', name: c.name, tier: c.tier,
    price: operatorPrice(c), avatar: c.avatar || c.charId,
    bonds: c.bonds, position: c.position, stats: c.stats,
  }));
export const EQUIPMENT = Object.values(data.items).filter(i => i.itemType === 'EQUIP' && !i.isGolden && !i.hideInShop && i.category === 'STAT').map(i => ({
  id: i.id, kind: 'equipment', name: i.name, tier: i.tier, price: Math.max(1, i.price),
  avatar: i.iconId, desc: i.desc, params: i.params,
}));
export const ELITES = OPERATORS.map(o => data.chess[o.id]?.goldenId).filter(id => data.chess[id]).map(id => {
  const c = data.chess[id];
  return { id, kind: 'operator', name: c.name, tier: c.tier, price: 0, avatar: c.avatar || c.charId,
    bonds: c.bonds, position: c.position, stats: c.stats, isGolden: true };
});
export const CATALOG = [...OPERATORS, ...ELITES, ...MONSTERS, ...EQUIPMENT];
export const byId = new Map(CATALOG.map(c => [c.id, c]));
export const STRATEGIES = [
  { id: 'band_bldsk', name: N_('华法琳'), desc: N_('每击杀一个投放敌人，一名在场干员的所属盟约各加 1 层。') },
  { id: 'band_amiya', name: N_('阿米娅'), desc: N_('激活 3 / 4 / 5 个盟约时，全体攻击和生命加 20% / 30% / 40%。') },
  { id: 'band_dury', name: N_('杜遥夜'), desc: N_('前两次刷新各提供一名炎干员，每轮淘汰赛重新计数。') },
];
export const RECT = { r0: 0, r1: 5, c0: 2, c1: 18 };
// Reuse the real Boss field, including its terrain, mirrored crates and blue gates.
export const STAGE = data.stages.act1autochess_m01;
