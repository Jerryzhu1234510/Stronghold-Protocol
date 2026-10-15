'use strict';

// Client-owned persistent music channel. Mods provide a local track, never code.
// This factory is serialized into the isolated renderer and has no Node dependencies.
function createSessionMusicPlayer({getSettings,onChange}={}){
  let track=null,sound=null,context='',lastRound=null;
  let desired=false,interrupted=false,held=false,failed=false,disposed=false,starting=false;
  let awaitFresh=false,stalePublic=null,serial=0,blocked=false;
  const status={playing:false,blocked:false,plays:0,errors:0};
  const notify=()=>{status.blocked=blocked;try{onChange?.(status);}catch{}};
  const settings=()=>{try{return getSettings?.()||{bgm:0.6,muted:false};}catch{return {bgm:0.6,muted:false};}};
  const audible=()=>{const s=settings();return !!track&&track.volume!==0&&!s.muted&&(s.bgm??0.6)>0;};
  function clearGesture(){window.removeEventListener('pointerdown',unlock,true);window.removeEventListener('keydown',unlock,true);}
  function pause(){
    serial++;starting=false;
    const wasPlaying=status.playing;status.playing=false;
    if(sound)try{sound.pause();}catch{}
    if(wasPlaying)notify();
  }
  function release(){
    clearGesture();blocked=false;pause();const old=sound;sound=null;
    if(old){old.onended=null;old.onerror=null;try{old.removeAttribute('src');old.load();}catch{}}
    notify();
  }
  function resetMatch(){
    desired=false;held=false;failed=false;context='';lastRound=null;
    awaitFresh=false;stalePublic=null;release();
  }
  function unlock(event){
    if(!event.isTrusted)return;
    clearGesture();blocked=false;notify();void resume();
  }
  function defer(){
    blocked=true;clearGesture();notify();
    window.addEventListener('pointerdown',unlock,true);window.addEventListener('keydown',unlock,true);
  }
  async function resume(){
    if(disposed||!desired||interrupted||held||failed||blocked||starting||status.playing||!audible())return;
    if(!sound){
      const next=new Audio();sound=next;next.preload='none';next.loop=true;next.src=track.url;
      if(track.startSeconds)next.addEventListener('loadedmetadata',()=>{
        if(sound!==next)return;
        try{next.currentTime=Math.min(track.startSeconds,Math.max(0,next.duration-0.05));}catch{}
      },{once:true});
      next.onerror=()=>{if(sound!==next||disposed)return;status.errors++;failed=true;release();};
      // Native looping normally prevents ended. Recover from a platform that
      // reports the boundary anyway, without changing the session's lifetime.
      next.onended=()=>{if(sound!==next||disposed)return;pause();try{next.currentTime=0;}catch{}void resume();};
    }
    const next=sound,s=settings();next.volume=Math.max(0,Math.min(1,(s.bgm??0.6)*(track.volume??0.8)));
    const attempt=++serial;starting=true;
    try{
      await next.play();
      if(attempt!==serial||disposed||sound!==next)return;
      starting=false;status.playing=true;status.plays++;notify();
    }catch(error){
      if(attempt!==serial||disposed||sound!==next)return;
      starting=false;status.playing=false;
      if(error?.name==='NotAllowedError')defer();else{status.errors++;failed=true;release();}
    }
  }
  function refresh(){
    const s=settings();if(sound)sound.volume=s.muted?0:Math.max(0,Math.min(1,(s.bgm??0.6)*(track?.volume??0.8)));
    if(!desired||interrupted||held||!audible()){if(status.playing||starting)pause();return;}
    void resume();
  }
  return {
    status,
    configure(next){
      const identity=t=>t?String(t.id||'')+'|'+t.url+'|'+(t.startSeconds||0):'';
      if(identity(next)!==identity(track))release();
      track=next||null;held=false;failed=false;
      if(!track){desired=false;release();}else refresh();
    },
    consume(state){
      if(disposed)return;
      const pub=state?.match?.public,room=state?.room,own=state?.me?.playerId;
      if(!room?.inMatch||pub?.phase==='RESULT'||pub?.phase==='LOBBY'){
        resetMatch();return;
      }
      const nextContext=String(room.code||room.id||'')+':'+own;
      if(!['online','connected'].includes(state?.connection?.status)){
        desired=false;awaitFresh=true;stalePublic=pub;pause();return;
      }
      if(!pub){desired=false;awaitFresh=true;stalePublic=pub;pause();return;}
      if(awaitFresh&&pub===stalePublic){desired=false;pause();return;}
      awaitFresh=false;stalePublic=null;
      const member=Array.isArray(pub.players)&&pub.players.some(p=>p?.playerId===own&&!p.left&&p.status!=='left');
      const seated=!Array.isArray(room.seats)||room.seats.some(p=>p?.playerId===own);
      if(typeof own!=='string'||!member||!seated||room.spectators?.some(p=>p?.playerId===own)||pub.modeId==='versus'){
        resetMatch();return;
      }
      const round=Number.isFinite(pub.round)?pub.round:null;
      const beginning=round===0&&['INFO_CHECK','BAND_DRAFT','SP_DRAFT'].includes(pub.phase);
      if(context!==nextContext||(round!==null&&lastRound!==null&&round<lastRound)||(beginning&&lastRound>0)){
        resetMatch();context=nextContext;
      }
      lastRound=round;desired=!!track;
      refresh();
    },
    setInterrupted(value){interrupted=!!value;refresh();},
    refresh,
    manualStop(){held=true;clearGesture();blocked=false;pause();notify();},
    dispose(){disposed=true;desired=false;track=null;release();},
  };
}

if(typeof module==='object'&&module.exports)module.exports={createSessionMusicPlayer};
else Object.defineProperty(globalThis,'SPDesktopSessionMusicFactory',{value:createSessionMusicPlayer});
