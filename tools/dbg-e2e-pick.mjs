// dbg-e2e-pick.mjs — 端到端核对：人 + 机器人选外援后，记录表/池子/商店/抽取都自洽
import { makeMatch, DATA, checkInvariants } from '../test/match/harness.js';
import { waiguanRecords } from '../shared/waiguan.js';

const ROSTER = DATA.waiguan;
const RECORDS = waiguanRecords(ROSTER);
const cand = ROSTER.candidates.find((c) => c.charId === 'char_1035_wisdel');
const chess6 = cand.chessIds[6];

// 1 人 + 1 机器人
const seats = [
  { seat: 0, playerId: 'p_0', name: '人', isBot: false, connected: true, picks: { diy6a: cand.charId } },
  { seat: 1, playerId: 'ai_0', name: 'AI', isBot: true, connected: true, picks: null },
];
const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 5 }).start();
const m = h.m;

console.log('人的外援:', JSON.stringify(m.waiguanPicks.p_0));
console.log('机器人的外援:', JSON.stringify(m.waiguanPicks.ai_0));

// 关键：机器人选的每条是否都在这一局的 chess 表里（这正是之前 invariant 报的错）
let bad = 0;
for (const [pid, picks] of Object.entries(m.waiguanPicks)) {
  for (const [slot, charId] of Object.entries(picks)) {
    const rec = ROSTER.candidates.find((c) => c.charId === charId)?.chessIds[slot.startsWith('diy5') ? 5 : 6];
    if (!m.gd.chess(rec)) { console.log(`  ✘ ${pid} ${slot}=${charId} 的记录 ${rec} 不在 chess 表`); bad++; }
    if (!m.pool.has(rec, pid)) { console.log(`  ✘ ${pid} 的池子没有 ${rec}`); bad++; }
  }
}
console.log(bad ? `✘ ${bad} 处不一致` : '✔ 每个人的外援都在记录表且在自己的池子里');

// 机器人的商店能刷到自己的外援吗
const ai = h.ps('ai_0');
ai.shop.level = 6;
const aiIds = Object.values(m.waiguanPicks.ai_0 || {});
let aiHits = 0;
for (let i = 0; i < 200; i++) {
  ai.rollShop({ keepFrozen: false });
  const ids = ai.shop.slots.filter((s) => s && s.kind === 'chess').map((s) => s.id);
  if (ids.some((id) => aiIds.some((ch) => ROSTER.candidates.find((c) => c.charId === ch)?.chessIds[6] === id || ROSTER.candidates.find((c) => c.charId === ch)?.chessIds[5] === id))) aiHits++;
}
console.log(`机器人 rollShop 200 次刷到自己的外援 ${aiHits} 次`);

// 人的商店能刷到自己的
const me = h.ps('p_0');
me.shop.level = 6;
let meHits = 0;
for (let i = 0; i < 200; i++) {
  me.rollShop({ keepFrozen: false });
  if (me.shop.slots.some((s) => s && s.id === chess6)) meHits++;
}
console.log(`人     rollShop 200 次刷到自己的外援 ${meHits} 次`);
try { checkInvariants(m); console.log('✔ 不变量通过'); } catch (e) { console.log('✘ 不变量失败:', e.message); }
void RECORDS;
m.dispose();
