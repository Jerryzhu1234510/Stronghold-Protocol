import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { createBattleFromSpec, buildBattleSpec } from '../server/sim/spec.js';
import { computeBonds } from '../server/match/bondsMeta.js';
import { GameData } from '../server/match/gamedata.js';
import { TRAINING_KEY, TRAINING_HISTORY_KEY, defaultScenario, validateScenario, legalTiles, trainingBonds, battleOptions,
  loadTraining, saveTraining, summarizeTraining, saveTrainingResult } from '../public/js/training/model.js';

const raw = getData({ log: { warn(){}, error(){}, info(){}, debug(){} } });
const ds = new DataSource(raw,null);
const clone = o => JSON.parse(JSON.stringify(o));
const storage = () => { const map = new Map([['sp-account-token','keep'],['sp-formal-history','keep']]); return { getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),map }; };
const battleFor = s => createBattleFromSpec(buildBattleSpec(battleOptions(s,raw)),ds,{logger:{warn(){},error(){},info(){},debug(){}}});

test('training scenarios validate maps, placement, bounded inputs and known data',()=>{
  const s=defaultScenario(raw);assert.equal(validateScenario(s,raw).units.length,3);
  for(const mutate of [s=>s.seed=Infinity,s=>s.hpMul=97,s=>s.seconds=301,s=>s.layers.__unknown=2,s=>s.layers.victoriaShip=1000,
    s=>s.units[0].chessId='__proto__',s=>s.units[0].items=['wrong'],s=>s.units[0].items=Array(3).fill('chess_item_1_01_e_a'),
    s=>s.enemies[0].count=101,s=>s.enemies[0].time=89,s=>{s.units[1].row=s.units[0].row;s.units[1].col=s.units[0].col;}]){
    const c=clone(s);mutate(c);assert.throws(()=>validateScenario(c,raw));
  }
  const boss={...clone(s),kind:'boss'};
  const used=new Set();for(const u of boss.units){const p=legalTiles(raw,boss,u.chessId).find(p=>!used.has(p.join(',')));[u.row,u.col]=p;used.add(p.join(','));}
  assert.equal(validateScenario(boss,raw).kind,'boss');
});

test('training uses production membership including elite duplicates, harmony and transfer equipment',()=>{
  const s=defaultScenario(raw);s.layers={victoriaShip:200,maniShip:12};
  const gd=new GameData(raw,'mode_multi_hard');
  const expected=computeBonds(gd,{board:new Map(s.units.map((u,i)=>[i,{kind:'chess',id:u.chessId,items:u.items.map(id=>({id}))}])),hand:[],layers:s.layers});
  assert.deepEqual(trainingBonds(s,raw),expected);
  const staff=Object.values(raw.items).find(i=>i.canGiveBond&&i.itemType==='EQUIP');
  assert.ok(staff);s.units[0].items=[staff.id,'chess_item_1_01_e_a'];
  assert.ok(trainingBonds(s,raw).victoriaShip.count>=1);
  assert.equal(trainingBonds(s,raw).victoriaShip.layers,200);
});

test('real simulation runs deterministically with real equipment, enemy abilities and training stats',()=>{
  const s=defaultScenario(raw);s.units[0].items=['chess_item_1_01_e_a'];s.seconds=45;
  const a=battleFor(s),b=battleFor(s);
  while(!a.finished&&a.time<s.seconds)a.step();while(!b.finished&&b.time<s.seconds)b.step();
  if(!a.finished)a.forceEnd('timeout');if(!b.finished)b.forceEnd('timeout');
  assert.deepEqual(a.result(),b.result());assert.equal(a.errorCount,0);assert.equal(a.total,6);
  assert.ok(a.result().perPlayer.training.unitStats.some(u=>u.dmg>0));
  const out=summarizeTraining(a,s);assert.equal(out.kind,'local-training');assert.ok(out.units.length>=3);assert.equal(out.total,6);
});

test('Boss training maps real units, honors room HP and no-limit flag without a shared pool',()=>{
  const s=defaultScenario(raw);s.kind='boss';s.noBossCap=true;s.hpMul=2;s.enemies=[{enemyKey:'enemy_2008_flking',count:1,time:0,interval:0}];
  const used=new Set();for(const u of s.units){const p=legalTiles(raw,s,u.chessId).find(p=>!used.has(p.join(',')));[u.row,u.col]=p;used.add(p.join(','));}
  const b=battleFor(s);b.step();assert.equal(b.flags.extensionBossNoDamageLimit,true);assert.equal(b.sharedBoss,null);
  const enemy=b.enemies.find(e=>e.defId==='enemy_2008_flking');assert.ok(enemy);assert.equal(enemy.base.maxHp,raw.enemies.enemy_2008_flking.stats.maxHp*2);
  assert.ok(b.allyUnits.some(u=>u.tileR>=2&&u.tileR<=5));for(let i=0;i<300;i++)b.step();assert.equal(b.errorCount,0);
});

test('Boss training tags leaders so actual 300000 hits are cancelled until its checkbox is enabled',()=>{
  const scenarioFor=(kind,noBossCap)=>{
    const s=defaultScenario(raw);s.kind=kind;s.noBossCap=noBossCap;s.hpMul=96;
    s.enemies=[{enemyKey:'enemy_2008_flking',count:1,time:0,interval:0}];
    const used=new Set();for(const u of s.units){const p=legalTiles(raw,s,u.chessId).find(p=>!used.has(p.join(',')));[u.row,u.col]=p;used.add(p.join(','));}
    return s;
  };
  for(const enabled of [false,true]){
    const s=scenarioFor('boss',enabled),o=battleOptions(s,raw);assert.equal(o.spawns[0].tag,'boss');assert.equal(o.spawns[0].countInTotal,true);
    const b=battleFor(s);b.step();const enemy=b.enemies.find(e=>e.defId==='enemy_2008_flking');
    assert.equal(enemy.isBoss,true);assert.equal(enemy.counted,true);assert.equal(b.total,1);assert.equal(b.sharedBoss,null);
    const before=enemy.hp;const actual=b.dealDamage(null,enemy,{amount:300000,type:'true',canDodge:false});
    assert.equal(actual,enabled?300000:0);assert.equal(before-enemy.hp,enabled?300000:0);
    assert.equal(b.errorCount,0);
  }
  const normal=scenarioFor('normal',false);assert.equal(battleOptions(normal,raw).spawns[0].tag,undefined);
  const b=battleFor(normal);b.step();const enemy=b.enemies.find(e=>e.defId==='enemy_2008_flking');
  assert.ok(!enemy.isBoss);assert.equal(b.dealDamage(null,enemy,{amount:300000,type:'true',canDodge:false}),300000);
});

test('a tagged multiplayer-capable leader stays single in the one-player training field',()=>{
  const s=defaultScenario(raw);s.kind='boss';s.hpMul=96;
  s.enemies=[{enemyKey:'enemy_9017_achunt',count:1,time:0,interval:0}];
  const used=new Set();for(const u of s.units){const p=legalTiles(raw,s,u.chessId).find(p=>!used.has(p.join(',')));[u.row,u.col]=p;used.add(p.join(','));}
  const b=battleFor(s);for(let i=0;i<600&&!b.finished;i++)b.step();
  const leaders=b.units.filter(u=>u.defId==='enemy_9017_achunt');assert.equal(leaders.length,1);
  assert.equal(leaders[0].isBoss,true);assert.equal(b.players.length,1);assert.equal(b.errorCount,0);
});

test('training save/history stay isolated from account/formal records, reject tampering and keep ten',()=>{
  const store=storage(),s=defaultScenario(raw);saveTraining(store,s,raw);assert.deepEqual(loadTraining(store,raw),s);
  const b=battleFor(s);b.step();b.forceEnd();const result=summarizeTraining(b,s);
  for(let i=0;i<15;i++)saveTrainingResult(store,{...result,at:i});
  assert.equal(JSON.parse(store.getItem(TRAINING_HISTORY_KEY)).length,10);
  assert.equal(store.getItem('sp-account-token'),'keep');assert.equal(store.getItem('sp-formal-history'),'keep');
  assert.throws(()=>saveTrainingResult(store,{kind:'official'}));
  store.setItem(TRAINING_KEY,'{"units":100000}');assert.deepEqual(loadTraining(store,raw),s);
});

test('training entry is static data only and never imports network runner, credentials or account APIs',()=>{
  const src=readFileSync(new URL('../public/js/training/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/import\s+.*(?:net\.js|store\.js|runner\.js|account\.js)/);
  assert.doesNotMatch(src,/new\s+WebSocket|\/api\/|b\.result|net\.send/);
  assert.match(src,/\/js\/browser\/sim\.js/);assert.match(src,/document\.hidden/);
});
