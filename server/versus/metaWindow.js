import { HANDLERS } from '../sim/content/garrisons/meta.js';
import { MatchSpDraft } from '../match/match/spDraft.js';
import { data } from './catalog.js';
import { getDefaultRegistry } from '../match/effectsMeta.js';
import { itemKey } from '../match/gamedata.js';
import { grantVersusCoins, VERSUS_LAYER_CAP } from '../../shared/versusEconomy.js';

export const META_WINDOW_SECONDS = 30;
export const WINDOW_META = new Set([
  'SERVER_ADD_BOND_METHOD', 'SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER', 'SERVER_ADD_BOND_IN_HAND',
  'SERVER_ADD_BOND_ROUND_COIN_COST', 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER',
  'SERVER_GAIN_EQUIP', 'SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL', 'SERVER_POOL_EQUIP', 'SERVER_POOL_CHAR',
  'SERVER_MOST_BOND', 'SERVER_TRIGGER_ANOTHER', 'SERVER_TRIGGER_FRONT_COUNT',
  'SERVER_FRONT_SAME_EFFECT_PREP_START', 'SERVER_FRONT_SAME_EFFECT_PREP_FIN',
]);
const freshStats = () => ({ refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0 });
export function resetMetaWindow(p) {
  p.metaWindow = { index: 1, next: META_WINDOW_SECONDS, stats: freshStats(), counters: new Map(), depth: 0 };
  p.pendingKillGold = 0;
}
export function recordMeta(p, key, n = 1) {
  if (!p.metaWindow) resetMetaWindow(p);
  p.metaWindow.stats[key] += n;
}
function view(p, o) {
  return { ...o, kind: 'chess', area: o.row == null ? 'hand' : 'board',
    tier: p.room?.gd.tierOf(o.id), golden: !!data.chess[o.id]?.isGolden, items: (o.items || []).map(id => ({ id })) };
}
export function metaEligible(piece, g) {
  return piece.row != null || g.bbStr?.conditionkey !== 'character_target_inboard';
}

// Adapt the original handlers' context, keeping their pool weights, conditions and limits intact.
function nativeContext(p, piece, g, depth = 0) {
  if (!p.metaWindow) resetMetaWindow(p);
  const room = p.room, gd = room?.gd;
  const source = { piece: view(p, piece), garrison: g,
    garrisonId: Object.keys(data.garrisons).find(id => data.garrisons[id] === g) || '',
    bb: g.bb || {}, bbStr: g.bbStr || {}, where: piece.row == null ? 'hand' : 'board' };
  const rng = n => room.random(n);
  rng.int = n => Math.floor(rng() * n);
  rng.pick = list => list.length ? list[rng.int(list.length)] : null;
  rng.shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const roller = { gd, pool: room?.rewardPool, itemPool: room?.itemPool, rngMeta: rng };
  roller.rollItemId = opts => MatchSpDraft.prototype.rollItemId.call(roller, opts);
  const ctx = {
    data, gd, source, round: p.metaWindow.index, rng,
    piece: uid => { const o = p.operators.find(o => o.uid === uid); return o ? view(p, o) : null; },
    board: () => p.operators.filter(o => o.row != null).map(o => view(p, o)),
    hand: () => p.operators.filter(o => o.row == null).map(o => view(p, o)),
    chessRecord: id => data.chess[id],
    bondActive: id => !!p.bonds[id]?.active,
    bondCount: id => p.bonds[id]?.count || 0,
    layers: id => p.layers[id] || 0,
    shopLevel: () => p.level,
    roundStats: () => ({ ...p.metaWindow.stats }),
    temp: () => [],
    pieceBonds: uid => data.chess[p.operators.find(o => o.uid === uid)?.id]?.bonds || [],
    addFunds: n => grantVersusCoins(p, n),
    shopSlots: () => p.shop.operator.map(id => id ? { kind: 'chess', id, sold: false } : null),
    setShopSlot: (i, slot) => { p.shop.operator[i] = slot?.id || null; },
    addLayers: (id, n, { requireActive = false } = {}) => {
      if (!data.bonds[id] || !(n > 0) || (requireActive && !p.bonds[id]?.active)) return 0;
      const old = p.layers[id] || 0; p.layers[id] = Math.min(VERSUS_LAYER_CAP, old + n); return p.layers[id] - old;
    },
    incPieceCounter: (uid, key) => {
      const k = `${uid}:${key}`, n = (p.metaWindow.counters.get(k) || 0) + 1;
      p.metaWindow.counters.set(k, n); return n;
    },
    grantFreeRefresh: n => {
      if (p.freeRefreshNext > p.duelTime) return;
      p.freeRefresh = Math.min(2, (p.freeRefresh || 0) + n); p.freeRefreshNext = p.duelTime + 20;
    },
    addPendingFunds: n => { p.pendingKillGold = (p.pendingKillGold || 0) + Math.max(0, n); },
    grantItem: id => {
      if (!data.items[id] || p.items.length >= 12) return null;
      const it = { uid: room.nextUid++, id }; p.items.push(it); return it;
    },
    grantChess: id => room.acquireOperator(p, id, 0),
    rollItem: opts => roller.rollItemId(opts),
    rollPool: id => MatchSpDraft.prototype.rollPool.call(roller, id, {
      shopLevel: p.level, filter: cid => !room.bannedChess.has(gd.baseIdOf(cid)),
    }),
    rollChess: ({ bond, tier = null, maxTier = 6, filter }) => room.rewardPool.roll(rng, {
      tier, maxTier, filter: id => !room.bannedChess.has(id) && (!bond || data.chess[id]?.bonds.includes(bond)) && (!filter || filter(id)),
    }),
    offerChess: (ids, { tier } = {}) => {
      if (p.offers.length >= 12) return;
      const choices = ids?.filter(id => !room.bannedChess.has(gd.baseIdOf(id))) || [];
      if (!ids) for (let i = 0; i < gd.rewardOffer().count; i++) {
        const id = room.rewardPool.roll(rng, { tier, filter: id => !choices.includes(id) });
        if (id) choices.push(id);
      }
      if (choices.length) p.offers.push({ reason: 'trait', tier, slots: choices.map(id => ({ kind: 'chess', id, sold: false, price: 0 })) });
    },
    triggerGarrisons: (uid, event, { asUid } = {}) => {
      const target = p.operators.find(o => o.uid === uid), self = p.operators.find(o => o.uid === asUid) || target;
      if (!target || !self) return 0;
      let count = 0;
      for (const id of data.chess[target.id]?.garrisonIds || []) {
        const trait = data.garrisons[id];
        if (trait?.eventType === event) count += runNativeMeta(p, self, trait, { triggered: true, depth: depth + 1 });
      }
      return count;
    },
  };
  return ctx;
}

export function runNativeMeta(p, piece, g, { triggered = false, depth = 0 } = {}) {
  const h = HANDLERS[g.effectKey];
  if (!h || !metaEligible(piece, g) || depth >= 6 || p.role === 'attack') return 0;
  const ctx = nativeContext(p, piece, g, depth);
  const fn = g.eventType === 'SERVER_REFRESH_SHOP' ? h.onRefresh : g.eventType === 'SERVER_CHESS_SOLD' ? h.onSold || h.run : h.run;
  if (!fn) return 0;
  // Acquisition chains share a depth budget with re-trigger/copy chains.
  if (p.metaWindow.depth >= 6) return 0;
  p.metaWindow.depth++;
  try { fn(ctx, { trigger: triggered }); } finally { p.metaWindow.depth--; }
  return 1;
}

export function consumeTraitItem(p, piece, item) {
  if (data.items[item.id]?.kind !== 'consume_on_equip') return false;
  const immediate = new Set(['equip_destory_gain_random_coin', 'use_equip_reward_char_chess_bond_layer',
    'use_equip_reward_random_char_chess_in_shop', 'use_equip_reward_char_chess_with_same_bond',
    'use_equip_gain_coin_when_next_round_start', 'use_equip_reward_char_chess', 'use_equip_reward_special_goods_char_chess']);
  if (!data.items[item.id].buffs.every(buff => immediate.has(buff.key))) throw new Error('此持续或变换道具暂未接入对抗测试版');
  const ctx = nativeContext(p, piece, { bb: {}, bbStr: {} });
  const handler = getDefaultRegistry().get(`item:${itemKey(item.id)}`);
  if (!handler?.onEquip) throw new Error('此道具暂未接入对抗测试版');
  const ev = { item, target: view(p, piece) };
  ctx.source = { piece: item, holder: view(p, piece) };
  handler.onEquip(ctx, ev);
  if (ev.error) throw new Error(ev.detail || '道具目标无效');
  if (ev.keep) throw new Error('持续回合道具暂未接入对抗测试版');
  p.items.splice(p.items.indexOf(item), 1); p.room.syncBonds(p); return true;
}

export function settleMetaWindows(p, elapsed) {
  if (p.role === 'attack') return;
  if (!p.metaWindow) resetMetaWindow(p);
  while (elapsed + 1e-9 >= p.metaWindow.next) {
    const owned = [...p.operators];
    for (const event of ['SERVER_PREP_FIN', 'SERVER_PREP_START']) {
      if (event === 'SERVER_PREP_START') {
        p.metaWindow.stats = freshStats(); p.metaWindow.counters.clear();
      }
      for (const o of owned) {
        if (!p.operators.includes(o)) continue;
        for (const id of data.chess[o.id]?.garrisonIds || []) {
          const g = data.garrisons[id];
          if (g?.eventType === event && WINDOW_META.has(g.effectKey)) runNativeMeta(p, o, g);
        }
      }
    }
    p.metaWindow.index++; p.metaWindow.next += META_WINDOW_SECONDS;
    p.room.syncBonds(p);
  }
}
