export const validGameMode = value => value === 'normal' || value === 'clone' || value === 'versus';
export const gameModeName = value => value === 'versus' ? '对抗模式（测试）' : value === 'clone' ? '克隆模式' : '正常模式';
export const CLONE_DESCRIPTION = '当前模式《倾向盟约》刷新百分百必出两个所选盟约干员；满员时Boss总血量为基础血量的24/30/36/42/48倍，分别对应4/5/6/7/8人房。';

/** Only submitted votes count; abstentions use the default only when nobody voted. */
export function cloneBandWinner(votes, eligible, allowed, rng, fallback) {
  const counts = new Map();
  for (const pid of eligible) {
    const band = votes[pid];
    if (allowed.includes(band)) counts.set(band, (counts.get(band) || 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  const tied = allowed.filter(id => counts.get(id) === max);
  return max > 0 ? tied[Math.min(tied.length - 1, Math.floor(rng() * tied.length))] : fallback;
}
