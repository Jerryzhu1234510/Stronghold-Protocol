// 外援 / 甄选 自检 (DESIGN §21.2): 把「我选了谁 → 对应哪条棋表记录 → 我的技能/模组条目 → 局内真正生效的值」摊开，
// 并把踩过的坑直接标成警告。技能与模组是**按棋表记录（含阶位）分开存**的，所以「装在另一阶记录上」这类错误以前只能靠
// 对比截图发现（owner's report 2026-10-06）。
//
// 纯函数，无副作用：`waiguanDoctor({ waiguan, picks, entries, priv })` → { lines, warnings }。
import { WAIGUAN_SLOTS, waiguanRecords } from '../../../shared/waiguan.js';
import { waiguanPickChess } from './loadoutModel.js';

/** 「五阶 · 一（diy5a）」 — the wording the 干员调配 slots use, built from the slot id itself. */
const ORD = { a: '一', b: '二' };
const labelOf = (slot) => `${slot.tier === 6 ? '六阶' : '五阶'} · ${ORD[slot.slot.slice(-1)] || slot.slot.slice(-1)}（${slot.slot}）`;
const skillOf = (entry, options) => {
  if (!entry || !Number.isInteger(entry.skill)) return '默认';
  const opt = (options || []).find((o) => o.index === entry.skill);
  return opt ? `S${entry.skill + 1} ${opt.name}` : `S${entry.skill + 1}`;
};

/**
 * @param {{ waiguan: any, picks: Record<string, string>|null, entries: Record<string, any>|null,
 *           priv?: any, skillOptionsOf?: (chessId: string) => Array<{ index: number, name: string }> }} o
 *        `priv` = an in-match m.private (adds what each owned 外援 piece actually fights with)
 * @returns {{ lines: string[], warnings: string[] }}
 */
export function waiguanDoctor({ waiguan, picks, entries, priv = null, skillOptionsOf = null } = {}) {
  const lines = [];
  const warnings = [];
  const roster = picks && typeof picks === 'object' ? picks : {};
  const loadout = entries && typeof entries === 'object' ? entries : {};
  const records = waiguan ? waiguanRecords(waiguan) : {};
  const byChar = new Map((Array.isArray(waiguan?.candidates) ? waiguan.candidates : []).map((c) => [c.charId, c]));
  const all = waiguan ? waiguanPickChess(waiguan, roster) : {};

  const filled = WAIGUAN_SLOTS.filter((s) => typeof roster[s.slot] === 'string' && roster[s.slot]);
  if (!filled.length) lines.push('外援位：四个都是空的（这一局不会发外援卡）。');
  // every entry that names a 甄选 record, so a stale one is visible instead of silently ignored
  const usedKeys = new Set();
  for (const slot of filled) {
    const charId = roster[slot.slot];
    const cand = byChar.get(charId);
    const base = cand?.chessIds?.[slot.tier] || null;
    lines.push(`选人：${labelOf(slot)} = ${cand?.name || charId} → 记录 ${base || '（找不到，名单可能已更新）'}`);
    if (!base) continue;
    const entry = loadout[base];
    if (entry) usedKeys.add(base);
    const options = skillOptionsOf ? skillOptionsOf(base) : null;
    const skill = entry ? skillOf(entry, options) : '默认（这套调配里没有它的条目）';
    const mod = entry?.module && entry.module !== 'none' ? entry.module : '未装';
    lines.push(`  技能 ${entry ? '已装' : ''}：${skill}　模组：${mod}`);
    if (!entry) warnings.push(`${cand?.name || charId}（${labelOf(slot)}）没有自己的技能条目，局内用默认技能。`);
  }
  // entries on 甄选 records that no pick can ever field — the trap that started all of this
  for (const [chessId, entry] of Object.entries(loadout)) {
    if (!String(chessId).includes('_diy_') || usedKeys.has(chessId)) continue;
    const rec = records[chessId];
    const cand = rec ? byChar.get(rec.charId) : null;
    const slot = filled.find((s) => roster[s.slot] === rec?.charId);
    if (slot && !loadout[cand?.chessIds?.[slot.tier]]) {
      warnings.push(`${cand?.name || rec?.charId}：技能装在「${rec?.tier} 阶记录」上，但你的位子是「${labelOf(slot)}」—— `
        + `这一局不会生效，请在干员调配里改到「${slot.label || slot.slot}」那一行（S${(entry?.skill ?? 0) + 1}）。`);
    } else if (slot) {
      // the picked tier already has its own entry: the other tier's leftover never applies, but nothing is wrong
      lines.push(`（另有「${rec?.tier} 阶记录」上的一条旧条目：${cand?.name || rec?.charId} —— 与你的位子无关，可忽略。）`);
    } else {
      warnings.push(`${chessId}：这条技能条目不属于你本局选的外援（多为之前留下的旧条目，可忽略；`
        + `想清掉就在干员调配里点一次「全部恢复默认」再重新设置）。`);
    }
  }
  if (priv) {
    // what the SERVER resolved for each pick — visible without owning a piece yet, so "did it take effect" is answerable
    // the moment a match exists
    const serverLo = priv.loadout && typeof priv.loadout === 'object' ? priv.loadout : {};
    for (const slot of filled) {
      const charId = roster[slot.slot];
      const cand = byChar.get(charId);
      const base = cand?.chessIds?.[slot.tier] || null;
      if (!base) continue;
      const eff = serverLo[base] || null;
      lines.push(`局内（服务端）：${cand?.name || charId}（${labelOf(slot)}）→ 技能 `
        + `${eff && Number.isInteger(eff.skill) ? `S${eff.skill + 1}` : 'S1（默认）'}${eff?.module && eff.module !== 'none' ? `，模组 ${eff.module}` : ''}`);
    }
    const own = [...(Array.isArray(priv.board) ? priv.board : []), ...(Array.isArray(priv.hand) ? priv.hand : [])]
      .filter((p) => p && p.kind === 'chess' && String(p.id).includes('_diy_'));
    if (!own.length) lines.push('局内：棋盘与手牌上暂时没有外援棋子。');
    for (const p of own) {
      const rec = records[String(p.id).replace(/_b$/, '_a')] || records[p.id];
      const eff = priv.loadout?.[String(p.id).replace(/_b$/, '_a')] || null;
      lines.push(`局内：${rec?.name || p.id}（${rec?.tier ?? '?'} 阶）→ 技能 ${eff && Number.isInteger(eff.skill) ? `S${eff.skill + 1}` : 'S1（默认）'}`
        + `${eff?.module && eff.module !== 'none' ? `，模组 ${eff.module}` : ''}`);
    }
  }
  return { lines, warnings };
}
