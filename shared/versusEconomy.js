import { t } from './i18n.js';
export const VERSUS_UPGRADE_COSTS = Object.freeze([0, 10, 18, 28, 40, 55]);
export const VERSUS_UPGRADE_COOLDOWN = 20;
export const VERSUS_INCOME_INTERVAL = 2;
export const VERSUS_FAST_INCOME_AT = 240;
export const VERSUS_ATTACK_REWARD = 5;
export const VERSUS_SHOP_SLOTS = Object.freeze([0, 3, 4, 5, 6, 8, 10]);
export const VERSUS_COIN_CAP = 100;
export const VERSUS_LAYER_CAP = 200;
export const VERSUS_UPGRADE_ROSTER = Object.freeze([0, 0, 2, 3, 4, 4]);

export function versusIncomeInterval(elapsed = 0) {
  return elapsed >= VERSUS_FAST_INCOME_AT ? 1 : VERSUS_INCOME_INTERVAL;
}

export function versusIncomeBetween(from, to) {
  const earned = t => Math.floor((Math.min(Math.max(0, t), VERSUS_FAST_INCOME_AT) + 1e-9) / VERSUS_INCOME_INTERVAL)
    + Math.floor(Math.max(0, t - VERSUS_FAST_INCOME_AT) + 1e-9);
  return Math.max(0, earned(to) - earned(from));
}

export function versusShopSlots(level) {
  return { chess: VERSUS_SHOP_SLOTS[Math.max(1, Math.min(6, level))], item: 1 };
}

export function grantVersusCoins(player, amount) {
  const before = player.coins;
  player.coins = Math.min(VERSUS_COIN_CAP, before + amount);
  return Math.max(0, player.coins - before);
}

export function versusUpgradeState(player, time) {
  const level = player.level;
  const max = level >= 6;
  const price = max ? 0 : VERSUS_UPGRADE_COSTS[level];
  const required = max || player.role === 'attack' ? 0 : VERSUS_UPGRADE_ROSTER[level];
  const deployed = player.operators.filter(o => o.row != null).length;
  const cooldown = Math.max(0, Math.ceil((player.upgradeNext || 0) - time - 1e-9));
  const reason = max ? t('调度中心已达最高等级') : cooldown ? t('升本冷却中，剩余{cooldown}秒', { cooldown })
    : deployed < required ? t('升到{0}本需要部署至少{required}名干员（当前{deployed}名）', { 0: level + 1, required, deployed })
      : player.coins < price ? t('资金不足') : null;
  return { price, required, deployed, cooldown, reason };
}
