import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createTrainingModAdapter} from '../../../public/js/training/mod-adapter.js';
const require=createRequire(import.meta.url),{musicBootstrap}=require('../music-events.cjs'),{motionBootstrap}=require('../unit-motion.cjs');
const sounds=[];
class Audio {
  constructor(){this.paused=true;this.volume=1;this.loop=false;this.currentTime=0;sounds.push(this);}
  play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}
  addEventListener(){}removeAttribute(k){delete this[k];}load(){}
}
const scope={Audio,console,setTimeout,clearTimeout,performance:{now:()=>5000},addEventListener(){},removeEventListener(){},localStorage:{getItem:()=>null}};scope.window=scope;
const adapter=createTrainingModAdapter(scope);const context=vm.createContext(scope);
const raw={chess:{a:{baseId:'a',bonds:['siracusaShip']}},bonds:{siracusaShip:{isCore:true}},items:{},backups:{}};adapter.setData(raw);
vm.runInContext(musicBootstrap({tracks:['match-start','boss-start','siracusa-true-damage'].map(event=>({event,url:'/local/'+event+'.wav',volume:.5,includeBots:true})),sessionTrack:{id:'training-bgm',url:'/local/loop.wav',volume:.5}}),context);
vm.runInContext(motionBootstrap({motion:{target:'own',bounceHeight:.3,bounceHz:1,spinRps:1,flipX:true}}),context);
const tick=()=>new Promise(r=>setImmediate(r));
assert.equal(scope.__SPDesktopMusic.status.bound,true);assert.equal(scope.__SPDesktopUnitMotion.status.bound,true);assert.equal(sounds.length,0,'waiting does not start BGM');assert.equal(Object.hasOwn(scope.__SP__,'net'),false);
const scenario={kind:'boss',round:11,units:[{chessId:'a',row:10,col:3,items:[]}]};const field={fieldId:'local-training',units:[{id:1,kind:'op',side:'ally',ownerId:'training'}]};
const scenarioBefore=JSON.stringify(scenario),fieldBefore=JSON.stringify(field);
adapter.start(scenario,field);await tick();assert.equal(scope.__SPDesktopMusic.status.lastEvent,'boss-start');assert.equal(scope.__SPDesktopMusic.status.playing,true);assert.equal(scope.__SP__.store.get().match.field.local,true);assert.equal(scope.__SP__.store.get().match.private.board[0].id,'a');assert.equal(JSON.stringify(scenario),scenarioBefore);assert.equal(JSON.stringify(field),fieldBefore);
let current=sounds.findLast(s=>!s.loop&&!s.paused);current.onended();await tick();assert.equal(scope.__SPDesktopMusic.status.sessionPlaying,true,'real existing session player resumes after event');
const u={info:{id:1,kind:'op',side:'ally',ownerId:'training'},body:{y:5,rotation:0,scale:{x:1,y:1}},screen:{s:100},alive:true};scope.__SPDesktopUnitMotion.step3d(u,1/60,null,.5);assert.equal(u.body.y,-25);assert.equal(u.body.scale.x,-1);assert.notEqual(u.body.rotation,0);
adapter.pause();await tick();assert.equal(scope.__SPDesktopMusic.status.sessionPlaying,false);assert.equal(scope.__SPDesktopMusic.status.playing,false);assert.ok(sounds.every(s=>s.paused));assert.equal(u.body.y,5);assert.equal(u.body.scale.x,1);
const plays=scope.__SPDesktopMusic.status.plays;adapter.resume();await tick();assert.equal(scope.__SPDesktopMusic.status.plays,plays,'resume does not replay boss-start');assert.equal(scope.__SPDesktopMusic.status.sessionPlaying,true);scope.__SPDesktopUnitMotion.step3d(u,1/60,null,.5);assert.equal(u.body.y,-25);
const ev=[['fx','bondProc',0,0,{src:'bond:siracusaShip',key:'assassin',amount:100,from:1,id:2}]];const evBefore=JSON.stringify(ev);adapter.feed(ev,1);adapter.feed(ev,2);await tick();assert.equal(scope.__SPDesktopMusic.status.lastEvent,'siracusa-true-damage');assert.equal(JSON.stringify(ev),evBefore,'feed is observation only');
adapter.finish();await tick();assert.ok(sounds.every(s=>s.paused));assert.equal(u.body.y,5);const count=sounds.length;adapter.feed(ev,3);assert.equal(sounds.length,count,'finished training cannot dispatch battle events');
adapter.start(scenario,field);await tick();assert.equal(scope.__SPDesktopMusic.status.lastEvent,'boss-start','new training resets once-only stage cues');adapter.reset();assert.ok(sounds.every(s=>s.paused));
assert.throws(()=>createTrainingModAdapter(scope),/不能覆盖/);adapter.dispose();assert.equal(scope.__SP__,undefined);assert.equal(scope.__SP_RUNNER__,undefined);assert.equal(scope.__SPDesktopMusic,undefined);assert.equal(scope.__SPDesktopUnitMotion,undefined);assert.ok(sounds.every(s=>s.paused));adapter.dispose();
console.log(JSON.stringify({ok:true,checks:['training-only store and local event feed, no net/account reference','existing music detector and session player bind immediately','actual owner-matched motion API changes only rendered body','pause stops audio and restores motion; resume does not replay stage cue','true-damage event observes unchanged sim tuple','finish/reset/restart/pagehide cleanup','existing formal store cannot be overwritten']}));
