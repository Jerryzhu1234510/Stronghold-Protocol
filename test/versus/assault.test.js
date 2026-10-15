import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssaultRoom} from '../../server/versus/assault.js';
import {MONSTERS,OPERATORS,data} from '../../server/versus/catalog.js';
import {ownCol} from '../../server/versus/engine.js';

function setup(options={}) {
  const room=new AssaultRoom('TEST',{seed:81,prepSeconds:0,infoSeconds:0,...options});
  for(let i=0;i<4;i++)room.join(`Player ${i}`);
  room.start(room.host);room.players.forEach(p=>p.bot=false);room.tick();return room;
}
const roles=d=>({attack:d.pair.find(p=>p.role==='attack'),defend:d.pair.find(p=>p.role==='defend')});

test('exact four, two simultaneous pairings and native role-specific slot counts',()=>{
 const room=setup();assert.equal(room.duels.length,2);assert.equal(room.publicView().capacity,4);
 for(const d of room.duels){const {attack,defend}=roles(d);assert.ok(attack&&defend);
  const slots=room.gd.shopSlots(1);assert.equal(attack.shop.monster.length,slots.chess);assert.equal(attack.shop.operator.length,0);assert.equal(attack.shop.equipment.length,0);
  assert.equal(defend.shop.operator.length,slots.chess);assert.equal(defend.shop.equipment.length,slots.item);assert.equal(defend.shop.monster.length,0);
 }
 const lobby=new AssaultRoom('LOBBY');lobby.join('host');assert.throws(()=>lobby.start(lobby.host),/4/);
 for(let i=0;i<3;i++)lobby.join('member');assert.throws(()=>lobby.join('fifth'),/满/);
});

test('role restrictions reject actions without spending and attack upgrades need no defenders',()=>{
 const room=setup(),{attack,defend}=roles(room.duels[0]);const coins=attack.coins;
 assert.throws(()=>room.action(attack,{action:'buy',kind:'operator',index:0}),/攻方/);assert.equal(attack.coins,coins);
 assert.throws(()=>room.action(attack,{action:'deploy',uid:1}),/守方/);
 assert.throws(()=>room.action(defend,{action:'launch',id:MONSTERS[0].id}),/攻方/);
 assert.throws(()=>room.action(defend,{action:'buy',kind:'monster',index:0}),/守方/);
 attack.coins=100;room.action(attack,{action:'upgrade'});room.time=attack.upgradeNext;room.action(attack,{action:'upgrade'});assert.equal(attack.level,3);
 defend.coins=100;room.action(defend,{action:'upgrade'});room.time=defend.upgradeNext;assert.throws(()=>room.action(defend,{action:'upgrade'}),/部署/);
});

test('blue gate loss immediately swaps roles without elimination and other pairing keeps its clock',()=>{
 const room=setup(),d=room.duels[0],other=room.duels[1],first=roles(d),oldField=room.fieldViews(d.id)[first.defend.id].meta.fieldId;
 d.elapsed=91;first.defend.hp=0;first.defend.stats.leaks=20;room.resolveDuel(d);
 assert.equal(d.leg,2);assert.equal(d.elapsed,0);assert.equal(first.defend.eliminated,false);assert.equal(first.defend.role,'attack');
 assert.equal(d.legs[0].heldSeconds,91);assert.equal(d.legs[0].leaks,20);assert.notEqual(room.fieldViews(d.id)[first.defend.id].meta.fieldId,oldField);
 room.tick();assert.ok(other.elapsed>0);
});

test('eight minute timeout exchanges and defensive records decide fewer leaks then survival then value',()=>{
 for(const [a,b,winner] of [[{leaks:1,heldSeconds:50,killValue:1},{leaks:2,heldSeconds:480,killValue:100},0],
 [{leaks:2,heldSeconds:400,killValue:1},{leaks:2,heldSeconds:480,killValue:0},1],
 [{leaks:2,heldSeconds:480,killValue:99},{leaks:2,heldSeconds:480,killValue:1},0]]){
  const room=setup(),d=room.duels[0],defender=roles(d).defend;
  d.elapsed=480;defender.stats.leaks=a.leaks;defender.killValue=a.killValue;room.resolveDuel(d);assert.equal(d.leg,2);
  Object.assign(d.legs[0],a);const second=roles(d).defend;second.stats.leaks=b.leaks;second.killValue=b.killValue;d.elapsed=b.heldSeconds;second.hp=0;room.resolveDuel(d);
  assert.equal(d.winner,d.legs[winner].defender);assert.equal(d.legs.length,2);assert.equal(room.history[0].legs.length,2);
 }
});

test('role inventories and progress have independent banks within a pairing',()=>{
 const room=setup(),d=room.duels[0],{attack}=roles(d);attack.coins=73;attack.level=3;attack.monsters[MONSTERS[0].id]=6;
 room.beginLeg(d);assert.equal(attack.role,'defend');assert.equal(attack.coins,20);assert.equal(attack.level,1);assert.deepEqual(attack.monsters,{});
 attack.operators.push({uid:99,id:OPERATORS[0].id,row:null,col:null,items:[]});attack.coins=31;
 room.setRole(attack,'attack');assert.equal(attack.coins,73);assert.equal(attack.level,3);assert.equal(attack.monsters[MONSTERS[0].id],6);assert.equal(attack.operators.length,0);
 room.setRole(attack,'defend');assert.equal(attack.coins,31);assert.equal(attack.operators[0].uid,99);
});

test('pair-specific preparation never pauses the other pairing and disallows premature launch',()=>{
 const room=setup(),d=room.duels[0],other=room.duels[1];room.prepSeconds=20;room.beginLeg(d);
 const {attack}=roles(d);attack.monsters[MONSTERS[0].id]=3;
 assert.throws(()=>room.action(attack,{action:'launch',id:MONSTERS[0].id,row:3,col:ownCol(attack,9)}),/整备/);
 const prior=other.elapsed;room.tick();assert.equal(d.elapsed,0);assert.ok(other.elapsed>prior);assert.equal(room.publicView().duels[0].preparing,20);
});

test('four to two to one, placements and completed-pair income freeze',()=>{
 const room=setup();for(const d of room.duels)room.finishDuel(d,d.pair[0],'测试');
 const waiting=room.duels[0].pair[0];assert.equal(room.receivesIncome(waiting),false);
 room.tick();assert.equal(room.round,2);assert.equal(room.duels.length,1);assert.equal(room.players.filter(p=>p.placement===3).length,2);
 const d=room.duels[0];room.action(d.pair[1],{action:'forfeit'});room.tick();assert.equal(room.status,'complete');assert.equal(room.champion,d.pair[0].id);
 assert.deepEqual(room.publicView().results.map(p=>p.placement),[1,2,3,3]);
});

test('income remains every two seconds and kill grants one coin with cap100',()=>{
 const room=setup(),p=roles(room.duels[0]).defend,b=room.battleOf(p);p.coins=0;
 room.tick(.9);assert.equal(p.coins,0);room.tick(1.1);assert.equal(p.coins,1);
 b.emit('kill',{victim:{side:'enemy',mem:{},versusPurchased:true,versusPrice:5}});assert.equal(p.coins,2);
 p.coins=100;room.tick(2);assert.equal(p.coins,100);
});

test('all original maps accept one-way attack routes on either role assignment',()=>{
 for(const stage of Object.values(data.stages).filter(s=>s.active&&s.weight>0)){
  const room=setup({stageId:stage.id}),d=room.duels[0];
  for(let leg=1;leg<=2;leg++){
   const {attack,defend}=roles(d);let tile;
   for(let row=2;row<=5&&!tile;row++)for(const col of room.launchColumns(attack))if(room.battleOf(defend).grid.groundPassable(row,col)){tile={row,col};break;}
   attack.monsters[MONSTERS[0].id]=2;room.action(attack,{action:'launch',id:MONSTERS[0].id,...tile});
   assert.equal(room.battleOf(defend).aliveEnemies().filter(e=>e.sourcePlayerId===attack.id).length,2);
   assert.equal(room.battleOf(attack).aliveEnemies().length,0);
   if(leg===1)room.beginLeg(d);
  }
 }
});

test('level-up keeps existing cards and sold slots, only adds native new slots',()=>{
 const room=setup();for(const p of room.duels[0].pair){const kind=p.role==='attack'?'monster':'operator';
  p.coins=100;p.shop[kind][0]=null;const before=[...p.shop[kind]],equipment=[...p.shop.equipment];
  room.action(p,{action:'upgrade'});assert.deepEqual(p.shop[kind].slice(0,before.length),before);
  assert.deepEqual(p.shop.equipment,equipment);assert.equal(p.shop[kind].length,room.gd.shopSlots(2).chess);
 }
});
