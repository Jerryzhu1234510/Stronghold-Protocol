import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const require=createRequire(import.meta.url),{instrument}=require('../sim-music-observer.cjs');
const {flatStage,flatRoutes,chessRec,enemyRec}=await import(pathToFileURL(path.join(root,'test/helpers/battleHarness.js')));
const original=await fs.readFile(path.join(root,'public/js/browser/sim.js'),'utf8');
const changed=instrument(original,'/js/browser/sim.js');assert.notEqual(changed,original);
const base=await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'));
const observed=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'));
const globals={};for(const name of ['bonds','effects','items','config'])globals[name]=JSON.parse(await fs.readFile(path.join(root,'data/'+name+'.json'),'utf8'));
const raw={chess:{test_a:chessRec({id:'test_a',bonds:['kjeragShip','siracusaShip'],skill:null,stats:{atk:100,maxHp:5000,def:100,bat:0.8,blockCnt:1}})},
  enemies:{enemy_test:enemyRec({key:'enemy_test',hp:1e8,atk:0,speed:0,def:0,res:0})},stages:{flat:flatStage()}};
const input={battleId:'observer-test',fieldId:'n:me',kind:'normal',seed:19617,modeId:'mode_multi_hard',round:8,stageId:'flat',rect:{r0:9,r1:12,c0:2,c1:10},timeLimit:55,
 players:[{playerId:'me',seat:0,side:'L',units:[{uid:1,kind:'chess',chessId:'test_a',row:10,col:4,dir:'RIGHT',items:[]}],bonds:{kjeragShip:{count:6,active:true,tier:2,layers:100},siracusaShip:{count:6,active:true,tier:2,layers:100}}}],
 spawns:[{enemyKey:'enemy_test',time:0,routeIndex:0,pos:[10,5]}],routes:flatRoutes(),flags:{startOpCooldown:0},content:'full'};
const scope=new WeakMap(),callbacks=[];
globalThis.__SPDesktopMusicBridge={
 enterWind(battle,owner){const token={battle,previous:scope.get(battle)};scope.set(battle,owner);return token;},
 exitWind(token){if(!token)return;if(token.previous===undefined)scope.delete(token.battle);else scope.set(token.battle,token.previous);},
 freeze(battle,target,source){const sourceKind=source?'operator':'alliance',ownerId=source?.ownerId??scope.get(battle);callbacks.push({sourceKind,ownerId,target:target.id,time:battle.time});if(ownerId==='me')battle.fx('desktopFreeze',{id:target.id,from:source?.id??null,ownerId,sourceKind});},
};
function run(module){
 module.support.setGameData(globals);
 const ds=new module.simdata.DataSource(raw),spec=module.spec.buildBattleSpec(input);
 const battle=module.spec.createBattleFromSpec(spec,ds,{quiet:true,recordEvents:true});
 let draws=0;const rng=battle.rng;const watched=(...args)=>{draws++;return rng(...args);};Object.assign(watched,rng);battle.rng=watched;
 let paired=false;
 while(!battle.finished){battle.step();if(!paired&&battle.time>=2){const target=battle.enemies.find(e=>e.alive),source=battle.allyUnits.find(u=>u.kind==='op');assert.ok(target&&source);battle.applyStatus(target,'cold',{duration:1,source});battle.applyStatus(target,'cold',{duration:1,source});paired=true;}}
 return {result:battle.result(),snapshot:battle.snapshot(),draws,events:battle.drainEvents(),errorCount:battle.errorCount};
}
try{
 const plain=run(base),instrumented=run(observed);
 assert.deepEqual(instrumented.result,plain.result,'observer cannot change deterministic battle results');
 assert.deepEqual(instrumented.snapshot,plain.snapshot,'observer cannot change final unit states');
 assert.equal(instrumented.draws,plain.draws,'observer consumes no additional random draws');assert.ok(plain.draws>0,'comparison exercised RNG');
 assert.equal(instrumented.errorCount,0);assert.equal(plain.errorCount,0);
 assert.ok(callbacks.some(e=>e.sourceKind==='operator'&&e.ownerId==='me'),'actual bundle reports operator cold pair');
 assert.ok(callbacks.some(e=>e.sourceKind==='alliance'&&e.ownerId==='me'),'actual bundle gust carries exact alliance provenance');
 assert.ok(instrumented.events.some(e=>e[0]==='fx'&&e[1]==='desktopFreeze'),'local bridge can emit existing visual-event flow');
 assert.ok(!plain.events.some(e=>e[0]==='fx'&&e[1]==='desktopFreeze'));
 console.log(JSON.stringify({ok:true,seconds:55,randomDraws:plain.draws,freezeCallbacks:callbacks.length,operatorFreezes:callbacks.filter(e=>e.sourceKind==='operator').length,allianceFreezes:callbacks.filter(e=>e.sourceKind==='alliance').length,identicalResult:true,identicalSnapshot:true,identicalRandomDraws:true,errors:0}));
}finally{delete globalThis.__SPDesktopMusicBridge;}
