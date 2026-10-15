import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {createBattleMusicDetector}=require('../battle-music-events.cjs');
const unit=(id=1,ownerId='me',kind='op',side='ally')=>({id,ownerId,kind,side});
const state=(patch={})=>({connection:{status:'online'},me:{playerId:'me'},room:{code:'ROOM',inMatch:true,seats:[{playerId:'me'}],spectators:[]},match:{public:{phase:'COMBAT',round:1,players:[{playerId:'me',alive:true}]},field:{fieldId:'n:me',battleId:'one.1.1',live:true,units:[unit()]}},...patch});
const fx=(extra={})=>['fx','bondProc',2,3,{id:20,src:'bond:siracusaShip',key:'assassin',from:1,amount:150,...extra}];
const batch=(gt=1,ev=[fx()],fieldId='n:me')=>({t:'b.ev',fieldId,gt,ev});
let checks=0;
function eq(actual,expected,message){assert.equal(actual,expected,message);checks++;}
let d=createBattleMusicDetector(),s=state();
eq(d.consume(s,batch(),0).events[0].event,'siracusa-true-damage','exact live Siracusa proc');
eq(d.consume(s,batch(2),1999).events.length,0,'2s throttle');
eq(d.consume(s,batch(3),2000).events.length,1,'2s boundary');
eq(d.consume(s,batch(3),5000).events.length,0,'copied repeated batch is deduplicated after cooldown');
eq(d.consume(s,batch(2),5001).events.length,0,'a throttled batch is still consumed');
for(const tuple of [['dmg',20,150,'true'],['status',20,'freeze',1],fx({src:'bond:yanShip'}),fx({key:'fake'}),fx({amount:0}),fx({amount:-1}),fx({amount:'150'}),fx({from:99})]){
  d=createBattleMusicDetector();eq(d.consume(s,batch(1,[tuple]),0).events.length,0,'unrelated or malformed tuples ignored');
}
for(const source of [unit(1,'other'),unit(1,'me','token'),unit(1,'me','op','enemy')]){
  d=createBattleMusicDetector();const t=state();t.match.field.units=[source];eq(d.consume(t,batch(),0).events.length,0,'source ownership/type strict');
}
d=createBattleMusicDetector();const fresh=state();fresh.match.field.units=[];
eq(d.consume(fresh,batch(1,[['spawn',unit()],fx()]),0).events.length,1,'spawn map processed in tuple order');
d=createBattleMusicDetector();eq(d.consume(s,batch(1,[fx()],'n:other'),0).events.length,0,'wrong field ignored');
for(const phase of ['PREP','SETTLE','RESULT','INFO_CHECK']){
  d=createBattleMusicDetector();const t=state();t.match.public.phase=phase;eq(d.consume(t,batch(),0).events.length,0,'not in battle');
}
for(const phase of ['UNITE','FINAL_ASSAULT','HIDDEN_CORE']){
  d=createBattleMusicDetector();const t=state();t.match.public.phase=phase;eq(d.consume(t,batch(),0).events.length,1,'combat phase supported');
}
for(const change of ['spectator','left','eliminated','wrong-seat','closed-field','not-in-match','versus']){
  const t=state();if(change==='spectator')t.room.spectators=[{playerId:'me'}];if(change==='left')t.match.public.players[0].status='left';if(change==='eliminated')t.match.public.players[0].alive=false;if(change==='wrong-seat')t.room.seats=[{playerId:'other'}];if(change==='closed-field')t.match.field.live=false;if(change==='not-in-match')t.room.inMatch=false;if(change==='versus')t.match.public.modeId='versus';
  d=createBattleMusicDetector();eq(d.consume(t,batch(),0).events.length,0,'viewer/phase restriction '+change);
}
d=createBattleMusicDetector();d.consume(s,batch(),0);
const offline=state({connection:{status:'reconnecting'}});eq(d.consume(offline,null,3000).active,false,'disconnect stops events');
eq(d.consume(s,batch(4),4000).events.length,0,'first recovery batch is baseline only');
eq(d.consume(s,batch(5),4001).events.length,1,'new live recovery event works');
d=createBattleMusicDetector();d.consume(s,batch(),0);const otherField=state();otherField.match.field={fieldId:'n:other',battleId:'two',live:true,units:[unit(1,'other')]};eq(d.consume(otherField,batch(2,[fx()],'n:other'),3000).events.length,0,'switching to teammate cannot reuse own unit map');
const isolated=vm.runInNewContext('('+createBattleMusicDetector.toString()+')()');eq(isolated.consume(s,batch(),0).events.length,1,'factory embeds without require or closure');
const frozen=(sourceKind='operator',extra={})=>['fx','desktopFreeze',2,3,{ownerId:'me',sourceKind,from:1,id:20,...extra}];
d=createBattleMusicDetector();
eq(d.consume(s,batch(1,[frozen()]),0).events[0].event,'kjerag-operator-freeze','marked real operator freeze');
eq(d.consume(s,batch(2,[frozen('alliance',{from:null})]),1).events[0].event,'kjerag-alliance-freeze','marked real alliance freeze is independent');
eq(d.consume(s,batch(3,[frozen()]),1999).events.length,0,'operator freeze cooldown');
eq(d.consume(s,batch(4,[frozen()]),2000).events.length,1,'operator freeze 2s boundary');
eq(d.consume(s,batch(5,[frozen('alliance',{from:null})]),2000).events.length,0,'alliance freeze cooldown separate');
eq(d.consume(s,batch(6,[frozen('alliance',{from:null})]),2001).events.length,1,'alliance freeze 2s boundary');
for(const tuple of [frozen('operator',{ownerId:'other'}),frozen('alliance',{ownerId:'other'}),frozen('environment'),frozen('operator',{from:99}),frozen('operator',{id:0}),['fx','coldWind',2,3,{playerId:'me',n:10}],['status',20,'freeze',1]]){
  d=createBattleMusicDetector();eq(d.consume(s,batch(1,[tuple]),0).events.length,0,'no guessed freeze provenance');
}
console.log(JSON.stringify({ok:true,checks,semantics:'Siracusa effect proc and trusted real-freeze provenance; no generic freeze inference'}));
