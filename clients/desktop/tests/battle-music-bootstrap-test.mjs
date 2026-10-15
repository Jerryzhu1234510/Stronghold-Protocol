import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
if(typeof vm.SyntheticModule!=='function'){
  const child=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(child.status??1);
}
const require=createRequire(import.meta.url),{musicBootstrap}=require('../music-events.cjs');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function bus(){
  const handlers=new Map();let removals=0;
  return {
    on(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);let removed=false;return()=>{if(!removed){removed=true;removals++;handlers.get(name)?.delete(fn);}};},
    emit(name,batch){for(const fn of [...handlers.get(name)||[]])fn(batch);},
    count:name=>handlers.get(name)?.size||0,
    get removals(){return removals;},
  };
}
const events={siracusa:'siracusa-true-damage',operator:'kjerag-operator-freeze',alliance:'kjerag-alliance-freeze'};
const track=event=>({event,url:'/__test_mods/'+event+'.mp3',volume:0.8,startSeconds:0,includeBots:true,includeSelf:false});
const operator=(extra={})=>({id:1,kind:'op',side:'ally',ownerId:'me',def:{bonds:['kjeragShip']},items:[],...extra});
const target=()=>({id:99,side:'enemy',x:4,y:5});
function state(extra={}){
  const players=[{playerId:'me',lp:20,alive:true},{playerId:'friend',lp:20,alive:true}];
  return {connection:{status:'online'},me:{playerId:'me'},room:{code:'ABCD',inMatch:true,seats:players,spectators:[]},
    match:{public:{phase:'COMBAT',round:1,modeId:'coop',players},field:{fieldId:'n:me',battleId:'battle-1',live:true,local:true,units:[operator()]}},...extra};
}
const proc=gt=>({t:'b.ev',fieldId:'n:me',gt,ev:[['fx','bondProc',4,5,{src:'bond:siracusaShip',key:'assassin',amount:10,from:1,id:99}]]});
const items={carrier:{canGiveBond:true},'convert-kjerag':{giveBondId:'kjeragShip'},'single-both':{canGiveBond:true,giveBondId:'kjeragShip'}};

async function rig({tracks=Object.values(events).map(track),initial=state(),muted=false,bgm=0.5}={}){
  const net=bus(),runner=bus(),clock={now:1000},instances=[],gainCalls=[],timers=new Set(),listeners=new Map();
  let current=initial,subscriber=null,disposed=false;
  const originalApply=function(){this.bgmGain.gain.setTargetAtTime(this.volumes.muted?0:this.volumes.bgm,this.ctx.currentTime,0.05);};
  const audio={volumes:{muted,bgm},ctx:{currentTime:4},bgmGain:{gain:{setTargetAtTime:(...args)=>gainCalls.push(args)}},_applyVolumes:originalApply};
  class FakeAudio{
    constructor(){this.pauses=0;this.loads=0;this.duration=180;this.playAttempts=0;instances.push(this);}
    async play(){this.playAttempts++;}
    pause(){this.pauses++;}
    load(){this.loads++;}
    removeAttribute(name){delete this[name];}
    addEventListener(){}
    end(){this.onended?.();}
  }
  const window={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
  const context=vm.createContext({Audio:FakeAudio,console,window,
    localStorage:{getItem:()=>JSON.stringify(audio.volumes)},performance:{now:()=>clock.now},
    setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);},
    __SP_GENERATION:'battle-bootstrap-fixture',
    __SP_RUNNER__:runner,
    __SP__:{net,data:{get:key=>key==='items'?items:null},store:{get:()=>current,subscribe(fn){subscriber=fn;return()=>{subscriber=null;};}}},
  });
  let module;
  new vm.Script(musicBootstrap({tracks}),{importModuleDynamically:async(specifier)=>{
    assert.equal(specifier,'/_build/battle-bootstrap-fixture/js/audio.js');
    if(!module){module=new vm.SyntheticModule(['audio'],function(){this.setExport('audio',audio);},{context});await module.link(()=>{});await module.evaluate();}return module;
  }}).runInContext(context);
  await flush();
  return {net,runner,clock,instances,audio,gainCalls,context,
    get bridge(){return context.__SPDesktopMusicBridge;},get status(){return context.__SPDesktopMusic?.status;},
    async set(next){current=next;subscriber?.(current);await flush();},
    async emit(source,batch){source.emit(source===runner?'ev':'b.ev',batch);await flush();},
    dispose(){if(disposed)return;disposed=true;context.__SPDesktopMusic.dispose();assert.equal(subscriber,null);assert.equal(audio._applyVolumes,originalApply);assert.equal(context.__SPDesktopMusic,undefined);assert.equal(context.__SPDesktopMusicBridge,undefined);assert.equal(net.count('b.ev'),0);assert.equal(runner.count('ev'),0);assert.equal(timers.size,0);},
  };
}
function battle(time=1,fieldId='n:me'){
  return {fieldId,time,pending:[],fx(kind,extra){this.pending.push(['fx',kind,extra.x??0,extra.y??0,extra]);}};
}
async function flushBattle(r,b,source=r.runner){
  const ev=b.pending.splice(0);if(ev.length)await r.emit(source,{t:'b.ev',fieldId:b.fieldId,gt:b.time,ev});
}

{
  const r=await rig({tracks:[track(events.siracusa)]});
  try{
    assert.equal(r.net.count('b.ev'),1);assert.equal(r.runner.count('ev'),1);
    await r.set(state());await r.set(state());assert.equal(r.net.count('b.ev'),1);assert.equal(r.runner.count('ev'),1,'state updates do not duplicate source listeners');
    await r.emit(r.net,proc(1));assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track(events.siracusa).url);assert.equal(r.instances[0].volume,0.4);assert.equal(r.gainCalls.at(-1)[0],0);
    r.instances[0].end();assert.equal(r.gainCalls.at(-1)[0],0.5);
    r.clock.now=3100;await r.emit(r.runner,structuredClone(proc(1)));assert.equal(r.instances.length,1,'a copied server/local batch is deduplicated across both feeds');
    await r.emit(r.runner,proc(2));assert.equal(r.instances.length,2,'the local runner feed is connected as well');r.instances[1].end();
    const nextNet=bus();r.context.__SP__.net=nextNet;await r.set(state());assert.equal(r.net.count('b.ev'),0);assert.equal(nextNet.count('b.ev'),1);assert.equal(r.runner.count('ev'),1);
    r.clock.now=5200;await r.emit(r.net,proc(3));assert.equal(r.instances.length,2,'replaced sources are detached');
    nextNet.emit('b.ev',proc(3));await flush();assert.equal(r.instances.length,3);
    r.dispose();assert.equal(nextNet.count('b.ev'),0,'disposing detaches the replacement source too');
    nextNet.emit('b.ev',proc(4));r.runner.emit('ev',proc(4));await flush();assert.equal(r.instances.length,3,'disposed bridges cannot play new audio');
  }finally{r.dispose();}
}
{
  const r=await rig({tracks:[track(events.operator)]}),b=battle();
  try{
    r.bridge.freeze(b,target(),operator());assert.equal(b.pending.length,1);assert.equal(r.instances.length,0,'freeze hook queues decorative FX and does not immediately play music');
    assert.equal(b.pending[0][1],'desktopFreeze');assert.equal(b.pending[0][4].sourceKind,'operator');
    await flushBattle(r,b);assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track(events.operator).url);assert.equal(r.status.lastEvent,events.operator);
    r.audio.volumes.muted=true;r.audio._applyVolumes();assert.equal(r.instances[0].volume,0);
    r.audio.volumes.muted=false;r.audio.volumes.bgm=0.25;r.audio._applyVolumes();assert.equal(r.instances[0].volume,0.2);
    r.instances[0].end();assert.equal(r.gainCalls.at(-1)[0],0.25);
    b.time=2;r.bridge.freeze(b,target(),operator());assert.equal(b.pending.length,0,'same battle/type is pre-throttled for two game seconds');
    b.time=3.1;r.clock.now=3200;r.bridge.freeze(b,target(),operator());assert.equal(b.pending.length,1);await flushBattle(r,b);assert.equal(r.instances.length,2,'the cue can play again after both cooldowns');
  }finally{r.dispose();}
}
{
  const r=await rig({tracks:[track(events.alliance)]}),b=battle();
  try{
    r.bridge.freeze(b,target(),null);assert.equal(b.pending.length,0,'an anonymous freeze outside the trusted wind scope has no attribution');
    const scope=r.bridge.enterWind(b,'me');r.bridge.freeze(b,target(),null);r.bridge.exitWind(scope);
    assert.equal(b.pending.length,1);assert.equal(b.pending[0][4].sourceKind,'alliance');assert.equal(b.pending[0][4].from,null);
    assert.equal(r.instances.length,0);await flushBattle(r,b);assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track(events.alliance).url);r.instances[0].end();
    b.time=3.1;r.bridge.freeze(b,target(),null);assert.equal(b.pending.length,0,'leaving wind scope clears anonymous attribution');
    const otherScope=r.bridge.enterWind(b,'friend');r.bridge.freeze(b,target(),null);r.bridge.exitWind(otherScope);assert.equal(b.pending.length,0,'a teammate wind scope cannot trigger own music');
    const outer=r.bridge.enterWind(b,'me'),inner=r.bridge.enterWind(b,'friend');r.bridge.freeze(b,target(),null);assert.equal(b.pending.length,0);
    r.bridge.exitWind(inner);r.bridge.freeze(b,target(),null);assert.equal(b.pending.length,1,'nested scopes restore their exact previous player');r.bridge.exitWind(outer);
    const otherBattle=battle(6);const token=r.bridge.enterWind(b,'me');r.bridge.freeze(otherBattle,target(),null);r.bridge.exitWind(token);assert.equal(otherBattle.pending.length,0,'wind scopes cannot leak between battles');
  }finally{r.dispose();}
}
for(const [label,source,enemy]of [
  ['other owner',operator({ownerId:'friend'}),target()],
  ['token',operator({kind:'token'}),target()],
  ['enemy source',operator({side:'enemy'}),target()],
  ['no Kjerag membership',operator({def:{bonds:[]}}),target()],
  ['conversion without carrier',operator({def:{bonds:[]},items:['convert-kjerag']}),target()],
  ['single both-flags item',operator({def:{bonds:[]},items:['single-both']}),target()],
  ['ally target',operator(),{...target(),side:'ally'}],
]){
  const r=await rig({tracks:[track(events.operator)]}),b=battle();
  try{r.bridge.freeze(b,enemy,source);assert.equal(b.pending.length,0,label+' cannot emit a qualified operator-freeze cue');assert.equal(r.instances.length,0);}finally{r.dispose();}
}
for(const source of [operator({def:{raw:{bonds:['kjeragShip']}}}),operator({def:{bonds:[]},items:['carrier','convert-kjerag']})]){
  const r=await rig({tracks:[track(events.operator)]}),b=battle();
  try{r.bridge.freeze(b,target(),source);assert.equal(b.pending.length,1,'effective innate or valid two-item Kjerag membership is recognized');await flushBattle(r,b);assert.equal(r.instances.length,1);}finally{r.dispose();}
}
for(const [local,fieldId]of [[false,'n:me'],[true,'another-field']]){
  const initial=state();initial.match.field.local=local;const r=await rig({tracks:[track(events.operator)],initial}),b=battle(1,fieldId);
  try{r.bridge.freeze(b,target(),operator());assert.equal(b.pending.length,0,'freeze observer only handles the current local field');}finally{r.dispose();}
}
{
  const r=await rig({tracks:[track(events.operator),track(events.alliance)]}),b=battle();
  try{r.bridge.freeze(b,target(),operator());const token=r.bridge.enterWind(b,'me');r.bridge.freeze(b,target(),null);r.bridge.exitWind(token);assert.equal(b.pending.length,2,'operator and alliance freeze have separate game-time cooldowns');}finally{r.dispose();}
}
for(const prefs of [{muted:true,bgm:0.5},{muted:false,bgm:0}]){
  const r=await rig({tracks:[track(events.operator)],...prefs}),b=battle();
  try{r.bridge.freeze(b,target(),operator());await flushBattle(r,b);assert.equal(r.instances.length,0,'global mute and zero BGM apply to bridged battle cues');}finally{r.dispose();}
}
{
  const r=await rig({tracks:[{...track(events.operator),volume:0}]}),b=battle();
  try{r.bridge.freeze(b,target(),operator());assert.equal(b.pending.length,0,'disabled event volume does not claim the freeze FX/cooldown channel');assert.equal(r.instances.length,0);}finally{r.dispose();}
}
for(const event of [events.siracusa,events.operator]){
  const r=await rig({tracks:[track(event)]}),b=battle();
  try{
    if(event===events.siracusa)await r.emit(r.net,proc(1));else{r.bridge.freeze(b,target(),operator());await flushBattle(r,b);}
    assert.equal(r.instances.length,1);r.instances[0].end();
    const offline=state();offline.connection.status='offline';await r.set(offline);
    r.clock.now=4000;await r.set(state());
    if(event===events.siracusa)await r.emit(r.net,proc(2));else{b.time=3.1;r.bridge.freeze(b,target(),operator());await flushBattle(r,b);}
    assert.equal(r.instances.length,1,event+' does not replay the first reconnect batch even without an offline batch');
    r.clock.now=6200;
    if(event===events.siracusa)await r.emit(r.runner,proc(3));else{b.time=5.2;r.bridge.freeze(b,target(),operator());await flushBattle(r,b);}
    assert.equal(r.instances.length,2,event+' resumes for later fresh events after reconnect');
  }finally{r.dispose();}
}
{
  const death={...track('teammate-zero-lp'),includeSelf:true},r=await rig({tracks:[track(events.siracusa),death]});
  try{
    await r.emit(r.net,proc(1));const previous=r.instances[0];
    const eliminated=state();eliminated.match.public.players[1].lp=0;await r.set(eliminated);
    assert.equal(previous.pauses,1);assert.equal(r.instances.length,2);assert.equal(r.instances[1].src,death.url,'existing zero-LP music keeps its route and higher priority over cosmetic battle cues');
  }finally{r.dispose();}
}
{
  const r=await rig({tracks:[track(events.operator)]}),saved=r.bridge,b=battle();r.dispose();saved.freeze(b,target(),operator());assert.equal(b.pending.length,0,'saved observer references become inert after disposal');
}
console.log(JSON.stringify({ok:true,checks:[
  'production bootstrap; both net and local runner feeds; content deduplication and source replacement',
  'trusted freeze bridge queues local FX before music, operator/alliance mapping and independent cooldowns',
  'own Kjerag source, valid conversion, enemy target and current local field qualification',
  'nested exact-player wind scopes and battle isolation; anonymous/teammate events excluded',
  'global/track mute, live volume, natural BGM restoration and legacy zero-LP compatibility',
  'offline store transitions without battle batches; first reconnect batch baseline and future recovery',
  'full unsubscribe, BGM handler restoration, bridge deletion and disposed observer inertness',
]}));
