'use strict';

// Fixed renderer code. A Mod supplies numeric options, never JavaScript or model/simulation mutations.
function installUnitMotion(config={}){
  if(globalThis.__SPDesktopUnitMotion){globalThis.__SPDesktopUnitMotion.configure(config);return globalThis.__SPDesktopUnitMotion;}
  let motion=null,state=null,store=null,unsubscribe=null,bindTimer=null,disposed=false;
  const bodies=new Map(),elements=new Map(),refs=new Map();
  const status={bound:false,views:0,elements:0,applied3d:0,applied2d:0};
  function readMotion(input){
    const value=input&&Object.hasOwn(input,'motion')?input.motion:input;
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const out={target:value.target??'own',bounceHeight:value.bounceHeight??0.2,bounceHz:value.bounceHz??1,spinRps:value.spinRps??0.5,flipX:value.flipX??false,flipY:value.flipY??false};
    if(!['own','allies'].includes(out.target)||!Number.isFinite(out.bounceHeight)||out.bounceHeight<0||out.bounceHeight>0.75||!Number.isFinite(out.bounceHz)||out.bounceHz<0.1||out.bounceHz>4||!Number.isFinite(out.spinRps)||out.spinRps< -2||out.spinRps>2||typeof out.flipX!=='boolean'||typeof out.flipY!=='boolean')return null;
    return out.bounceHeight||out.spinRps||out.flipX||out.flipY?out:null;
  }
  function active(){
    const own=state?.me?.playerId,room=state?.room,pub=state?.match?.public;
    return !disposed&&!!motion&&typeof own==='string'&&!!own&&state?.connection?.status==='online'&&!!room?.inMatch&&
      !!pub?.phase&&!['LOBBY','RESULT'].includes(pub.phase)&&pub.modeId!=='versus'&&
      Array.isArray(pub.players)&&pub.players.some(p=>p?.playerId===own)&&
      !(Array.isArray(room.spectators)&&room.spectators.some(p=>p?.playerId===own))&&
      !(Array.isArray(room.seats)&&!room.seats.some(p=>p?.playerId===own));
  }
  function eligible(info,meta={}){
    if(!active()||!info||info.kind!=='op'||info.side!=='ally'||meta.dead)return false;
    const owner=info.ownerId;
    if(typeof owner==='string'&&owner)return motion.target==='allies'||owner===state.me.playerId;
    // Only the own prep-piece path has p:<uid> and no owner; unknown owners elsewhere are not guessed.
    return !!meta.prep&&typeof info.id==='string'&&info.id.startsWith('p:');
  }
  function restoreBody(record){
    try{if(record.body&&!record.body.destroyed){record.body.y=record.y;record.body.rotation=record.rotation;if(record.scale){record.scale.x=record.scaleX;record.scale.y=record.scaleY;}}}catch{}
  }
  function cancelElement(record){
    for(const animation of record.animations||[])try{animation.cancel();}catch{}
    record.animations=[];record.signature='';
    try{record.element.style.transformOrigin=record.transformOrigin;record.element.style.scale=record.originalScale;}catch{}
  }
  function scaleOf(value){
    if(typeof value!=='string'||!value.trim()||value.trim()==='none')return [1,1,null];
    const parts=value.trim().split(/\s+/),number=v=>typeof v==='string'&&v.endsWith('%')?Number(v.slice(0,-1))/100:Number(v);
    const numbers=parts.map(number);if(parts.length>3||numbers.some(v=>!Number.isFinite(v)))return [1,1,null];
    return [numbers[0],numbers[1]??numbers[0],numbers[2]??null];
  }
  function updateElement(record){
    if(!eligible(record.info,record.meta)){cancelElement(record);return;}
    const signature=JSON.stringify([motion,record.tile]);if(record.signature===signature)return;
    cancelElement(record);record.signature=signature;
    const element=record.element,now=globalThis.performance?.now?.()??Date.now();
    element.style.transformOrigin='50% 100%';
    if(motion.flipX||motion.flipY){const base=record.scale;element.style.scale=(base[0]*(motion.flipX?-1:1))+' '+(base[1]*(motion.flipY?-1:1))+(base[2]===null?'':' '+base[2]);}
    const add=(frames,duration)=>{
      try{const animation=element.animate(frames,{duration,iterations:Infinity,easing:'linear'});animation.currentTime=now%duration;record.animations.push(animation);}catch{}
    };
    if(motion.bounceHeight>0){
      const height=motion.bounceHeight*record.tile;
      add([{translate:'0px 0px',offset:0,easing:'ease-in-out'},{translate:'0px '+(-height)+'px',offset:0.5,easing:'ease-in-out'},{translate:'0px 0px',offset:1}],1000/motion.bounceHz);
    }
    if(motion.spinRps!==0)add([{rotate:'0rad'},{rotate:(motion.spinRps>0?1:-1)*Math.PI*2+'rad'}],1000/Math.abs(motion.spinRps));
    status.applied2d++;
  }
  function restoreAll(){for(const record of bodies.values())restoreBody(record);for(const record of elements.values())cancelElement(record);}
  function onState(next){state=next;if(!active())restoreAll();else for(const record of elements.values())updateElement(record);}
  function bind(){
    if(disposed)return;
    const candidate=globalThis.__SP__?.store;
    if(!candidate?.get||!candidate?.subscribe){bindTimer=setTimeout(bind,300);return;}
    store=candidate;status.bound=true;onState(store.get());unsubscribe=store.subscribe(onState);
  }
  const api={status,
    configure(next={}){motion=readMotion(next);restoreAll();if(active())for(const record of elements.values())updateElement(record);},
    step3d(view,_dt,_cam,time){
      if(disposed||!view?.body)return;
      let record=bodies.get(view);
      if(record&&record.body!==view.body){restoreBody(record);bodies.delete(view);record=null;}
      if(!eligible(view.info,{prep:view.prep,dead:view.alive===false||!!view.down})||view.destroyed){if(record)restoreBody(record);return;}
      if(!Number.isFinite(time)||!Number.isFinite(view.screen?.s)||view.screen.s<=0)return;
      if(!record){const scale=view.body.scale;record={body:view.body,y:Number(view.body.y)||0,rotation:Number(view.body.rotation)||0,scale:scale&&Number.isFinite(scale.x)&&Number.isFinite(scale.y)?scale:null,scaleX:scale?.x,scaleY:scale?.y};bodies.set(view,record);status.views=bodies.size;}
      const phase=((time*motion.bounceHz)%1+1)%1;
      record.body.y=record.y-motion.bounceHeight*view.screen.s*(0.5-0.5*Math.cos(phase*Math.PI*2));
      record.body.rotation=record.rotation+((time*motion.spinRps)%1)*Math.PI*2;
      if(record.scale){record.scale.x=record.scaleX*(motion.flipX?-1:1);record.scale.y=record.scaleY*(motion.flipY?-1:1);}
      status.applied3d++;
    },
    drop3d(view){const record=bodies.get(view);if(record)restoreBody(record);bodies.delete(view);status.views=bodies.size;},
    ref(info,tile,meta={}){
      if(disposed||info?.kind!=='op'||info.side!=='ally')return undefined;
      const id=String(meta.fieldId||'prep')+':'+String(info?.ownerId||'')+':'+String(info?.id||'')+':'+String(meta.area||'');
      let record=refs.get(id);
      if(!record){
        record={info,tile,meta,element:null,animations:[],signature:'',transformOrigin:'',originalScale:'',scale:[1,1,null]};
        record.callback=element=>{
          if(disposed&&element)return;
          if(record.element===element)return;
          if(record.element){cancelElement(record);elements.delete(record.element);}
          record.element=element;
          if(!element){refs.delete(id);status.elements=elements.size;return;}
          record.transformOrigin=element.style?.transformOrigin||'';record.originalScale=element.style?.scale||'';
          let baseline=record.originalScale;try{baseline=globalThis.getComputedStyle?.(element)?.scale||baseline;}catch{}
          record.scale=scaleOf(baseline);elements.set(element,record);status.elements=elements.size;updateElement(record);
        };
        refs.set(id,record);
      }
      record.info=info;record.tile=Number.isFinite(tile)&&tile>0?tile:1;record.meta=meta;
      if(record.element)updateElement(record);
      return record.callback;
    },
    dropDomView(root){for(const [element,record]of elements)if(root===element||root?.contains?.(element)){cancelElement(record);elements.delete(element);record.element=null;for(const [key,value]of refs)if(value===record)refs.delete(key);}status.elements=elements.size;},
    dispose(){if(disposed)return;restoreAll();disposed=true;clearTimeout(bindTimer);unsubscribe?.();bodies.clear();elements.clear();refs.clear();status.views=0;status.elements=0;globalThis.removeEventListener?.('pagehide',api.dispose);if(globalThis.__SPDesktopUnitMotion===api)delete globalThis.__SPDesktopUnitMotion;},
  };
  globalThis.__SPDesktopUnitMotion=api;api.configure(config);globalThis.addEventListener?.('pagehide',api.dispose,{once:true});bind();return api;
}
const motionBootstrap=config=>'('+installUnitMotion.toString()+')('+JSON.stringify(config)+');';
if(typeof module==='object'&&module.exports)module.exports={installUnitMotion,motionBootstrap};
else Object.defineProperty(globalThis,'SPDesktopMotionFactory',{value:installUnitMotion});
