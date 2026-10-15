import { data } from './catalog.js';
import { grantVersusCoins, VERSUS_LAYER_CAP } from '../../shared/versusEconomy.js';
import { VERSUS_EGIR_PER_LAYER } from '../../shared/versusBonds.js';
import { HANDLERS } from '../sim/content/garrisons/meta.js';
import { WINDOW_META, runNativeMeta, metaEligible } from './metaWindow.js';

export const SUPPORTED_META = new Set(Object.keys(HANDLERS));
export function traitsOf(piece) {
  return (data.chess[piece.id]?.garrisonIds || []).map(id => data.garrisons[id]).filter(Boolean);
}
export function addLayer(p, id, n) {
  if (!data.bonds[id] || !Number.isFinite(n) || n <= 0) return;
  p.layers[id] = Math.min(VERSUS_LAYER_CAP, (p.layers[id] || 0) + n);
}
export function metaTrait(p, piece, g, context) {
  if (context !== 'kill') return runNativeMeta(p, piece, g);
  if (WINDOW_META.has(g.effectKey)) return;
  const bb = g.bb || {}, str = g.bbStr || {};
  const named = String(str.bond || '').split(',').filter(Boolean);
  let bonds = named.length ? named : (data.chess[piece.id]?.bonds || []);
  const amount = bb.count ?? bb.layer ?? 1;
  const requiresActive=context==='kill'||/已激活|当前激活/.test(g.desc||'');
  const grant=(id,n)=>{if(!requiresActive||p.bonds[id]?.active)addLayer(p,id,n);};
  if (g.effectKey === 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER') {
    const id=Object.entries(p.bonds).filter(([,state])=>state.active).sort((a,b)=>b[1].layers-a[1].layers)[0]?.[0];
    if(id)grant(id,amount);return;
  }
  if (g.effectKey === 'SERVER_ADD_MULTIPLE_BOND') {
    const counts=String(str.count||'').split(',').map(Number);bonds.forEach((id,i)=>grant(id,counts[i]||0));return;
  }
  if (g.effectKey === 'SERVER_CHESS_PRICE') return;
  if (g.effectKey.includes('GOLD')) {
    if (context !== 'kill' || p.economyNext > p.duelTime) return;
    if (g.effectKey.endsWith('WITH_BOND_CONDITION') && piece.row == null && !bonds.some(id => p.bonds[id]?.active)) return;
    grantVersusCoins(p, 1);
    p.economyNext = p.duelTime + 4;
    return;
  }
  if (g.effectKey === 'SERVER_GAIN_FREE_REFRESH_COUNT') {
    if (p.freeRefreshNext > p.duelTime) return;
    p.freeRefresh = Math.min(2, p.freeRefresh + (context === 'kill' ? 1 : (bb.count || 1)));
    p.freeRefreshNext = p.duelTime + 20;
    return;
  }
  if (g.effectKey === 'SERVER_ADD_BOND_POSITION') {
    const [dr,dc]=({UP:[1,0],DOWN:[-1,0],LEFT:[0,-1],RIGHT:[0,1]})[piece.dir||'RIGHT'];
    const direction = str.dir === 'front' ? 1 : -1;
    const target = p.operators.find(o => o.row === piece.row+dr*direction && o.col === piece.col+dc*direction);
    bonds=[...bonds,...(target?data.chess[target.id]?.bonds||[]:[])];
  }
  if (g.effectKey.startsWith('SERVER_ADD_BOND')) for (const id of bonds) grant(id, amount);
}
export function triggerMeta(p, piece, event, context) {
  if (p.role === 'attack') return;
  for (const g of traitsOf(piece)) if (g.eventType === event && SUPPORTED_META.has(g.effectKey) && metaEligible(piece, g)) {
    const investment = p.bonds.investShip;
    const repeat = event === 'SERVER_GAIN' && investment?.active ? (investment.layers >= 100 ? 3 : 2) : 1;
    for (let i = 0; i < repeat; i++) metaTrait(p, piece, g, context);
  }
}
export function traitNotes(id) {
  return traitsOf({ id }).map(g => {
    const prep = /PREP/.test(g.eventType), battle = g.eventType === 'IN_BATTLE';
    let desc = g.desc, conversion = battle ? '战斗特质' : '对抗模式';
    if (!battle && g.effectKey.includes('GOLD')) {
      desc = prep ? '己方击倒投放敌人时额外获得1金币，全队共享4秒冷却；原有整备区生效条件保留。'
        : `${g.eventType === 'SERVER_CHESS_SOLD' ? '售出' : '获得'}后，接下来${g.bb.count || 1}次有效击杀各额外获得1金币，全队共享4秒冷却；奖励只发一次。`;
    }
    else if (prep && WINDOW_META.has(g.effectKey)) {
      desc = g.desc.replace(/<进入休整期时>|<休整期结束时>/g, '<每30秒结算>')
        .replace(/当前休整期|本回合|每回合/g, '当前30秒窗口').replace(/奇数回合/g, '奇数统计窗口')
        .replace(/“进入休整期时”|“休整期结束时”/g, '“30秒结算”');
      conversion = '每30秒统计结算；保留原条件和单次上限；所有盟约上限200层';
    }
    else if (g.effectKey === 'SERVER_GAIN_FREE_REFRESH_COUNT') {
      const trigger = prep ? '己方击倒投放敌人时' : g.eventType === 'SERVER_CHESS_SOLD' ? '售出时' : '获得时';
      desc = `${trigger}获得${prep ? 1 : g.bb.count || 1}次免费刷新，最多储存2次，全队共享20秒冷却。`;
    } else if (prep && g.effectKey.startsWith('SERVER_ADD_BOND')) {
      desc = g.desc.replace(/<[^>]+>/g, '').replace(/本回合|下回合|每回合/g, '').trim();
      desc = `己方每击倒一名投放敌人：${desc}`;
      if (g.effectKey === 'SERVER_ADD_BOND_METHOD') conversion = '击杀触发，每次至多增加2层；所有盟约上限200层';
      else conversion = '击杀触发；所有盟约上限200层';
    } else if (g.eventType === 'SERVER_REFRESH_SHOP') {
      desc = g.desc.replace(/本回合/g, '当前30秒窗口');
      conversion = '主动刷新触发；每名干员的首次刷新计数每30秒重置；所有盟约上限200层';
    }
    return { desc, ready: battle || SUPPORTED_META.has(g.effectKey), conversion };
  });
}
// Live passive subset for the acceptance build. Complex bond mechanics remain deliberately out of the prototype.
export function applyPassives(b, p) {
  for (const u of b.allyUnits) {
    if (u.kind !== 'op' || u.removed) continue;
    const mods = {};
    for (const [id, state] of Object.entries(p.bonds)) {
      if (!state.active) continue;
      const bb = data.bonds[id]?.bb || {}, L = Math.min(VERSUS_LAYER_CAP, state.layers);
      const own = (u.def.raw?.bonds || []).includes(id);
      if ((id === 'yanShip' || id === 'preciShip') && own) mods.atkPct = (mods.atkPct || 0) + (bb.base_atk || 0) + (bb.atk_per_stack || 0) * L;
      if ((id === 'egirShip' && own) || id === 'steadShip') mods.hpPct = (mods.hpPct || 0) + (bb.base_max_hp || 0) + (bb.max_hp_per_stack || 0) * L;
      if (id === 'egirShip' && own) {
        mods.atkPct = (mods.atkPct || 0) + VERSUS_EGIR_PER_LAYER * L;
        mods.hpPct = (mods.hpPct || 0) + VERSUS_EGIR_PER_LAYER * L;
      }
      if (id === 'deputShip') { mods.defPct = (mods.defPct || 0) + bb.base_def + bb.def_per_stack * L; mods.redeployMul = 0.7; }
      if (id === 'skillfulShip' && own) mods.aspd = (mods.aspd || 0) + bb.base_attack_speed + bb.attack_speed_per_stack * L;
      if (id === 'soloShip' && own) { mods.atkPct = (mods.atkPct || 0) + bb.atk; mods.hpPct = (mods.hpPct || 0) + bb.max_hp; }
      if (id === 'emptyShip') { mods.physTakenMul = 0.8; mods.artsTakenMul = 0.8; }
    }
    b.addBuff(u, { key: 'versus:passive', persist: true, allowDead: true, refresh: 'replace', mods });
  }
}

export function installEgirRevives(b, p) {
  let used = 0;
  const knockedOut = new Set();
  b.on('death', c => {
    const u = c.unit, bond = p.bonds.egirShip;
    if (c.reason === 'killed' && u.ownerId === p.id) {
      const o = p.operators.find(o => o.uid === u.uid);
      if (o) o.egirSeconds = 0;
    }
    if (c.reason !== 'killed' || c.revivedBy || u.kind !== 'op' || u.ownerId !== p.id
      || !bond?.active || bond.count < 5 || !(u.def.raw?.bonds || []).includes('egirShip')
      || knockedOut.has(u.uid) || u.alive || u.removed) return;
    knockedOut.add(u.uid);
    if (used >= 3 || !b.redeploy(u, { free: true })) return;
    used++;
    b.fx('revive', { x: u.x, y: u.y, id: u.id, n: used });
  }, { priority: 11 });
}

export function tickEgirLayers(b, p, seconds) {
  let gained = 0;
  for (const o of p.operators) {
    if (!(data.chess[o.id]?.bonds || []).includes('egirShip')) continue;
    const u = b.allyUnits.find(u => u.uid === o.uid && !u.removed);
    if (o.row == null || !u?.alive || !u.deployed || u.hidden) { o.egirSeconds = 0; continue; }
    const elapsed = (o.egirSeconds || 0) + seconds;
    const count = Math.floor((elapsed + 1e-9) / 5);
    o.egirSeconds = Math.max(0, elapsed - count * 5);
    gained += count;
  }
  if (!gained) return false;
  addLayer(p, 'egirShip', gained);
  return true;
}
