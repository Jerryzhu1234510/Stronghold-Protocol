'use strict';
const {createBattleMusicDetector}=require('./battle-music-events.cjs');
const {createSessionMusicPlayer}=require('./session-music.cjs');

// Consumes the existing authoritative public state. No added network messages or battle polling.
function createTeammateZeroDetector(){
  let key='',lastPublic=null,previous=null,lastRound=null,lastPhase=null,awaitSnapshot=false;
  let fired=new Set();
  const reset=()=>{key='';lastPublic=null;previous=null;lastRound=null;lastPhase=null;awaitSnapshot=false;fired=new Set();};
  return {consume(state,{includeSelf=false}={}){
    const pub=state?.match?.public,room=state?.room,own=state?.me?.playerId,players=pub?.players;
    const active=!!(room&&pub&&(room.inMatch||pub.phase==='RESULT')&&pub.phase!=='LOBBY'&&Array.isArray(players)&&players.some(p=>p.playerId===own)&&pub.modeId!=='versus'&&!room.spectators?.some(p=>p?.playerId===own)&&(!Array.isArray(room.seats)||room.seats.some(p=>p?.playerId===own)));
    if(!active){reset();return {active:false,events:[]};}
    if(state.connection?.status&&!['online','connected'].includes(state.connection.status)){
      lastPublic=pub;previous=null;awaitSnapshot=true;return {active:true,events:[]};
    }
    // An online status update can still contain the pre-disconnect public state. Wait for a fresh snapshot.
    if(awaitSnapshot&&lastPublic===pub)return {active:true,events:[]};
    awaitSnapshot=false;
    const context=String(room.code||room.id||'')+':'+own+':'+(pub.modeId||'coop')+':'+(pub.matchId||room.matchId||'');
    const round=Number.isFinite(pub.round)?pub.round:null;
    const beginning=['INFO_CHECK','BAND_DRAFT','SP_DRAFT'].includes(pub.phase);
    if(key!==context||(round!==null&&lastRound!==null&&round<lastRound)||(beginning&&lastPhase&&!['INFO_CHECK','BAND_DRAFT','SP_DRAFT'].includes(lastPhase))){previous=null;fired=new Set();}
    key=context;lastRound=round;lastPhase=pub.phase;lastPublic=pub;
    const next=new Map(),events=[];
    for(const p of players){
      if(!p||typeof p.playerId!=='string'||!Number.isFinite(p.lp))continue;
      next.set(p.playerId,p.lp);
      // Already eliminated on initial load/reconnect is a baseline, never an event.
      // LP is initialized to 0 before strategy selection; these are not eliminated players.
      if(!beginning&&!previous&&p.lp<=0)fired.add(p.playerId);
      if(!beginning&&(includeSelf||p.playerId!==own)&&p.status!=='left'&&!p.left&&previous?.get(p.playerId)>0&&p.lp<=0&&!fired.has(p.playerId)){
        fired.add(p.playerId);events.push({event:'teammate-zero-lp',playerId:p.playerId,isBot:p.isBot===true});
      }
    }
    previous=next;return {active:true,events};
  },reset};
}

// No public match ID exists in either supported game version. Observe the
// authoritative waiting-room -> in-match transition, then its first briefing.
// Loading/reconnecting directly into an existing match never arms this event.
function createMatchStartDetector(){
  let context='',armed=false,pending=false,baseline=null,lastRoom=null,awaitFresh=false;
  const reset=()=>{context='';armed=false;pending=false;baseline=null;lastRoom=null;awaitFresh=false;};
  return {consume(state){
    const room=state?.room,pub=state?.match?.public,own=state?.me?.playerId;
    const status=state?.connection?.status;
    if(status&&!['online','connected'].includes(status)){
      context='';armed=false;pending=false;baseline=null;lastRoom=room;awaitFresh=true;
      return {active:false,events:[]};
    }
    // An online status frame can still hold the waiting room from before loss
    // of connection. Only a new room snapshot can establish a new baseline.
    if(awaitFresh&&lastRoom===room)return {active:false,events:[]};
    awaitFresh=false;lastRoom=room;
    const seated=room&&Array.isArray(room.seats)&&room.seats.some(p=>p?.playerId===own);
    const spectating=room?.spectators?.some(p=>p?.playerId===own);
    if(typeof own!=='string'||!room||!seated||spectating||pub?.modeId==='versus'){
      context='';armed=false;pending=false;baseline=null;
      return {active:false,events:[]};
    }
    const key=String(room.code||room.id||'')+':'+own;
    if(key!==context){context=key;armed=false;pending=false;baseline=null;}
    if(room.inMatch===false){
      armed=true;pending=false;baseline=pub;
      return {active:pub?.phase==='RESULT'&&pub.players?.some(p=>p?.playerId===own),events:[]};
    }
    if(room.inMatch!==true){armed=false;pending=false;return {active:false,events:[]};}
    if(armed){armed=false;pending=true;}
    // main.js clears public state before applying room.state. Preserve the
    // pending transition through that null frame and ignore the old snapshot.
    if(!pending||!pub||pub===baseline)return {active:true,events:[]};
    if(pub.phase==='INFO_CHECK'&&pub.round===0&&pub.players?.some(p=>p?.playerId===own)){
      pending=false;return {active:true,events:[{event:'match-start'}]};
    }
    // A later draft/round is not a missed event to replay. Ordinary SP_DRAFT
    // phases must never be mistaken for a new game.
    pending=false;return {active:true,events:[]};
  },reset};
}

// Count actual distinct deployed operators, matching the game's base-ID and
// conversion-item rules. Public bond counts also contain virtual bonuses.
function deployedCoreAlliances(state,data){
  if(!data?.get)return [];
  const chess=data.get('chess'),bonds=data.get('bonds'),items=data.get('items'),backups=data.get('backups');
  const priv=state?.match?.private,pub=state?.match?.public;
  if(!chess||!bonds||!items||!Array.isArray(priv?.board))return [];
  const disabled=new Set(pub?.disabledBonds||[]),counts=new Map();
  for(const piece of priv.board){
    if(piece?.kind!=='chess')continue;
    const rec=chess[piece.id];if(!rec)continue;
    const base=rec.baseId||rec.chessId||piece.id,pick=priv.diy?.[base];
    const innate=rec.isDiy?backups?.diy?.operators?.[pick?.charId]?.bonds:rec.bonds;
    const effective=new Set(Array.isArray(innate)?innate:[]);
    const equipment=(piece.items||[]).map(it=>items[it.id]).filter(Boolean);
    if(equipment.length>=2&&equipment.some(it=>it.canGiveBond))for(const it of equipment)if(!it.canGiveBond&&it.giveBondId)effective.add(it.giveBondId);
    for(const id of effective){
      if(!bonds[id]?.isCore||disabled.has(id)||priv.bonds?.some(b=>b.bondId===id&&b.off))continue;
      if(!counts.has(id))counts.set(id,new Set());counts.get(id).add(base);
    }
  }
  return [...counts].map(([bondId,ids])=>({bondId,count:ids.size})).sort((a,b)=>(bonds[a.bondId].identifier||0)-(bonds[b.bondId].identifier||0)||a.bondId.localeCompare(b.bondId));
}

// Stage/result cues require a live transition. A first snapshot, reconnect or
// observing someone else's room only establishes a baseline.
function createCommonMusicDetector(){
  let context='',previous=null,lastPublic=null,awaitFresh=false,lastThreshold=null;
  let seen=new Set(),results=new Set(),selfFired=false,lowFired=false,combat=null,resultArmed=false,resultBaseline=null;
  const combatPhases=new Set(['COMBAT','UNITE','FINAL_ASSAULT','HIDDEN_CORE']);
  function reset(){context='';previous=null;lastPublic=null;awaitFresh=false;lastThreshold=null;seen=new Set();results=new Set();selfFired=false;lowFired=false;combat=null;resultArmed=false;resultBaseline=null;}
  return {consume(state,{lowLpThreshold=null,data=null}={}){
    const pub=state?.match?.public,room=state?.room,own=state?.me?.playerId;
    // A transient empty match frame is not a new match. Keep once-per-match
    // history, but baseline the next snapshot so no missed event is replayed.
    if(room?.inMatch&&!pub&&context===String(room.code||room.id||'')+':'+own){previous=null;lastPublic=null;awaitFresh=false;combat=null;resultArmed=false;return {active:true,events:[]};}
    const member=pub?.players?.find(p=>p?.playerId===own);
    const active=!!(room&&pub&&member&&(room.inMatch||pub.phase==='RESULT')&&pub.phase!=='LOBBY'&&pub.modeId!=='versus'&&!room.spectators?.some(p=>p?.playerId===own)&&(!Array.isArray(room.seats)||room.seats.some(p=>p?.playerId===own)));
    if(!active){reset();return {active:false,events:[]};}
    const key=String(room.code||room.id||'')+':'+own;
    if(context!==key){reset();context=key;}
    if(state.connection?.status&&!['online','connected'].includes(state.connection.status)){
      previous=null;lastPublic=pub;awaitFresh=true;combat=null;resultArmed=false;resultBaseline=state.match.result;return {active:true,events:[]};
    }
    if(awaitFresh&&lastPublic===pub)return {active:true,events:[]};
    awaitFresh=false;
    const round=Number.isFinite(pub.round)?pub.round:null,phase=pub.phase;
    const beginning=round===0&&['INFO_CHECK','BAND_DRAFT','SP_DRAFT'].includes(phase);
    if(previous&&((round!==null&&previous.round!==null&&round<previous.round)||(beginning&&previous.round>0))){
      previous=null;seen=new Set();results=new Set();selfFired=false;lowFired=false;combat=null;resultArmed=false;
    }
    const threshold=Number.isInteger(lowLpThreshold)&&lowLpThreshold>0&&lowLpThreshold<=999?lowLpThreshold:null;
    const events=[],enter=!previous||previous.phase!==phase||previous.round!==round;
    const emit=(event,suffix='')=>{const k=event+':'+round+':'+suffix;if(!seen.has(k)){seen.add(k);events.push({event});}};
    if(previous&&enter){
      if(phase==='ROUND_START')emit('round-start');
      if(phase==='PREP')emit('prep-start');
      if(combatPhases.has(phase)){
        const firstCombat=!seen.has('combat-start:'+round+':');
        emit('combat-start');
        if(phase==='UNITE')emit('unite-start');
        if(phase==='FINAL_ASSAULT'||phase==='HIDDEN_CORE')emit('boss-start',phase);
        if(firstCombat&&phase==='COMBAT'&&Number.isFinite(member.lp))combat={round,lp:member.lp};
        if(firstCombat){
          const cores=deployedCoreAlliances(state,data),qualified=cores.filter(b=>b.count>=9);
          const selected=qualified.length?qualified:cores.filter(b=>b.count>=6);
          if(selected.length){const level=qualified.length?9:6;events.push({event:'core-alliance-'+level+'-combat-start',bondId:selected[0].bondId,count:selected[0].count,bondIds:selected.map(b=>b.bondId)});}
        }
      }
      if(phase==='SETTLE'&&combat?.round===round){
        const loss=pub.uniteResult?.losses?.[own];
        const actual=Number.isFinite(loss)&&loss>=0?loss:Number.isFinite(member.lp)?Math.max(0,combat.lp-member.lp):null;
        emit('round-end');
        if(actual!==null)emit(actual>0?'round-loss':'round-win');
        combat=null;
      }
      if(phase==='RESULT'){
        resultArmed=true;resultBaseline=state.match.result;
        // m.result normally follows m.public. If both arrived in the same
        // store update, accept a new stable result ID as well.
        if(state.match.result?.resultId&&!results.has(state.match.result.resultId))resultBaseline=null;
      }
    }
    if(!previous){
      // Mark the initially observed stage as seen without emitting it.
      if(phase==='ROUND_START')seen.add('round-start:'+round+':');
      if(phase==='PREP')seen.add('prep-start:'+round+':');
      if(combatPhases.has(phase)){
        seen.add('combat-start:'+round+':');
        if(phase==='UNITE')seen.add('unite-start:'+round+':');
        if(phase==='FINAL_ASSAULT'||phase==='HIDDEN_CORE')seen.add('boss-start:'+round+':'+phase);
      }
      if(state.match.result?.resultId)results.add(state.match.result.resultId);
      resultArmed=false;resultBaseline=state.match.result;
    }
    const result=state.match.result;
    if(phase==='RESULT'&&resultArmed&&result&&result!==resultBaseline&&typeof result.resultId==='string'&&result.resultId&&!results.has(result.resultId)&&typeof result.victory==='boolean'){
      results.add(result.resultId);resultArmed=false;
      events.push({event:'match-end'},{event:result.victory?'match-win':'match-loss'});
    }
    const initialized=!beginning&&Number.isFinite(member.lp)&&member.status!=='left'&&!member.left;
    if(previous&&initialized&&Number.isFinite(previous.lp)){
      if(previous.lp>0&&member.lp<=0&&!selfFired){selfFired=true;events.push({event:'self-zero-lp',playerId:own,isBot:member.isBot===true});}
      if(threshold!==null&&threshold===lastThreshold&&previous.lp>threshold&&member.lp>0&&member.lp<=threshold&&!lowFired){lowFired=true;events.push({event:'low-lp',playerId:own,isBot:member.isBot===true});}
    }
    previous={phase,round,lp:beginning?null:member.lp};lastThreshold=threshold;lastPublic=pub;
    return {active:true,events};
  },reset};
}

function createMusicEventDetector(){
  const zero=createTeammateZeroDetector(),start=createMatchStartDetector(),common=createCommonMusicDetector();
  return {consume(state,options){
    const a=zero.consume(state,options),b=start.consume(state),c=common.consume(state,options);
    return {active:a.active||b.active||c.active,events:[...b.events,...a.events,...c.events]};
  },reset(){zero.reset();start.reset();common.reset();}};
}

// Fixed client-owned renderer code; a Mod contributes audio/config only, never executable code.
function installMusicEvents(config,makeDetector,makeBattleDetector,makeSessionPlayer){
  if(globalThis.__SPDesktopMusic){globalThis.__SPDesktopMusic.configure(config);return;}
  if(!config.tracks?.length&&!config.sessionTrack)return;
  const detector=makeDetector(),battleDetector=makeBattleDetector();let tracks=config.tracks||[],store=null,unsubscribe=null,bindTimer=null;
  let sessionTrack=config.sessionTrack||null;
  const feeds=new Map();
  const windScopes=new WeakMap(),freezeTimes=new WeakMap();
  let sound=null,playingTrack=null,pending=null,pendingTimer=null,disposed=false,gameAudio=null,originalApply=null,applyWrapper=null,currentPriority=-1;
  const priorities={'match-win':100,'match-loss':100,'match-end':95,'self-zero-lp':90,'teammate-zero-lp':85,'low-lp':80,'core-alliance-9-combat-start':75,'core-alliance-6-combat-start':70,'boss-start':65,'unite-start':60,'siracusa-true-damage':55,'kjerag-operator-freeze':55,'kjerag-alliance-freeze':55,'round-win':50,'round-loss':50,'round-end':45,'combat-start':40,'match-start':30,'round-start':20,'prep-start':10};
  const eventOrder=Object.keys(priorities);
  const status={bound:false,triggers:0,plays:0,errors:0,blocked:0,playing:false,sessionPlaying:false,sessionBlocked:false,sessionPlays:0,lastPlayerId:null,lastEvent:null};
  const settings=()=>{if(gameAudio?.volumes)return gameAudio.volumes;try{return JSON.parse(localStorage.getItem('sp.pref.settings')||'null')||{bgm:0.6,muted:false};}catch{return {bgm:0.6,muted:false};}};
  const sessionPlayer=makeSessionPlayer({getSettings:settings,onChange(s){status.sessionPlaying=s.playing;status.sessionBlocked=s.blocked;status.sessionPlays=s.plays;applyMix();}});
  sessionPlayer.configure(sessionTrack);
  function applyMix(){
    if(!gameAudio||!originalApply)return;
    if((status.playing||sessionPlayer.status.playing)&&gameAudio.bgmGain&&gameAudio.ctx){try{gameAudio.bgmGain.gain.setTargetAtTime(0,gameAudio.ctx.currentTime,0.05);}catch{}}
    else try{originalApply.call(gameAudio);}catch{}
  }
  function syncVolume(){
    const s=settings();if(sound)sound.volume=s.muted?0:Math.max(0,Math.min(1,(s.bgm??0.6)*(playingTrack?.volume??0.8)));
    sessionPlayer.refresh();applyMix();
  }
  function clearPending(){pending=null;clearTimeout(pendingTimer);window.removeEventListener('pointerdown',unlock,true);window.removeEventListener('keydown',unlock,true);}
  function stopEvent(resumeSession=true){
    clearPending();const old=sound;sound=null;playingTrack=null;currentPriority=-1;status.playing=false;
    if(old){old.onended=null;old.onerror=null;old.pause();old.removeAttribute('src');old.load();}
    sessionPlayer.setInterrupted(!resumeSession);applyMix();
  }
  function stop(){sessionPlayer.manualStop();stopEvent();}
  function defer(track,priority){
    clearPending();pending={track,priority};currentPriority=priority;status.blocked++;
    window.addEventListener('pointerdown',unlock,true);window.addEventListener('keydown',unlock,true);
    pendingTimer=setTimeout(()=>{clearPending();currentPriority=-1;},30000);
  }
  function unlock(event){if(!event.isTrusted)return;const queued=pending;clearPending();currentPriority=-1;if(queued)void play(queued.track,queued.priority);}
  async function play(track,priority=0){
    if(disposed)return;
    const prefs=settings();if(prefs.muted||prefs.bgm===0||track.volume===0)return;
    if(sound||pending){if(priority<=currentPriority)return;stopEvent(false);}
    sessionPlayer.setInterrupted(true);
    const next=new Audio();sound=next;playingTrack=track;currentPriority=priority;next.preload='none';next.loop=false;
    next.src=track.url;next.onended=()=>stopEvent();next.onerror=()=>{if(sound===next){status.errors++;stopEvent();}};
    syncVolume();
    if(track.startSeconds)next.addEventListener('loadedmetadata',()=>{try{next.currentTime=Math.min(track.startSeconds,Math.max(0,next.duration-0.05));}catch{}},{once:true});
    try{await next.play();if(sound!==next||disposed){next.pause();return;}status.playing=true;status.plays++;syncVolume();}
    catch(error){if(sound!==next)return;stopEvent();if(error.name==='NotAllowedError')defer(track,priority);else status.errors++;}
  }
  async function attachAudio(){
    try{
      const build=globalThis.__SP_GENERATION;
      const base=typeof build==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(build)?'/_build/'+build:'';
      const module=await import(base+'/js/audio.js');if(disposed)return;
      if(module.audio&&typeof module.audio._applyVolumes==='function'){
        gameAudio=module.audio;originalApply=gameAudio._applyVolumes;
        applyWrapper=function(){const result=originalApply.call(this);syncVolume();return result;};
        gameAudio._applyVolumes=applyWrapper;syncVolume();
      }
    }catch{/* Audio fallback still follows saved mute/volume settings. */}
  }
  function dispatch(events){
    const candidates=events.map(e=>({e,track:tracks.find(t=>t.event===e.event&&t.volume!==0&&(t.includeBots||!e.isBot))})).filter(c=>c.track).sort((a,b)=>(priorities[b.e.event]||0)-(priorities[a.e.event]||0)||eventOrder.indexOf(a.e.event)-eventOrder.indexOf(b.e.event));
    const selected=candidates[0];if(!selected)return;
    const {e,track}=selected;status.triggers++;status.lastPlayerId=e.playerId??null;status.lastEvent=e.event;void play(track,priorities[e.event]||0);
  }
  function onBattle(batch){
    if(disposed||!store||!tracks.some(t=>['siracusa-true-damage','kjerag-operator-freeze','kjerag-alliance-freeze'].includes(t.event)))return;
    const state=store.get(),result=battleDetector.consume(state,batch,typeof performance!=='undefined'?performance.now():Date.now());
    if(result.active)dispatch(result.events);
  }
  function bindFeeds(){
    const sources=[globalThis.__SP__?.net,globalThis.__SP_RUNNER__].filter(s=>s&&typeof s.on==='function');
    for(const [source,off]of feeds)if(!sources.includes(source)){try{off();}catch{}feeds.delete(source);}
    for(const source of sources)if(!feeds.has(source)){
      try{const off=source.on(source===globalThis.__SP_RUNNER__?'ev':'b.ev',onBattle);feeds.set(source,typeof off==='function'?off:()=>{});}catch{}
    }
  }
  function onState(state){
    bindFeeds();
    sessionPlayer.consume(state);
    battleDetector.consume(state,null,typeof performance!=='undefined'?performance.now():Date.now());
    const result=detector.consume(state,{includeSelf:tracks.some(t=>t.event==='teammate-zero-lp'&&t.includeSelf===true),lowLpThreshold:tracks.find(t=>t.event==='low-lp')?.threshold??null,data:globalThis.__SP__?.data});if(!result.active){battleDetector.reset();stopEvent();return;}
    syncVolume();dispatch(result.events);
  }
  function bind(){
    if(disposed)return;const candidate=globalThis.__SP__?.store;
    if(!candidate?.get||!candidate?.subscribe){bindTimer=setTimeout(bind,300);return;}
    store=candidate;status.bound=true;onState(store.get());unsubscribe=store.subscribe(onState);void attachAudio();
  }
  const freezeBridge={
    enterWind(battle,playerId){const token={battle,previous:windScopes.get(battle)};windScopes.set(battle,playerId);return token;},
    exitWind(token){if(!token?.battle)return;if(token.previous===undefined)windScopes.delete(token.battle);else windScopes.set(token.battle,token.previous);},
    freeze(battle,target,source){
      if(disposed||!store||target?.side!=='enemy'||typeof battle?.fx!=='function')return;
      const state=store.get(),own=state.me?.playerId,field=state.match?.field;
      if(!field?.local||field.fieldId!==battle.fieldId)return;
      let sourceKind=null;
      if(source?.kind==='op'&&source.side==='ally'&&source.ownerId===own){
        const innate=source.def?.bonds||source.def?.raw?.bonds||[],effective=new Set(innate);
        const items=globalThis.__SP__?.data?.get('items')||{};
        const equipment=(source.items||[]).map(it=>items[typeof it==='string'?it:it.id]).filter(Boolean);
        if(equipment.some(it=>it.canGiveBond))for(const it of equipment)if(!it.canGiveBond&&it.giveBondId)effective.add(it.giveBondId);
        if(effective.has('kjeragShip'))sourceKind='operator';
      }else if(source==null&&windScopes.get(battle)===own)sourceKind='alliance';
      const event=sourceKind==='operator'?'kjerag-operator-freeze':sourceKind==='alliance'?'kjerag-alliance-freeze':null;
      if(!event||!tracks.some(t=>t.event===event&&t.volume!==0))return;
      let times=freezeTimes.get(battle);if(!times){times=new Map();freezeTimes.set(battle,times);}
      const time=battle.time,last=times.get(event);if(!Number.isFinite(time)||(last!==undefined&&time-last<2))return;
      times.set(event,time);
      // This is a local decorative tuple only. The runner drops cosmetic FX
      // during catch-up, so a stale freeze cannot start music on reconnect.
      battle.fx('desktopFreeze',{x:target.x,y:target.y,ownerId:own,sourceKind,from:source?.id??null,id:target.id});
    },
  };
  globalThis.__SPDesktopMusicBridge=freezeBridge;
  function dispose(){disposed=true;clearTimeout(bindTimer);unsubscribe?.();for(const off of feeds.values())try{off();}catch{}feeds.clear();battleDetector.reset();sessionPlayer.dispose();stopEvent(false);if(gameAudio?._applyVolumes===applyWrapper)gameAudio._applyVolumes=originalApply;if(globalThis.__SPDesktopMusicBridge===freezeBridge)delete globalThis.__SPDesktopMusicBridge;window.removeEventListener('pagehide',dispose);delete globalThis.__SPDesktopMusic;}
  globalThis.__SPDesktopMusic={status,stop,suspend(){stopEvent(false);sessionPlayer.setInterrupted(true);},resume(){sessionPlayer.setInterrupted(false);if(store)sessionPlayer.consume(store.get());},preview:()=>{const track=tracks[0]||sessionTrack;return track&&play(track,1000);},configure(next){stopEvent(false);tracks=next.tracks||[];sessionTrack=next.sessionTrack||null;sessionPlayer.configure(sessionTrack);if(store)sessionPlayer.consume(store.get());sessionPlayer.setInterrupted(false);syncVolume();},dispose};
  window.addEventListener('pagehide',dispose,{once:true});bind();
}
const musicBootstrap=config=>'(()=>{const createTeammateZeroDetector='+createTeammateZeroDetector.toString()+';const createMatchStartDetector='+createMatchStartDetector.toString()+';const deployedCoreAlliances='+deployedCoreAlliances.toString()+';const createCommonMusicDetector='+createCommonMusicDetector.toString()+';const createMusicEventDetector='+createMusicEventDetector.toString()+';const createBattleMusicDetector='+createBattleMusicDetector.toString()+';const createSessionMusicPlayer='+createSessionMusicPlayer.toString()+';('+installMusicEvents.toString()+')('+JSON.stringify(config)+',createMusicEventDetector,createBattleMusicDetector,createSessionMusicPlayer);})();';
module.exports={createTeammateZeroDetector,createMatchStartDetector,deployedCoreAlliances,createCommonMusicDetector,createMusicEventDetector,createBattleMusicDetector,createSessionMusicPlayer,installMusicEvents,musicBootstrap};
