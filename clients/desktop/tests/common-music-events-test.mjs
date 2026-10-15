import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

if(typeof vm.SyntheticModule!=='function'){
  const child=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(child.status??1);
}
const require=createRequire(import.meta.url);
const {createCommonMusicDetector,deployedCoreAlliances,musicBootstrap}=require('../music-events.cjs');
assert.equal(typeof createCommonMusicDetector,'function','the common detector is independently testable');
const players=(lp=20)=>[{playerId:'me',lp},{playerId:'friend',lp:20},{playerId:'bot',lp:20,isBot:true}];
const state=(phase='PREP',round=1,lp=20,extra={})=>({
  connection:{status:'online'},me:{playerId:'me'},room:{code:'ABCD',inMatch:true,seats:players(),spectators:[]},
  match:{public:{phase,round,modeId:'coop',players:players(lp)}},...extra,
});
const waiting=()=>state('LOBBY',0,20,{room:{code:'ABCD',inMatch:false,seats:players(),spectators:[]},match:{public:null}});
const consume=(d,s,options)=>d.consume(s,options).events.map(e=>e.event);
const take=(events,...names)=>events.filter(e=>names.includes(e));

{
  const d=createCommonMusicDetector();d.consume(state('INFO_CHECK',0));
  assert.deepEqual(consume(d,state('ROUND_START',1)),['round-start']);
  assert.deepEqual(consume(d,state('ROUND_START',1)),[],'duplicate round snapshots are silent');
  assert.deepEqual(consume(d,state('SP_DRAFT',1)),[]);
  assert.deepEqual(consume(d,state('PREP',1)),['prep-start']);
  assert.deepEqual(consume(d,state('SP_DRAFT',1)),[]);
  assert.deepEqual(consume(d,state('PREP',1)),[],'returning from strategy selection cannot repeat preparation music');
  assert.deepEqual(consume(d,state('COMBAT',1)),['combat-start']);
  assert.deepEqual(consume(d,state('COMBAT',1)),[]);
  assert.deepEqual(consume(d,state('UNITE',1)),['unite-start'],'the same combat entering joint defense adds only the defense cue');
  assert.deepEqual(consume(d,state('COMBAT',1)),[],'returning to personal combat does not restart combat music');
  assert.deepEqual(consume(d,state('ROUND_START',2)),['round-start']);
  assert.deepEqual(consume(d,state('PREP',2)),['prep-start']);
  assert.deepEqual(consume(d,state('COMBAT',2)),['combat-start'],'the next round has its own combat cue');
}
for(const phase of ['ROUND_START','PREP','COMBAT','FINAL_ASSAULT','HIDDEN_CORE','UNITE']){
  const d=createCommonMusicDetector();
  assert.deepEqual(consume(d,state(phase,phase==='FINAL_ASSAULT'||phase==='HIDDEN_CORE'?14:1)),[],'first snapshot in '+phase+' is a baseline');
  assert.deepEqual(consume(d,state(phase,phase==='FINAL_ASSAULT'||phase==='HIDDEN_CORE'?14:1)),[],'repeated initial '+phase+' remains silent');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',2));
  const before=state('PREP',2);d.consume(before);
  d.consume({...before,connection:{status:'offline'}});
  assert.deepEqual(consume(d,before),[],'stale public state at reconnect cannot trigger');
  assert.deepEqual(consume(d,state('UNITE',2)),[],'the first fresh reconnect snapshot is a baseline, including joint defense');
  assert.deepEqual(consume(d,state('ROUND_START',3)),['round-start'],'future live round transitions work after reconnect');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1));
  const spectating=state('COMBAT',1);spectating.room.spectators=[{playerId:'me'}];
  assert.equal(d.consume(spectating).active,false);assert.deepEqual(consume(d,spectating),[]);
  assert.deepEqual(consume(d,state('COMBAT',1)),[],'a returning participant gets no cue for the already-active phase');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1));
  const other=state('COMBAT',1,20,{me:{playerId:'spectator'}});
  assert.equal(d.consume(other).active,false,'public player membership excludes spectators');
}

const low={lowLpThreshold:12};
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20),low);
  assert.deepEqual(take(consume(d,state('PREP',1,13),low),'low-lp'),[]);
  assert.deepEqual(take(consume(d,state('PREP',1,12),low),'low-lp'),['low-lp'],'crossing to the inclusive positive threshold triggers');
  assert.deepEqual(take(consume(d,state('PREP',1,8),low),'low-lp'),[]);
  d.consume(state('PREP',1,20),low);
  assert.deepEqual(take(consume(d,state('PREP',1,10),low),'low-lp'),[],'healing and falling again cannot repeat the warning this match');
  d.consume(waiting(),low);d.consume(state('INFO_CHECK',0,20),low);d.consume(state('ROUND_START',1,20),low);
  assert.deepEqual(take(consume(d,state('PREP',1,10),low),'low-lp'),['low-lp'],'the next match may warn again');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,5),low);
  assert.deepEqual(take(consume(d,state('PREP',1,4),low),'low-lp'),[],'loading already below the threshold is not a crossing');
}
for(const deadLp of [0,-1]){
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20),low);
  const found=consume(d,state('PREP',1,deadLp),low);
  assert.deepEqual(take(found,'low-lp'),[],'zero/dead LP does not play the low-health warning');
  assert.deepEqual(take(found,'self-zero-lp'),['self-zero-lp']);
}
for(const threshold of [undefined,null,'12',12.5,NaN,Infinity,-1,0]){
  const d=createCommonMusicDetector(),options={lowLpThreshold:threshold};d.consume(state('PREP',1,20),options);
  assert.deepEqual(take(consume(d,state('PREP',1,5),options),'low-lp'),[],'a missing, disabled or invalid threshold cannot trigger');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20),{lowLpThreshold:5});
  assert.deepEqual(take(consume(d,state('PREP',1,10),low),'low-lp'),[],'changing a Mod threshold is not a new in-game crossing');
  d.consume(state('PREP',1,20),low);
  assert.deepEqual(take(consume(d,state('PREP',1,10),low),'low-lp'),['low-lp'],'a subsequent crossing with a stable threshold still works');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20),low);const friendLow=state('PREP',1,20);friendLow.match.public.players[1].lp=5;
  assert.deepEqual(take(consume(d,friendLow,low),'low-lp','self-zero-lp'),[],'another player crossing the threshold cannot count as own low LP');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20));
  assert.deepEqual(consume(d,state('PREP',1,0)),['self-zero-lp']);
  assert.deepEqual(consume(d,state('PREP',1,0)),[]);
  d.consume(state('PREP',1,20));
  assert.deepEqual(consume(d,state('PREP',1,0)),[],'own defeat is once per match even if LP later changes');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20),low);d.consume(state('PREP',1,10),low);
  d.consume({...state('PREP',1,10),match:{public:null}},low);d.consume(state('PREP',1,20),low);
  assert.deepEqual(take(consume(d,state('PREP',1,10),low),'low-lp'),[],'an empty public frame in the same live room does not reset once-per-match low-LP history');
}

for(const [afterLp,expected]of [[20,'round-win'],[17,'round-loss']]){
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20));d.consume(state('COMBAT',1,20));
  const settled=consume(d,state('SETTLE',1,afterLp));assert.deepEqual(take(settled,'round-win','round-loss'),[expected],'ordinary round outcome follows settled own LP loss');
  assert.deepEqual(take(settled,'round-end'),['round-end'],'every ordinary settlement has a generic completion cue');
  assert.deepEqual(take(consume(d,state('SETTLE',1,afterLp)),'round-win','round-loss'),[],'settlement is once per round');
}
for(const [afterLp,losses,expected]of [[20,3,'round-loss'],[17,0,'round-win']]){
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20));d.consume(state('COMBAT',1,20));d.consume(state('UNITE',1,20));
  const settled=state('SETTLE',1,afterLp);settled.match.public.uniteResult={losses:{me:losses,friend:0}};
  assert.deepEqual(take(consume(d,settled),'round-win','round-loss'),[expected],'authoritative unite losses take precedence over incidental LP snapshots');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',1,20));const combat=state('COMBAT',1,20);combat.match.public.players[0].pendingLp=0;d.consume(combat);
  assert.deepEqual(take(consume(d,state('SETTLE',1,20)),'round-win','round-loss'),['round-win'],'pending leak prediction is not settled LP loss');
}
{
  const d=createCommonMusicDetector();assert.deepEqual(consume(d,state('SETTLE',3,14)),[],'loading directly into SETTLE cannot invent the just-finished round outcome');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',14));
  const first=consume(d,state('FINAL_ASSAULT',14));assert.deepEqual(take(first,'combat-start','boss-start').sort(),['boss-start','combat-start']);
  assert.deepEqual(take(consume(d,state('FINAL_ASSAULT',14)),'combat-start','boss-start'),[]);
  d.consume(state('ROUND_START',15));d.consume(state('PREP',15));
  const hidden=consume(d,state('HIDDEN_CORE',15));assert.deepEqual(take(hidden,'combat-start','boss-start').sort(),['boss-start','combat-start'],'the hidden core has a distinct observed boss entry');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',14));
  assert.deepEqual(take(consume(d,state('COMBAT',14)),'combat-start','boss-start'),['combat-start'],'ordinary COMBAT is not a boss merely because its round is late');
}

const resultPayload=(resultId,victory,ownVictory=victory)=>({resultId,victory,hiddenCleared:false,reason:victory?'completed':'eliminated',players:[{playerId:'me',victory:ownVictory,alive:ownVictory,left:false,lp:ownVictory?20:0},{playerId:'friend',victory,alive:victory,left:false,lp:victory?20:0}]});
const withResult=(snapshot,result)=>({...snapshot,match:{...snapshot.match,result}});
for(const [victory,ownVictory,expected]of [[true,true,'match-win'],[false,false,'match-loss'],[true,false,'match-win']]){
  const d=createCommonMusicDetector();d.consume(state('COMBAT',6,20));
  assert.deepEqual(take(consume(d,state('RESULT',6,ownVictory?20:0)),'match-win','match-loss','match-end'),[],'RESULT phase alone is not an authoritative final outcome');
  const payload=resultPayload('result-'+String(victory)+'-'+String(ownVictory),victory,ownVictory),done=withResult(state('RESULT',6,ownVictory?20:0),payload);
  assert.deepEqual(take(consume(d,done),'match-win','match-loss','match-end').sort(),['match-end',expected].sort(),'top-level victory matches the result screen, even for an eliminated teammate');
  assert.deepEqual(take(consume(d,withResult(state('RESULT',6),{...payload})),'match-win','match-loss','match-end'),[],'same resultId is consumed only once');
  assert.deepEqual(take(consume(d,withResult(state('RESULT',6),resultPayload('unrelated-extra-result',true))),'match-win','match-loss','match-end'),[],'new resultId without a new observed RESULT transition cannot replay an end cue');
}
{
  const d=createCommonMusicDetector(),done=withResult(state('RESULT',14),resultPayload('initial-result',true));
  assert.deepEqual(consume(d,done),[],'loading result page is only a baseline');assert.deepEqual(consume(d,withResult(state('RESULT',14),{...done.match.result})),[]);
}
{
  const d=createCommonMusicDetector();d.consume(state('RESULT',14));
  assert.deepEqual(consume(d,withResult(state('RESULT',14),resultPayload('initial-delayed-result',true))),[],'an initial RESULT phase cannot arm an end cue merely because its payload arrives later');
}
{
  const d=createCommonMusicDetector(),old=resultPayload('previous-result',false);d.consume(withResult(state('COMBAT',14),old));
  assert.deepEqual(take(consume(d,withResult(state('RESULT',14),old)),'match-win','match-loss','match-end'),[],'old result data during RESULT phase update cannot be reused');
  const next=resultPayload('current-result',true,false);assert.deepEqual(take(consume(d,withResult(state('RESULT',14),next)),'match-win','match-loss','match-end').sort(),['match-end','match-win'],'new result received after the phase update completes the pending end cue');
}
{
  const d=createCommonMusicDetector(),before=state('COMBAT',14);d.consume(before);d.consume({...before,connection:{status:'offline'}});
  const done=withResult(state('RESULT',14),resultPayload('reconnect-result',true));assert.deepEqual(consume(d,done),[],'reconnecting into RESULT never catches up match music');
}
{
  const d=createCommonMusicDetector();d.consume(state('COMBAT',5));
  consume(d,withResult(state('RESULT',5),resultPayload('game-one',false)));
  d.consume(waiting());d.consume(state('INFO_CHECK',0));d.consume(state('COMBAT',6));
  const second=consume(d,withResult(state('RESULT',6),resultPayload('game-two',true)));
  assert.deepEqual(take(second,'match-win','match-loss','match-end').sort(),['match-end','match-win'],'the next game in the same room has its own authoritative result');
}
{
  const d=createCommonMusicDetector();d.consume(state('PREP',14));d.consume(state('FINAL_ASSAULT',14));
  const found=consume(d,withResult(state('RESULT',14),resultPayload('boss-win',true)));
  assert.deepEqual(take(found,'round-win','round-loss'),[],'bosses skip SETTLE and do not fabricate an ordinary round outcome');
  assert.deepEqual(take(found,'match-win','match-loss','match-end').sort(),['match-end','match-win']);
}

const fixtureChess=Object.fromEntries(Array.from({length:12},(_,i)=>['op-'+(i+1),{baseId:'base-'+(i+1),bonds:['core-a']}]));
fixtureChess['op-1-upgrade']={baseId:'base-1',bonds:['core-a']};
fixtureChess.plain={baseId:'plain',bonds:['normal']};
fixtureChess.diy={baseId:'diy-slot',isDiy:true,bonds:['core-a']};
const fixtureTables={
  chess:fixtureChess,
  bonds:{'core-a':{isCore:true,identifier:1},'core-b':{isCore:true,identifier:2},normal:{isCore:false,identifier:3}},
  items:{carrier:{canGiveBond:true},'convert-a':{giveBondId:'core-a'},'convert-b':{giveBondId:'core-b'},'self-convert-b':{canGiveBond:true,giveBondId:'core-b'}},
  backups:{diy:{operators:{selected:{bonds:['core-b']}}}},
};
const fixtureData={get:key=>fixtureTables[key]};
const piece=(id,items=[])=>({kind:'chess',id,uid:id+'-uid',row:0,col:0,items:items.map(id=>({id,uid:id+'-uid'}))});
const board=n=>Array.from({length:n},(_,i)=>piece('op-'+(i+1)));
const withPrivate=(snapshot,priv)=>({...snapshot,match:{...snapshot.match,private:{board:[],hand:[],temp:[],bonds:[],...priv}}});
const coreState=(phase,round,n)=>withPrivate(state(phase,round),{board:board(n)});
assert.equal(typeof deployedCoreAlliances,'function');
assert.deepEqual(deployedCoreAlliances(state(),null),[]);
assert.deepEqual(deployedCoreAlliances(withPrivate(state(),{board:board(6)}),{get:()=>null}),[],'missing tables safely disable the special cue');
assert.deepEqual(deployedCoreAlliances(withPrivate(state(),{board:[...board(6),piece('op-1-upgrade'),{kind:'item',id:'op-7'},piece('unknown')]}),fixtureData),[{bondId:'core-a',count:6}],'distinct deployed base IDs count; upgrades, items and unknown records do not add operators');
assert.deepEqual(deployedCoreAlliances(withPrivate(state(),{hand:board(9),temp:board(9),bonds:[{bondId:'core-a',count:99,active:true,tier:3,layers:100,countsHand:true}]}),fixtureData),[],'private hand/temp and virtual bond count/layers are never deployed members');
{
  const s=withPrivate(state(),{board:[piece('plain',['convert-a'])]});assert.deepEqual(deployedCoreAlliances(s,fixtureData),[],'a conversion item without its carrier cannot grant a bond');
  s.match.private.board=[piece('plain',['carrier','convert-a'])];assert.deepEqual(deployedCoreAlliances(s,fixtureData),[{bondId:'core-a',count:1}]);
  s.match.private.board=[piece('plain',['carrier']),piece('op-1',['convert-b'])];assert.deepEqual(deployedCoreAlliances(s,fixtureData),[{bondId:'core-a',count:1}],'carrier and conversion must be equipped on the same operator');
  s.match.private.board=[piece('plain',['self-convert-b'])];assert.deepEqual(deployedCoreAlliances(s,fixtureData),[],'the authoritative pieceBonds rule requires at least two equipped items and excludes the carrier itself as a conversion target');
}
{
  const s=withPrivate(state(),{board:[piece('diy')],diy:{'diy-slot':{charId:'selected'}}});
  assert.deepEqual(deployedCoreAlliances(s,fixtureData),[{bondId:'core-b',count:1}],'DIY uses the selected operator bonds rather than the placeholder record');
  delete s.match.private.diy;assert.deepEqual(deployedCoreAlliances(s,fixtureData),[],'a DIY slot without a selected operator cannot contribute placeholder bonds');
}
{
  const s=withPrivate(state(),{board:board(9)});s.match.public.disabledBonds=['core-a'];assert.deepEqual(deployedCoreAlliances(s,fixtureData),[],'public disabled bonds are excluded');
  s.match.public.disabledBonds=[];s.match.private.bonds=[{bondId:'core-a',off:true}];assert.deepEqual(deployedCoreAlliances(s,fixtureData),[],'private disabled bond entries are excluded');
}
{
  const d=createCommonMusicDetector(),opts={data:fixtureData};d.consume(coreState('PREP',1,6),opts);
  const six=d.consume(coreState('COMBAT',1,6),opts).events.filter(e=>e.event.startsWith('core-alliance-'));
  assert.equal(six.length,1);assert.equal(six[0].event,'core-alliance-6-combat-start');assert.equal(six[0].bondId,'core-a');assert.equal(six[0].count,6);
  assert.deepEqual(take(consume(d,coreState('UNITE',1,9),opts),'core-alliance-6-combat-start','core-alliance-9-combat-start'),[],'same-round joint defense cannot retrigger the core deployment cue');
  d.consume(coreState('ROUND_START',2,9),opts);d.consume(coreState('PREP',2,9),opts);
  const nine=d.consume(coreState('COMBAT',2,9),opts).events.filter(e=>e.event.startsWith('core-alliance-'));
  assert.equal(nine.length,1);assert.equal(nine[0].event,'core-alliance-9-combat-start');assert.equal(nine[0].count,9,'nine deployed members select only the higher tier');
}
{
  const d=createCommonMusicDetector(),opts={data:fixtureData};d.consume(coreState('PREP',1,5),opts);
  const next=withPrivate(state('COMBAT',1),{board:board(5),hand:board(4),temp:board(4)});
  assert.deepEqual(take(consume(d,next,opts),'core-alliance-6-combat-start','core-alliance-9-combat-start'),[],'reserves cannot turn five deployed members into a special combat trigger');
}
{
  const d=createCommonMusicDetector(),opts={data:fixtureData};assert.deepEqual(consume(d,coreState('COMBAT',1,9),opts),[],'joining an existing nine-member combat does not replay the cue');
  assert.deepEqual(take(consume(d,coreState('UNITE',1,9),opts),'core-alliance-6-combat-start','core-alliance-9-combat-start'),[]);
}
{
  const table={...fixtureChess};for(let i=7;i<=9;i++)table['op-'+i]={baseId:'base-'+i,bonds:['normal']};
  const data={get:key=>key==='chess'?table:fixtureTables[key]},priv={board:board(9).map(p=>({...p,items:[{id:'carrier'},{id:'convert-b'}]}))};
  const d=createCommonMusicDetector();d.consume(withPrivate(state('PREP',1),priv),{data});
  const found=d.consume(withPrivate(state('COMBAT',1),priv),{data}).events.filter(e=>e.event.startsWith('core-alliance-'));
  assert.equal(found.length,1);assert.equal(found[0].event,'core-alliance-9-combat-start');assert.equal(found[0].bondId,'core-b');assert.deepEqual(found[0].bondIds,['core-b'],'a nine-member alliance takes precedence over a different six-member alliance');
}

const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const track=event=>({event,url:'/__test_mods/'+event+'.mp3',volume:0.7,startSeconds:0,includeBots:true,includeSelf:false});
async function rig(initial,tracks,{data=null,net=null,runner=null,clock=null}={}){
  let current=initial,subscriber=null;
  const instances=[],gainCalls=[],timers=new Set();
  const apply=function(){this.bgmGain.gain.setTargetAtTime(this.volumes.muted?0:this.volumes.bgm,this.ctx.currentTime,0.05);};
  const audio={volumes:{muted:false,bgm:0.5},ctx:{currentTime:1},bgmGain:{gain:{setTargetAtTime:(...args)=>gainCalls.push(args)}},_applyVolumes:apply};
  class FakeAudio{
    constructor(){this.pauses=0;this.loads=0;this.duration=180;instances.push(this);}
    async play(){}
    pause(){this.pauses++;}
    load(){this.loads++;}
    removeAttribute(name){delete this[name];}
    addEventListener(){}
    end(){this.onended?.();}
  }
  const context=vm.createContext({Audio:FakeAudio,console,
    window:{addEventListener(){},removeEventListener(){}},
    localStorage:{getItem:()=>JSON.stringify(audio.volumes)},
    setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);},
    __SP_GENERATION:'common-events-fixture',
    __SP__:{data,net,store:{get:()=>current,subscribe(fn){subscriber=fn;return()=>{subscriber=null;};}}},
    __SP_RUNNER__:runner,
    ...(clock?{performance:{now:()=>clock.now}}:{}),
  });
  let module;
  new vm.Script(musicBootstrap({tracks}),{importModuleDynamically:async(specifier)=>{
    assert.equal(specifier,'/_build/common-events-fixture/js/audio.js');
    if(!module){module=new vm.SyntheticModule(['audio'],function(){this.setExport('audio',audio);},{context});await module.link(()=>{});await module.evaluate();}
    return module;
  }}).runInContext(context);
  await flush();
  return {instances,audio,gainCalls,context,
    async set(next){current=next;subscriber?.(next);await flush();},
    get status(){return context.__SPDesktopMusic.status;},
    dispose(){context.__SPDesktopMusic.dispose();assert.equal(audio._applyVolumes,apply);assert.equal(timers.size,0);},
  };
}

for(const [event,before,after]of [
  ['round-start',state('INFO_CHECK',0),state('ROUND_START',1)],
  ['prep-start',state('ROUND_START',1),state('PREP',1)],
  ['combat-start',state('PREP',1),state('COMBAT',1)],
  ['unite-start',state('COMBAT',1),state('UNITE',1)],
  ['boss-start',state('PREP',14),state('FINAL_ASSAULT',14)],
  ['self-zero-lp',state('PREP',1,20),state('PREP',1,0)],
]){
  const r=await rig(before,[track(event)]);assert.equal(r.instances.length,0,'initial '+event+' baseline is silent');
  await r.set(after);assert.equal(r.instances.length,1,event+' is wired into production musicBootstrap');
  const sound=r.instances[0];assert.equal(sound.src,track(event).url);assert.equal(sound.loop,false);assert.equal(sound.volume,0.35);
  await r.set(after);assert.equal(r.instances.length,1,event+' does not replay on the same snapshot');
  sound.end();assert.equal(r.status.playing,false);assert.equal(r.gainCalls.at(-1)[0],0.5,event+' completion restores original game BGM');
  r.dispose();
}

for(const [event,lp]of [['round-end',20],['round-win',20],['round-loss',17]]){
  const r=await rig(state('PREP',1,20),[track(event)]);await r.set(state('COMBAT',1,20));await r.set(state('SETTLE',1,lp));
  assert.equal(r.instances.length,1,event+' is selectable independently of other settlement triggers');assert.equal(r.instances[0].src,track(event).url);
  r.instances[0].end();assert.equal(r.gainCalls.at(-1)[0],0.5);r.dispose();
}
for(const [event,victory]of [['match-end',true],['match-win',true],['match-loss',false]]){
  const r=await rig(state('COMBAT',6),[track(event)]);await r.set(state('RESULT',6));
  assert.equal(r.instances.length,0,event+' waits for the authoritative result payload');
  await r.set(withResult(state('RESULT',6),resultPayload('vm-'+event,victory)));
  assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track(event).url);
  r.instances[0].end();assert.equal(r.gainCalls.at(-1)[0],0.5);r.dispose();
}
{
  const lowTrack={...track('low-lp'),threshold:12},r=await rig(state('PREP',1,20),[lowTrack]);
  await r.set(state('PREP',1,12));assert.equal(r.instances.length,1,'renderer forwards the configured low-LP threshold to the detector');
  assert.equal(r.instances[0].src,lowTrack.url);r.instances[0].end();r.dispose();
}
for(const [count,event]of [[6,'core-alliance-6-combat-start'],[9,'core-alliance-9-combat-start']]){
  const r=await rig(coreState('PREP',1,count),[track(event)],{data:fixtureData});await r.set(coreState('COMBAT',1,count));
  assert.equal(r.instances.length,1,event+' receives authoritative private board and data through the production bootstrap');assert.equal(r.instances[0].src,track(event).url);r.dispose();
}
{
  const r=await rig(state('PREP',14),[track('combat-start'),track('boss-start')]);await r.set(state('FINAL_ASSAULT',14));
  assert.equal(r.instances.length,1,'simultaneous generic and specific cues create only one Audio');assert.equal(r.instances[0].src,track('boss-start').url,'boss entry beats generic combat');r.dispose();
}
{
  const r=await rig(state('PREP',14),[track('combat-start')]);await r.set(state('FINAL_ASSAULT',14));
  assert.equal(r.instances[0].src,track('combat-start').url,'a configured generic cue remains available when a more-specific cue is not installed');r.dispose();
}
{
  const r=await rig(coreState('PREP',14,9),['combat-start','boss-start','core-alliance-6-combat-start','core-alliance-9-combat-start'].map(track),{data:fixtureData});
  await r.set(coreState('FINAL_ASSAULT',14,9));assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track('core-alliance-9-combat-start').url,'nine-core cue beats six-core, boss and combat cues');r.dispose();
}
{
  const r=await rig(state('COMBAT',6),['match-end','match-win','match-loss','self-zero-lp'].map(track));
  await r.set(withResult(state('RESULT',6,0),resultPayload('priority-win',true,false)));
  assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track('match-win').url,'authoritative team victory beats generic end and own defeat');r.dispose();
}
{
  const r=await rig(state('PREP',1),['round-end','round-win'].map(track));await r.set(state('COMBAT',1));await r.set(state('SETTLE',1));
  assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,track('round-win').url,'specific settled outcome beats generic round completion');r.dispose();
}
{
  const own=track('self-zero-lp'),legacy={...track('teammate-zero-lp'),includeSelf:true},r=await rig(state('PREP',1,20),[legacy,own]);
  await r.set(state('PREP',1,0));assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,own.url,'explicit own defeat beats the legacy includeSelf route');r.dispose();
}
{
  const lowTrack={...track('low-lp'),threshold:12},r=await rig(state('PREP',1,20),[track('combat-start'),lowTrack]);
  await r.set(state('COMBAT',1,12));assert.equal(r.instances.length,1);assert.equal(r.instances[0].src,lowTrack.url,'positive critical LP beats generic combat music');r.dispose();
}
{
  const r=await rig(state('INFO_CHECK',0),['round-start','prep-start','combat-start','boss-start'].map(track));
  await r.set(state('ROUND_START',1));const roundClip=r.instances[0];assert.equal(roundClip.src,track('round-start').url);
  await r.set(state('PREP',1));assert.equal(r.instances.length,1,'a lower-priority cue cannot interrupt a playing clip');
  await r.set(state('COMBAT',1));const combatClip=r.instances[1];assert.equal(roundClip.pauses,1,'higher-priority combat interrupts the round cue');assert.equal(combatClip.src,track('combat-start').url);
  await r.set(state('PREP',2));await r.set(state('COMBAT',2));assert.equal(r.instances.length,2,'equal-priority combat does not restart a still-playing combat clip');
  await r.set(state('FINAL_ASSAULT',14));const bossClip=r.instances[2];assert.equal(combatClip.pauses,1);assert.equal(bossClip.src,track('boss-start').url);
  bossClip.end();assert.equal(r.gainCalls.at(-1)[0],0.5);await flush();assert.equal(r.instances.length,3,'skipped lower-priority events are not queued for replay');r.dispose();
}

// Review regressions use the production bootstrap as well. A silent track is
// disabled audio, not a request to claim or interrupt the music channel.
{
  const r=await rig(state('PREP',14),[track('combat-start'),{...track('boss-start'),volume:0}]);
  try{
    await r.set(state('FINAL_ASSAULT',14));assert.equal(r.instances.length,1,'a zero-volume specific cue cannot swallow a configured audible generic cue');
    assert.equal(r.instances[0].src,track('combat-start').url);
  }finally{r.dispose();}
}
{
  const r=await rig(state('PREP',1),[track('combat-start'),{...track('self-zero-lp'),volume:0}]);
  try{
    await r.set(state('COMBAT',1));const playing=r.instances[0];
    await r.set(state('COMBAT',1,0));assert.equal(playing.pauses,0,'a zero-volume higher-priority cue cannot stop an audible clip');
    assert.equal(r.status.playing,true);
  }finally{r.dispose();}
}

function bus(){
  const listeners=new Map();
  return {on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return()=>listeners.get(name)?.delete(fn);},emit(name,batch){for(const fn of [...listeners.get(name)||[]])fn(batch);}};
}
const battleState=()=>{const s=state('COMBAT',1);s.match.field={fieldId:'n:me',battleId:'battle-1',live:true,units:[{id:1,kind:'op',side:'ally',ownerId:'me'}]};return s;};
const procBatch=gt=>({t:'b.ev',fieldId:'n:me',gt,ev:[['fx','bondProc',0,0,{src:'bond:siracusaShip',key:'assassin',amount:10,from:1,id:99}]]});
{
  const net=bus(),clock={now:1000},r=await rig(battleState(),[track('siracusa-true-damage')],{net,clock});
  try{
    net.emit('b.ev',procBatch(1));await flush();assert.equal(r.instances.length,1,'an eligible live Siracusa event reaches the music bridge');r.instances[0].end();
    const offline=battleState();offline.connection.status='offline';await r.set(offline);
    clock.now=4000;await r.set(battleState());
    net.emit('b.ev',procBatch(2));await flush();assert.equal(r.instances.length,1,'the bridge must inform the battle detector of disconnect even when no battle batch arrived offline; first reconnect batch is a baseline');
  }finally{r.dispose();}
}

console.log(JSON.stringify({ok:true,checks:[
  'round/preparation/combat/joint-defense phase transitions and per-round deduplication',
  'initial snapshot and reconnect baselines; explicit and implicit spectator exclusion',
  'inclusive positive low-LP crossing once per match and invalid/disabled threshold exclusion',
  'self-zero transition once per match; zero LP does not count as low LP',
  'ordinary SETTLE outcomes; authoritative unite losses; predictive leaks excluded',
  'boss and hidden-core phase entries; no invented boss round outcome',
  'observed RESULT followed by new resultId; top-level victory; no stale or reconnect result catch-up',
  'deployed distinct core members only; hand/temp, virtual bonuses, conversion, DIY and disabled-bond rules',
  'six/nine deployed-core combat entry; nine-tier precedence and no reconnect/joint-defense replay',
  'production bootstrap playback for phase and self-zero events; original BGM restoration',
  'production bootstrap low-LP threshold and core-data forwarding; all generic result cues',
  'single highest configured cue per frame; specific/generic priorities; interruption without stale queues',
  'zero-volume tracks cannot swallow audible candidates or interrupt a playing clip',
  'battle bridge observes offline state even without an offline batch and baselines reconnect',
]}));
