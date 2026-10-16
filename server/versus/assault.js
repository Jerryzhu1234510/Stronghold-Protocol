import { VersusRoom, ownCol, GROUP_COLORS } from './engine.js';
import { OPERATORS, MONSTERS, EQUIPMENT, byId, data } from './catalog.js';
import { versusCanStand } from '../../shared/versusPlacement.js';
import { versusUpgradeState, versusShopSlots, versusIncomeBetween } from '../../shared/versusEconomy.js';
import { resetMetaWindow } from './metaWindow.js';
import { t } from '../../shared/i18n.js';

const BANK_KEYS = ['coins','level','upgradeNext','operators','monsters','items','offers','shop','freeRefresh','layers','bonds'];
const freshBank = () => ({coins:20,level:1,upgradeNext:0,operators:[],monsters:{},items:[],offers:[],shop:{},freeRefresh:0});

export class AssaultRoom extends VersusRoom {
  constructor(code, options = {}) { super(code, {...options, playerCount:4}); }
  refresh(p, paid = true) {
    const free = p.freeRefresh > 0;
    if (paid) {
      if (!p.freeRefresh && p.coins < 1) throw new Error('金币不足');
      if (p.freeRefresh) p.freeRefresh--; else { p.coins--;p.stats.spent++; }
      p.refreshCount++;
    }
    const slots=versusShopSlots(p.level);
    const ops=OPERATORS.filter(o=>!this.bannedChess.has(o.id)&&o.tier<=Math.min(6,p.level+1));
    p.shop={operator:p.role==='attack'?[]:Array.from({length:slots.chess},()=>this.pick(ops)?.id),
      monster:p.role==='attack'?Array.from({length:slots.chess},()=>this.pick(MONSTERS.filter(e=>e.tier<=p.level))?.id):[],
      equipment:p.role==='attack'?[]:Array.from({length:slots.item},()=>this.pick(EQUIPMENT.filter(e=>e.tier<=p.level))?.id)};
    if (paid) this.onManualRefresh(p, free);
  }
  setRole(p, role) {
    p.roleBanks ||= {};
    if (p.role) p.roleBanks[p.role]=Object.fromEntries(BANK_KEYS.map(key=>[key,p[key]]));
    Object.assign(p,p.roleBanks[role]||freshBank());p.role=role;
    Object.assign(p,{hp:20,layers:{},bonds:{},kills:0,killValue:0,launchNext:0,duelTime:0,economyNext:0,freeRefreshNext:0,refreshCount:0,giftIndex:0});
    resetMetaWindow(p);
    this.refresh(p,false);
  }
  beginStage(entrants) {
    for (const p of entrants) { p.roleBanks = {}; p.role = null; Object.assign(p, freshBank()); }
    this.round++;this.status='preparation';this.deadline=this.time+this.prepSeconds;
    this.duels=[];
    for(let i=0;i<entrants.length;i+=2) {
      const pair=entrants.slice(i,i+2),d={id:`r${this.round}d${i/2}`,color:GROUP_COLORS[i/2],pair,battles:[],elapsed:0,done:false,winner:null,reason:null,leg:0,legs:[]};
      this.duels.push(d);pair.forEach((p,j)=>{p.duel=d.id;p.side=j?'R':'L';});this.beginLeg(d);
      if(pair.some(p=>p.eliminated))this.finishDuel(d,pair.find(p=>!p.eliminated)||pair[0],t('退出'));
    }
  }
  beginLeg(d) {
    d.leg++;d.elapsed=0;d.simCarry=0;d.readyAt=this.time+this.prepSeconds;
    d.pair.forEach((p,i)=>this.setRole(p,i===(d.leg-1)?'attack':'defend'));
    const defender=d.pair.find(p=>p.role==='defend');d.startLeaks=defender.stats.leaks;
    d.battles=d.pair.map(p=>this.makeBattle(p,d));
    for(const o of defender.operators)if(o.row!=null)this.addOperator(defender,o);
    for(const p of d.pair)this.syncBonds(p);
  }
  action(p,msg) {
    if (p && !['infoReady','forfeit'].includes(msg.action)) {
      if (msg.action==='buy' && (p.role==='attack' ? msg.kind!=='monster' : msg.kind==='monster')) throw new Error(p.role==='attack'?'攻方只能购买怪物':'守方只能购买干员和装备');
      if (msg.action==='launch' && p.role!=='attack') throw new Error('只有攻方可以投怪');
      if (['deploy','move','withdraw','rotate','equip','reward'].includes(msg.action) && p.role!=='defend') throw new Error('只有守方可以操作干员和装备');
    }
    const previous=msg.action==='upgrade'?p?.shop:null;
    const result=super.action(p,msg);
    if(previous)for(const kind of ['operator','monster','equipment']) {
      p.shop[kind]=p.shop[kind].map((id,index)=>index<previous[kind].length?previous[kind][index]:id);
    }
    return result;
  }
  resolveDuel(d) {
    const defender=d.pair.find(p=>p.role==='defend');
    if(defender.hp>0&&d.elapsed<this.duelSeconds)return;
    d.legs.push({defender:defender.id,attacker:d.pair.find(p=>p.role==='attack').id,leaks:defender.stats.leaks-d.startLeaks,
      heldSeconds:Math.min(d.elapsed,this.duelSeconds),killValue:defender.killValue,hp:defender.hp,reason:defender.hp<=0?t('蓝门失守'):t('时间耗尽')});
    if(d.leg===1){this.beginLeg(d);return;}
    const ranked=[...d.legs].sort((a,b)=>a.leaks-b.leaks||b.heldSeconds-a.heldSeconds||b.killValue-a.killValue);
    const tied=ranked[0].leaks===ranked[1].leaks&&ranked[0].heldSeconds===ranked[1].heldSeconds&&ranked[0].killValue===ranked[1].killValue;
    const id=tied?d.pair[Math.floor(this.random()*2)].id:ranked[0].defender;
    this.finishDuel(d,d.pair.find(p=>p.id===id),tied?t('攻守完全同分 · 抽签'):t('攻守两段结算'));
  }
  finishDuel(d,winner,reason) {
    if(d.done)return;
    super.finishDuel(d,winner,reason);
    d.pair.find(p=>p!==winner).placement=this.round===1?3:2;
    const entry=this.history.at(-1);entry.time=Math.round(d.legs.reduce((sum,leg)=>sum+leg.heldSeconds,0));entry.legs=structuredClone(d.legs);entry.results=d.pair.map(p=>this.resultOf(p));
  }
  receivesIncome(p) { return !p.eliminated&&!this.duels.find(d=>d.id===p.duel)?.done; }
  launchColumns(p) {
    const defender = this.duels.find(d => d.id === p.duel)?.pair.find(other => other.role === 'defend');
    return defender ? [ownCol(defender, 8), ownCol(defender, 9)] : super.launchColumns(p);
  }
  fieldViews(id) {
    const feeds = super.fieldViews(id), d = this.duels.find(d => d.id === id);
    if (!feeds || !d) return feeds;
    const attacker = d.pair.find(p => p.role === 'attack'), defender = d.pair.find(p => p.role === 'defend');
    if (attacker && defender) feeds[attacker.id] = { ...feeds[defender.id], playerId: attacker.id };
    return feeds;
  }
  incomeBetween(p, from, to) {
    const d = this.duels.find(d => d.id === p.duel);
    if (!d) return 0;
    const combatFrom = this.status === 'combat' ? Math.max(from, d.readyAt) : Math.max(from, this.deadline, d.readyAt);
    const fighting = Math.max(0, to - combatFrom);
    const preparing = Math.max(0, to - from - fighting);
    const prepCoins = Math.floor((from + preparing + 1e-9) / 2) - Math.floor((from + 1e-9) / 2);
    return prepCoins + versusIncomeBetween(d.elapsed, d.elapsed + fighting);
  }
  resultOf(p) {
    const result=super.resultOf(p),defense=p.role==='defend'?p:p.roleBanks?.defend;
    if(defense){result.lineup=defense.operators.filter(o=>o.row!=null).map(o=>({id:o.id,items:[...o.items]}));result.bonds=structuredClone(defense.bonds||{});}
    result.defense=this.history.flatMap(entry=>entry.legs||[]).filter(leg=>leg.defender===p.id);
    result.role=p.role;return result;
  }
  publicView() {
    const view=super.publicView();view.format='attack-defense';view.capacity=4;
    view.players.forEach(p=>{p.role=this.players.find(o=>o.id===p.id).role||null;});
    view.duels.forEach(d=>{const live=this.duels.find(o=>o.id===d.id);Object.assign(d,{leg:live.leg,legs:live.legs,attacker:live.pair.find(p=>p.role==='attack')?.id,
      defender:live.pair.find(p=>p.role==='defend')?.id,preparing:Math.max(0,Math.ceil(live.readyAt-this.time))});});return view;
  }
  privateView(p) { return {...super.privateView(p),role:p.role||null}; }
  botAction(p,d) {
    if(this.time<(p.botNext||0))return;p.botNext=this.time+1.2+this.random();
    try {
      if(p.role==='defend') {
        if(p.offers.length&&p.operators.length<16){this.action(p,{action:'reward',index:0});return;}
        const o=p.operators.find(o=>o.row==null),b=this.battleOf(p);
        if(o&&p.operators.filter(o=>o.row!=null).length<8)for(let r=5;r>=2;r--)for(const c of [5,4,6,3,7,8,9]) {
          const col=ownCol(p,c);if(!b.isReservedTile(r,col)&&versusCanStand(b.grid,this.stage,r,col,data.chess[o.id])){this.action(p,{action:'deploy',uid:o.uid,row:r,col});return;}
        }
      } else if(this.status==='combat'&&this.time>=d.readyAt&&Object.keys(p.monsters).length) {
        this.action(p,{action:'launch',id:Object.keys(p.monsters)[0],row:this.pick([3,4,5]),col:this.pick(this.launchColumns(p))});return;
      }
      const upgrade=versusUpgradeState(p,this.time);
      if(!upgrade.reason&&p.coins>=upgrade.price+6){this.action(p,{action:'upgrade'});return;}
      const kind=p.role==='attack'?'monster':'operator',index=p.shop[kind].findIndex(id=>id&&byId.get(id).price<=p.coins);
      if(index>=0)this.action(p,{action:'buy',kind,index});else if(p.coins>=2)this.refresh(p);
    } catch { /* Retry after capacity, cooldown or placement changes. */ }
  }
}
