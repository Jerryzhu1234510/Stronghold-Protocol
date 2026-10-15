import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
if(typeof vm.SyntheticModule!=='function'){
  const child=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(child.status??1);
}
const require=createRequire(import.meta.url),{musicBootstrap}=require('../music-events.cjs'),{motionBootstrap}=require('../unit-motion.cjs');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const sessionA={id:'session-a',url:'/__test_mods/session-a.mp3',volume:0.8,startSeconds:10};
const sessionB={id:'session-b',url:'/__test_mods/session-b.mp3',volume:0.6,startSeconds:3};
const cue=event=>({event,url:'/__test_mods/'+event+'.mp3',volume:0.7,startSeconds:0,includeBots:true,includeSelf:false});
function state(phase='PREP',round=1,extra={}){
  const players=[{playerId:'me',lp:20,alive:true},{playerId:'friend',lp:20,alive:true}];
  return {connection:{status:'online'},me:{playerId:'me'},room:{code:'ABCD',inMatch:true,seats:players,spectators:[]},match:{public:{phase,round,modeId:'coop',players}},...extra};
}
const waiting=()=>state('LOBBY',0,{room:{code:'ABCD',inMatch:false,seats:[{playerId:'me'}],spectators:[]},match:{public:null}});

async function rig({initial=state(),tracks=[],sessionTrack=sessionA,muted=false,bgm=0.5,blocks=0,motion=undefined}={}){
  let current=initial,remainingBlocks=blocks,module,disposed=false,currentMotion=motion;
  const subscribers=new Set(),includeMotion=motion!==undefined;
  const instances=[],gainCalls=[],timers=new Map(),listeners=new Map();let timerId=0;
  const originalApply=function(){this.bgmGain.gain.setTargetAtTime(this.volumes.muted?0:this.volumes.bgm,this.ctx.currentTime,0.05);};
  const audio={volumes:{muted,bgm},ctx:{currentTime:4},bgmGain:{gain:{setTargetAtTime:(...args)=>gainCalls.push(args)}},_applyVolumes:originalApply};
  class FakeAudio{
    constructor(src){this.currentTime=0;this.duration=240;this.readyState=0;this.paused=true;this.ended=false;this.playAttempts=0;this.pauseCalls=0;this.loadCalls=0;this.listeners=new Map();instances.push(this);if(src)this.src=src;}
    set src(value){this._src=value;this.readyState=0;queueMicrotask(()=>{if(this._src===value&&value)this.metadata();});}
    get src(){return this._src;}
    get currentSrc(){return this._src||'';}
    metadata(){if(!this.readyState&&this.src){this.readyState=1;this.emit('loadedmetadata');this.onloadedmetadata?.();}}
    addEventListener(name,fn,options={}){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add({fn,once:options.once===true});}
    removeEventListener(name,fn){for(const item of [...this.listeners.get(name)||[]])if(item.fn===fn)this.listeners.get(name).delete(item);}
    emit(name){for(const item of [...this.listeners.get(name)||[]]){item.fn();if(item.once)this.listeners.get(name).delete(item);}}
    async play(){
      this.playAttempts++;if(remainingBlocks-->0){const error=new Error('trusted gesture required');error.name='NotAllowedError';throw error;}
      this.metadata();this.paused=false;this.ended=false;
    }
    pause(){this.paused=true;this.pauseCalls++;}
    load(){this.loadCalls++;if(!this.src)this.paused=true;else queueMicrotask(()=>this.metadata());}
    removeAttribute(name){if(name==='src'){this._src=undefined;this.readyState=0;}else delete this[name];}
    end(){this.paused=true;this.ended=true;this.emit('ended');this.onended?.();}
    fail(){this.paused=true;this.emit('error');this.onerror?.();}
  }
  const window={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
  const context=vm.createContext({Audio:FakeAudio,console,window,
    localStorage:{getItem:()=>JSON.stringify(audio.volumes)},performance:{now:()=>1000},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    __SP_GENERATION:'session-fixture',
    __SP__:{data:{get:()=>null},store:{get:()=>current,subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn);}}},
  });
  const run=config=>{if(Object.hasOwn(config,'motion'))currentMotion=config.motion;return new vm.Script(musicBootstrap(config)+(includeMotion?'\n'+motionBootstrap({motion:currentMotion}):''),{importModuleDynamically:async(specifier)=>{
    assert.equal(specifier,'/_build/session-fixture/js/audio.js');
    if(!module){module=new vm.SyntheticModule(['audio'],function(){this.setExport('audio',audio);},{context});await module.link(()=>{});await module.evaluate();}return module;
  }}).runInContext(context);};
  run({tracks,sessionTrack});await flush();
  return {context,instances,audio,gainCalls,timers,listeners,
    get control(){return context.__SPDesktopMusic;},
    get playing(){return instances.filter(a=>!a.paused&&a.src);},
    get session(){return instances.findLast(a=>!a.paused&&a.src&&a.loop===true);},
    get event(){return instances.findLast(a=>!a.paused&&a.src&&a.loop!==true);},
    async set(next){current=next;for(const subscriber of [...subscribers])subscriber(next);await flush();},
    async configure(next){run(next);await flush();},
    async settings(next){Object.assign(audio.volumes,next);audio._applyVolumes();await flush();},
    async dispatch(name,event){for(const fn of [...listeners.get(name)||[]])fn(event);await flush();},
    dispose(){if(disposed)return;disposed=true;context.__SPDesktopMusic?.dispose();context.__SPDesktopUnitMotion?.dispose();assert.equal(subscribers.size,0);assert.equal(audio._applyVolumes,originalApply);assert.equal(context.__SPDesktopMusic,undefined);assert.equal(context.__SPDesktopMusicBridge,undefined);assert.equal(context.__SPDesktopUnitMotion,undefined);assert.equal(timers.size,0);assert.equal(instances.filter(a=>!a.paused&&a.src).length,0);},
  };
}
function assertSession(r,track=sessionA,time=null){
  const s=r.session;assert.ok(s,'an audible looping session track is playing');assert.equal(s.src,track.url);assert.equal(s.loop,true);assert.equal(r.playing.length,1,'only one audible Mod channel plays at a time');
  assert.equal(s.volume,r.audio.volumes.bgm*track.volume);if(time!==null)assert.equal(s.currentTime,time);return s;
}

{
  const r=await rig({initial:waiting()});
  try{
    assert.equal(r.instances.length,0,'selection/waiting room does not start session music');
    await r.set(state('INFO_CHECK',0));const s=assertSession(r,sessionA,10);assert.equal(r.gainCalls.at(-1)[0],0,'native BGM is ducked while session music plays');
    s.currentTime=21;await r.set(state('BAND_DRAFT',0));await r.set(state('ROUND_START',1));await r.set(state('PREP',1));assertSession(r,sessionA,21);
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',6),tracks:[cue('combat-start'),cue('round-start')]});
  try{assertSession(r,sessionA,10);assert.equal(r.event,undefined,'initial mid-game load may start permanent BGM but never replays historical stage events');}finally{r.dispose();}
}
for(const invalid of [
  state('PREP',1,{connection:{status:'offline'}}),
  state('PREP',1,{connection:{status:'connecting'}}),
  state('PREP',1,{me:{playerId:'spectator'}}),
  state('PREP',1,{room:{code:'ABCD',inMatch:true,seats:[{playerId:'friend'}],spectators:[]}}),
  state('PREP',1,{room:{code:'ABCD',inMatch:true,seats:[{playerId:'me'}],spectators:[{playerId:'me'}]}}),
  state('RESULT',14),
  state('PREP',1,{match:{public:null}}),
]){
  const r=await rig({initial:invalid});try{assert.equal(r.instances.length,0,'offline, absent/observing player, missing state and result page cannot start permanent BGM');}finally{r.dispose();}
}
{
  const versus=state();versus.match.public.modeId='versus';const r=await rig({initial:versus});try{assert.equal(r.instances.length,0,'versus does not activate co-op session Mods');}finally{r.dispose();}
}
{
  const r=await rig({initial:state('ROUND_START',1),tracks:[cue('prep-start')]});
  try{
    const s=assertSession(r);s.currentTime=37;
    await r.set(state('PREP',1));assert.equal(r.session,undefined);const e=r.event;assert.ok(e);assert.equal(e.src,cue('prep-start').url);assert.equal(e.loop,false,'even the lowest-priority event can temporarily occupy the session channel');assert.equal(s.paused,true);
    e.end();await flush();assertSession(r,sessionA,37);assert.equal(r.gainCalls.at(-1)[0],0,'native BGM stays ducked after the session resumes');
  }finally{r.dispose();}
}
{
  const tracks=['prep-start','combat-start','boss-start'].map(cue),r=await rig({initial:state('ROUND_START',1),tracks});
  try{
    assertSession(r).currentTime=45;await r.set(state('PREP',1));const prep=r.event;assert.equal(prep.src,cue('prep-start').url);
    await r.set(state('COMBAT',1));const combat=r.event;assert.equal(combat.src,cue('combat-start').url);assert.equal(prep.paused,true);
    combat.currentTime=7;await r.set(state('PREP',2));await r.set(state('COMBAT',2));assert.equal(r.event,combat,'lower/equal event priority does not restart a higher/equal event');assert.equal(combat.currentTime,7);
    await r.set(state('FINAL_ASSAULT',14));const boss=r.event;assert.equal(boss.src,cue('boss-start').url);assert.equal(combat.paused,true);
    boss.end();await flush();assertSession(r,sessionA,45);
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('PREP',1),tracks:[cue('combat-start')]});
  try{assertSession(r).currentTime=51;await r.set(state('COMBAT',1));r.event.fail();await flush();assertSession(r,sessionA,51,'event error restores the paused session position');}finally{r.dispose();}
}
{
  const r=await rig({initial:state('ROUND_START',1),tracks:[{...cue('prep-start'),volume:0}]});
  try{const s=assertSession(r);s.currentTime=30;await r.set(state('PREP',1));assertSession(r,sessionA,30);assert.equal(s.paused,false,'zero-volume event does not pause session music');assert.equal(r.event,undefined);}finally{r.dispose();}
}
{
  const r=await rig({tracks:[cue('combat-start')],initial:state('PREP',1)});
  try{
    assertSession(r).currentTime=60;await r.settings({muted:true});assert.equal(r.playing.length,0,'muting pauses session and saves position');
    const count=r.instances.length;await r.set(state('COMBAT',1));assert.equal(r.instances.length,count,'muted events never create a silent Audio');
    await r.settings({muted:false,bgm:0.25});assertSession(r,sessionA,60);assert.equal(r.event,undefined,'unmuting cannot replay the event missed while muted');
    await r.settings({bgm:0});assert.equal(r.playing.length,0);await r.settings({bgm:0.5});assertSession(r,sessionA,60);
  }finally{r.dispose();}
}
for(const prefs of [{muted:true,bgm:0.5},{muted:false,bgm:0}]){
  const r=await rig(prefs);
  try{assert.equal(r.instances.length,0,'initial muted or zero-volume BGM does not allocate or claim the session channel');await r.settings({muted:false,bgm:0.5});assertSession(r,sessionA,10);}finally{r.dispose();}
}
{
  const r=await rig({sessionTrack:{...sessionA,volume:0}});
  try{assert.equal(r.instances.length,0);assert.equal(r.gainCalls.filter(c=>c[0]===0).length,0,'silent session track never ducks native BGM');await r.configure({tracks:[],sessionTrack:sessionA});assertSession(r,sessionA,10);}finally{r.dispose();}
}
{
  const before=state('COMBAT',4),r=await rig({initial:before});
  try{
    const s=assertSession(r);s.currentTime=64;
    const offline={...before,connection:{status:'offline'}};await r.set(offline);assert.equal(r.playing.length,0,'disconnect pauses the session');
    await r.set(before);assert.equal(r.playing.length,0,'online status with the old public object cannot resume a possibly stale session');
    await r.set(state('COMBAT',4));assertSession(r,sessionA,64,'a fresh snapshot from the same room resumes its saved position');
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',4)});
  try{
    assertSession(r).currentTime=70;await r.set({...state('COMBAT',4),room:null,match:{public:null}});assert.equal(r.playing.length,0);assert.equal(r.gainCalls.at(-1)[0],0.5,'leaving restores native BGM');
    const next=state('COMBAT',5);next.room.code='NEXT';await r.set(next);assertSession(r,sessionA,10,'another room starts a fresh session rather than carrying the previous room position');
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',4)});
  try{
    assertSession(r).currentTime=77;await r.set(state('RESULT',14));assert.equal(r.playing.length,0);assert.equal(r.gainCalls.at(-1)[0],0.5,'RESULT ends the loop before the result payload arrives');
    await r.set(waiting());await r.set(state('INFO_CHECK',0));assertSession(r,sessionA,10,'a new match in the same room starts at the configured beginning');
  }finally{r.dispose();}
}
{
  const win=cue('match-win'),r=await rig({initial:state('COMBAT',4),tracks:[win]});
  try{
    await r.set(state('RESULT',14));assert.equal(r.playing.length,0);
    const done=state('RESULT',14);done.match.result={resultId:'session-test-result',victory:true,players:[{playerId:'me',victory:true}]};await r.set(done);
    assert.equal(r.event.src,win.url,'stopping session music at RESULT does not disable the separately authorized end cue');r.event.end();await flush();assert.equal(r.playing.length,0);assert.equal(r.gainCalls.at(-1)[0],0.5);
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',2),tracks:[cue('combat-start')]});
  try{
    assertSession(r).currentTime=90;await r.configure({tracks:[cue('combat-start')],sessionTrack:null});assert.equal(r.playing.length,0);assert.equal(r.gainCalls.at(-1)[0],0.5,'disabling the session package restores native BGM');
    await r.configure({tracks:[cue('combat-start')],sessionTrack:sessionB});assertSession(r,sessionB,3);assert.equal(r.event,undefined,'changing a session Mod never synthesizes a past combat event');
    await r.set(state('COMBAT',2));assert.equal(r.event,undefined);await r.set(state('PREP',3));await r.set(state('COMBAT',3));assert.equal(r.event.src,cue('combat-start').url,'future live events still work after a session Mod change');
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',2),tracks:[],sessionTrack:null});
  try{assert.equal(r.instances.length,0);await r.configure({tracks:[],sessionTrack:sessionA});assertSession(r,sessionA,10,'a session package enabled mid-match may start without replaying any event');}finally{r.dispose();}
}
{
  const combat=cue('combat-start'),r=await rig({initial:state('PREP',1),tracks:[combat]});
  try{
    assertSession(r).currentTime=91;r.control.stop();await flush();assert.equal(r.playing.length,0);
    await r.set(state('PREP',1));assert.equal(r.playing.length,0,'manual Stop remains effective across ordinary state refreshes');
    await r.set(state('COMBAT',1));assert.equal(r.event.src,combat.url,'manual Stop is not disabling future event triggers');r.event.end();await flush();assert.equal(r.session,undefined,'an event completion does not undo manual session Stop');
    await r.configure({tracks:[combat],sessionTrack:sessionA});assertSession(r,sessionA);
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',1)});
  try{assertSession(r).currentTime=92;r.control.stop();await r.set(state('RESULT',14));await r.set(waiting());await r.set(state('INFO_CHECK',0));assertSession(r,sessionA,10,'manual Stop suppression is scoped to the current match');}finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',2),blocks:1});
  try{
    assert.equal(r.playing.length,0);await r.dispatch('pointerdown',{isTrusted:false});assert.equal(r.playing.length,0,'synthetic input cannot unlock autoplay');
    await r.dispatch('pointerdown',{isTrusted:true});assertSession(r,sessionA,10,'trusted user input recovers blocked session playback');
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',2),blocks:1});
  try{
    // Persistent match BGM must still accept the user's first gesture after
    // the one-shot event retry window would have expired.
    for(const timer of [...r.timers.values()])if(timer.delay===30000)timer.fn();await flush();
    await r.dispatch('pointerdown',{isTrusted:false});assert.equal(r.playing.length,0);
    await r.dispatch('pointerdown',{isTrusted:true});assertSession(r,sessionA,10,'a late trusted gesture can still unlock permanent match BGM');
  }finally{r.dispose();}
}
{
  const r=await rig({initial:state('COMBAT',2),blocks:1});
  try{await r.configure({tracks:[],sessionTrack:null});await r.dispatch('pointerdown',{isTrusted:true});assert.equal(r.playing.length,0,'a pending autoplay attempt cannot resurrect a disabled session package');}finally{r.dispose();}
}
{
  const visual={target:'own',bounceHeight:0.2,bounceHz:1,spinRps:0.5},combat=cue('combat-start');
  const before=state('PREP',1);before.match.field={local:true,fieldId:'n:me',battleId:'combined-battle',live:true,units:[]};
  const r=await rig({initial:before,tracks:[combat],motion:visual});
  const info=Object.freeze({id:1,kind:'op',side:'ally',ownerId:'me',x:2,y:3,def:Object.freeze({bonds:Object.freeze(['kjeragShip'])})});
  const body={y:8,rotation:0.2},view={body,info,alive:true,prep:false,screen:{s:100}};
  try{
    const motionApi=r.context.__SPDesktopUnitMotion,freezeApi=r.context.__SPDesktopMusicBridge;
    assert.ok(motionApi);assert.equal(typeof freezeApi.freeze,'function');assertSession(r).currentTime=42;
    motionApi.step3d(view,1/60,null,0.25);assert.notEqual(body.y,8);assert.deepEqual([info.x,info.y],[2,3],'visual motion never edits unit coordinates used by combat/freeze');
    const next=state('COMBAT',1);next.match.field=before.match.field;await r.set(next);assert.equal(r.event.src,combat.url);motionApi.step3d(view,1/60,null,0.4);assert.notEqual(body.y,8,'event interruption does not stop renderer motion');
    assert.equal(r.context.__SPDesktopMusicBridge,freezeApi);assert.equal(r.context.__SPDesktopUnitMotion,motionApi,'music and motion use separate stable global APIs');
    r.event.end();await flush();assertSession(r,sessionA,42);
    await r.configure({tracks:[combat],sessionTrack:null});assert.equal(r.playing.length,0);motionApi.step3d(view,1/60,null,0.25);assert.notEqual(body.y,8,'disabling session music does not disable independently enabled unit motion');
    await r.configure({tracks:[combat],sessionTrack:sessionA,motion:null});assertSession(r);assert.equal(body.y,8);assert.equal(body.rotation,0.2,'disabling motion restores body transform without stopping session playback');
    const offline={...next,connection:{status:'offline'}};await r.set(offline);assert.equal(r.playing.length,0);assert.deepEqual([info.x,info.y],[2,3]);
  }finally{r.dispose();assert.equal(body.y,8);assert.equal(body.rotation,0.2);}
}
console.log(JSON.stringify({ok:true,checks:[
  'session-only production bootstrap; normal start and valid mid-match admission without event catch-up',
  'online participant eligibility; spectator/versus/missing state/RESULT exclusion',
  'looping session position survives low/high event insertion, interruption, end and error',
  'mute/BGM/track zero do not claim audio; live changes resume saved session position',
  'offline pauses; stale public object cannot resume; fresh same-room snapshot restores position',
  'RESULT/leave/switch stop and restore native BGM; new match starts at configured beginning',
  'disable/change/mid-match enable do not replay old event triggers',
  'manual Stop survives state refreshes and event completion; configure/new match can re-enable',
  'trusted gesture only autoplay recovery including a late first click; disabled pending tracks stay disabled; dispose cleans everything',
  'combined production music/motion bootstraps remain independent; motion does not alter freeze/game coordinates',
]}));
