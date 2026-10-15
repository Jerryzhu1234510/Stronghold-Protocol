import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// A real dynamic import in the renderer is satisfied by a VM SyntheticModule.
// The renderer source and its production bootstrap remain unmodified.
if(typeof vm.SyntheticModule!=='function'){
  const child=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(child.status??1);
}

const require=createRequire(import.meta.url);
const {createMatchStartDetector,musicBootstrap}=require('../music-events.cjs');
assert.equal(typeof createMatchStartDetector,'function','the match-start detector must be exported for independent regression coverage');
const players=()=>[{playerId:'me',lp:20},{playerId:'friend',lp:20},{playerId:'bot',lp:20,isBot:true}];
const state=(phase='ROUND_START',round=1,extra={})=>({
  connection:{status:'online'},me:{playerId:'me'},room:{code:'ABCD',inMatch:true,seats:players(),spectators:[]},
  match:{public:{phase,round,modeId:'coop',players:players()}},...extra,
});
const waiting=(code='ABCD')=>state('LOBBY',0,{room:{code,inMatch:false,seats:players(),spectators:[]},match:{public:null}});
const events=(d,s)=>d.consume(s).events.map(e=>e.event);
const startEvent=['match-start'];

{
  const d=createMatchStartDetector();
  assert.deepEqual(events(d,waiting()),[]);
  assert.deepEqual(events(d,state('INFO_CHECK',0)),startEvent,'an observed room start followed by INFO_CHECK round zero starts the match');
  for(const [next,round]of [['INFO_CHECK',0],['BAND_DRAFT',0],['SP_DRAFT',1],['ROUND_START',1],['ROUND_START',2],['SP_DRAFT',3],['ROUND_START',3]]){
    assert.deepEqual(events(d,state(next,round)),[],'the same match never repeats at '+next+' '+round);
  }
}

for(const phase of ['BAND_DRAFT','SP_DRAFT','ROUND_START']){
  const d=createMatchStartDetector();d.consume(waiting());
  assert.deepEqual(events(d,state(phase,1)),[],'a first snapshot already at '+phase+' cannot safely replay a missed opening');
  assert.deepEqual(events(d,state('INFO_CHECK',0)),[],'a stale opening phase after a late first snapshot cannot replay the opening');
}

for(const [phase,round]of [['INFO_CHECK',0],['BAND_DRAFT',0],['SP_DRAFT',1],['ROUND_START',1],['ROUND_START',8],['RESULT',14]]){
  const d=createMatchStartDetector();
  assert.deepEqual(events(d,state(phase,round)),[],'joining/reloading an existing '+phase+' match is only a baseline');
  assert.deepEqual(events(d,state('ROUND_START',Math.max(1,round))),[]);
}

{
  const d=createMatchStartDetector();d.consume(waiting());
  assert.deepEqual(events(d,state('ROUND_START',5)),[],'a late snapshot is not an opening');
  assert.deepEqual(events(d,state('SP_DRAFT',6)),[],'a later strategy draft is not a new match');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  assert.deepEqual(events(d,state('INFO_CHECK',1)),[],'INFO_CHECK outside round zero cannot count as a new-match opening');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  assert.deepEqual(events(d,{...state('INFO_CHECK',0),match:{public:null}}),[],'the room flag alone cannot start music');
  assert.deepEqual(events(d,state('INFO_CHECK',0)),startEvent,'the first public opening snapshot can follow the room flag');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  d.consume({...state('INFO_CHECK',0),match:{public:null}});
  d.consume({...state('INFO_CHECK',0),match:{public:null},connection:{status:'offline'}});
  assert.deepEqual(events(d,state('INFO_CHECK',0)),[],'disconnecting while waiting for an opening public snapshot cancels the pending start');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  assert.deepEqual(events(d,state('INFO_CHECK',0)),startEvent);
  d.consume(state('RESULT',14,{room:{code:'ABCD',inMatch:false}}));
  d.consume(waiting());
  assert.deepEqual(events(d,state('INFO_CHECK',0)),startEvent,'a new game in the same room has its own opening');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  d.consume(state('INFO_CHECK',0));
  d.consume({...state(),room:null,match:{public:null}});
  assert.deepEqual(events(d,state('INFO_CHECK',0)),[],'leaving and rejoining an existing opening cannot replay it');
  d.consume(waiting('NEXT'));
  assert.deepEqual(events(d,state('INFO_CHECK',0,{room:{code:'NEXT',inMatch:true,seats:players(),spectators:[]}})),startEvent,'another room can begin its own match');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  assert.deepEqual(events(d,state('INFO_CHECK',0,{room:{code:'OTHER',inMatch:true,seats:players(),spectators:[]}})),[],'waiting in a different room is not evidence that this match just began');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  d.consume({...waiting(),connection:{status:'offline'}});
  assert.deepEqual(events(d,state('INFO_CHECK',0)),[],'reconnecting into a match never supplies a missed opening');
}
{
  const d=createMatchStartDetector();d.consume(waiting());d.consume(state('INFO_CHECK',0));
  const stale=state('ROUND_START',1);d.consume(stale);d.consume({...stale,connection:{status:'offline'}});
  assert.deepEqual(events(d,stale),[],'a stale public object on reconnect is not an event');
  assert.deepEqual(events(d,state('SP_DRAFT',3)),[],'fresh post-reconnect snapshots remain inside the old match');
}
{
  const d=createMatchStartDetector(),before=waiting();d.consume(before);
  d.consume({...before,connection:{status:'offline'}});
  d.consume(before);
  assert.deepEqual(events(d,state('INFO_CHECK',0)),[],'an online status with stale waiting room reference cannot re-arm after a disconnect');
}
{
  const d=createMatchStartDetector(),before=waiting();d.consume(before);
  d.consume({...before,connection:{status:'offline'}});
  d.consume(before);d.consume(waiting());
  assert.deepEqual(events(d,state('INFO_CHECK',0)),startEvent,'a fresh online waiting-room snapshot can arm the next real start after reconnect');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  const spectator=state('INFO_CHECK',0,{me:{playerId:'spectator'}});
  assert.equal(d.consume(spectator).active,false,'spectators cannot activate a participant opening');
  assert.deepEqual(events(d,state('ROUND_START',1)),[],'becoming a participant in a game already under way cannot replay its opening');
}
{
  const d=createMatchStartDetector();d.consume(waiting());
  const spectating=state('INFO_CHECK',0);spectating.room.spectators=[{playerId:'me'}];
  assert.equal(d.consume(spectating).active,false,'an explicit spectator entry takes precedence over an old seat');
}

const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const matchTrack={event:'match-start',url:'/__test_mods/opening.mp3',volume:0.8,startSeconds:0,includeBots:true};
const deathTrack={event:'teammate-zero-lp',url:'/__test_mods/death.mp3',volume:0.6,startSeconds:0,includeBots:true,includeSelf:true};

async function rig({initial=waiting(),tracks=[matchTrack],muted=false,bgm=0.5,blocked=false}={}){
  let current=initial,subscriber=null,timerId=0,remainingBlocks=blocked?1:0;
  const instances=[],listeners=new Map(),timers=new Map(),gainCalls=[],restoreCalls=[],imports=[];
  const originalApply=function(){restoreCalls.push({...this.volumes});this.bgmGain.gain.setTargetAtTime(this.volumes.muted?0:this.volumes.bgm,this.ctx.currentTime,0.05);};
  const audio={volumes:{muted,bgm},ctx:{currentTime:20},bgmGain:{gain:{setTargetAtTime:(...args)=>gainCalls.push(args)}},_applyVolumes:originalApply};
  class FakeAudio{
    constructor(){this.listeners=new Map();this.duration=123;this.currentTime=0;this.pauses=0;this.loads=0;this.playAttempts=0;instances.push(this);}
    async play(){this.playAttempts++;if(remainingBlocks-->0){const error=new Error('gesture required');error.name='NotAllowedError';throw error;}}
    pause(){this.pauses++;}
    load(){this.loads++;}
    removeAttribute(name){delete this[name];}
    addEventListener(name,handler){this.listeners.set(name,handler);}
    end(){this.onended?.();}
  }
  const window={
    addEventListener(name,handler){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(handler);},
    removeEventListener(name,handler){listeners.get(name)?.delete(handler);},
  };
  const context=vm.createContext({
    Audio:FakeAudio,window,console,
    localStorage:{getItem:()=>JSON.stringify(audio.volumes)},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    __SP_GENERATION:'fixture-build',
    __SP__:{store:{get:()=>current,subscribe(fn){subscriber=fn;return()=>{subscriber=null;};}}},
  });
  let audioModule;
  const script=new vm.Script(musicBootstrap({tracks}),{
    importModuleDynamically:async(specifier)=>{
      imports.push(specifier);
      assert.equal(specifier,'/_build/fixture-build/js/audio.js');
      if(!audioModule){audioModule=new vm.SyntheticModule(['audio'],function(){this.setExport('audio',audio);},{context});await audioModule.link(()=>{});await audioModule.evaluate();}
      return audioModule;
    },
  });
  script.runInContext(context);await flush();
  return {
    context,audio,instances,imports,gainCalls,restoreCalls,originalApply,listeners,timers,
    async set(next){current=next;subscriber?.(current);await flush();},
    async dispatch(name,event){for(const fn of [...listeners.get(name)||[]])fn(event);await flush();},
    dispose(){context.__SPDesktopMusic?.dispose();},
    get status(){return context.__SPDesktopMusic?.status;},
  };
}

{
  const r=await rig();assert.equal(r.status.bound,true);assert.equal(r.instances.length,0);
  await r.set(state('INFO_CHECK',0));assert.equal(r.instances.length,1);assert.equal(r.status.triggers,1);assert.equal(r.status.plays,1);
  const sound=r.instances[0];assert.equal(sound.src,matchTrack.url);assert.equal(sound.loop,false,'opening is a one-shot');assert.equal(sound.volume,0.4);
  assert.equal(r.gainCalls.at(-1)[0],0,'original BGM ducks while the opening plays');
  await r.set(state('BAND_DRAFT',0));await r.set(state('SP_DRAFT',1));await r.set(state('ROUND_START',1));await r.set(state('SP_DRAFT',3));
  assert.equal(r.instances.length,1);assert.equal(r.status.plays,1,'snapshots and later rounds cannot duplicate the opening');
  r.audio.volumes.muted=true;r.audio._applyVolumes();assert.equal(sound.volume,0,'live mute affects Mod music');
  r.audio.volumes.muted=false;r.audio.volumes.bgm=0.25;r.audio._applyVolumes();assert.equal(sound.volume,0.2,'live volume affects Mod music');
  sound.end();assert.equal(r.status.playing,false);assert.equal(sound.pauses,1);assert.equal(r.gainCalls.at(-1)[0],0.25,'natural completion restores current original BGM volume');
  await r.set(state('ROUND_START',4));assert.equal(r.instances.length,1);
  await r.set(waiting());await r.set(state('INFO_CHECK',0));assert.equal(r.status.plays,2,'the next actual game can play again');
  const second=r.instances[1];await r.set({...state(),room:null});assert.equal(second.pauses,1);assert.equal(r.status.playing,false,'leaving stops the clip');
  r.dispose();assert.equal(r.audio._applyVolumes,r.originalApply,'disposing restores the original game volume handler');
  assert.equal(r.context.__SPDesktopMusic,undefined);assert.equal(r.timers.size,0);
}
for(const prefs of [{muted:true,bgm:0.5},{muted:false,bgm:0}]){
  const r=await rig(prefs);await r.set(state('INFO_CHECK',0));assert.equal(r.instances.length,0,'muted/zero BGM never starts the clip');assert.equal(r.status.plays,0);r.dispose();
}
{
  const r=await rig({tracks:[{...matchTrack,volume:0}]});await r.set(state('INFO_CHECK',0));assert.equal(r.instances.length,0,'zero Mod volume does not start a silent clip');r.dispose();
}
{
  const r=await rig({initial:state('ROUND_START',1)});assert.equal(r.instances.length,0,'installing/reloading mid-game does not play a missed opening');await r.set(state('ROUND_START',2));assert.equal(r.instances.length,0);r.dispose();
}
{
  const r=await rig({blocked:true});await r.set(state('INFO_CHECK',0));assert.equal(r.status.blocked,1);assert.equal(r.status.playing,false);
  await r.dispatch('pointerdown',{isTrusted:false});assert.equal(r.instances.length,1,'synthetic input cannot unlock playback');
  await r.dispatch('pointerdown',{isTrusted:true});assert.equal(r.instances.length,2);assert.equal(r.status.plays,1,'a real gesture retries one pending clip');
  assert.equal(r.listeners.get('pointerdown')?.size||0,0);assert.equal(r.timers.size,0);r.dispose();
}
{
  const r=await rig();await r.set(state('INFO_CHECK',0));const first=r.instances[0];
  r.context.__SPDesktopMusic.configure({tracks:[]});assert.equal(first.pauses,1,'disabling all event Mods stops the current clip');
  await r.set(state('ROUND_START',1));r.context.__SPDesktopMusic.configure({tracks:[matchTrack]});
  await r.set(state('ROUND_START',1));assert.equal(r.instances.length,1,'re-enabling a track does not reset or replay the current match');
  await r.set(waiting());await r.set(state('INFO_CHECK',0));assert.equal(r.instances.length,2,'re-enabled track is available for the next game');r.dispose();
}
{
  const r=await rig();await r.set(state('INFO_CHECK',0));r.instances[0].onerror();
  assert.equal(r.status.errors,1);assert.equal(r.status.playing,false);assert.equal(r.gainCalls.at(-1)[0],0.5,'an audio decoding/load error restores original BGM');
  await r.set(state('BAND_DRAFT',0));assert.equal(r.instances.length,1,'an audio error cannot repeatedly restart the same opening');r.dispose();
}
{
  const r=await rig({tracks:[matchTrack,deathTrack]});await r.set(state('INFO_CHECK',0));assert.equal(r.instances[0].src,matchTrack.url);
  r.instances[0].end();await r.set(state('ROUND_START',1));const fallen=state('ROUND_START',1);fallen.match.public.players[1].lp=0;await r.set(fallen);
  assert.equal(r.instances.length,2);assert.equal(r.instances[1].src,deathTrack.url,'the existing zero-LP event keeps its own audio route');
  r.instances[1].end();await r.set(fallen);assert.equal(r.instances.length,2,'neither event repeats on identical authoritative snapshots');r.dispose();
}
console.log(JSON.stringify({ok:true,checks:[
  'observed same-room false-to-true start followed by INFO_CHECK round zero',
  'once per game; subsequent drafts/rounds; next game and other room',
  'no joining/reload/reconnect/spectator/late-snapshot catch-up',
  'production bootstrap in VM with real dynamic-imported audio module',
  'one-shot playback; mute and live volume; BGM duck and restoration; exit/dispose cleanup',
  'trusted-gesture autoplay recovery; concurrent legacy zero-LP configuration',
]}));
