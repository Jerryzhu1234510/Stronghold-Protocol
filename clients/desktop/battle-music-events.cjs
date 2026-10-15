'use strict';

// Trusted client code. Mods supply audio/config only; they cannot install battle hooks.
// The existing render event stream reports a Siracusa proc, not confirmed HP removal.
function createBattleMusicDetector(){
  const phases=new Set(['COMBAT','UNITE','FINAL_ASSAULT','HIDDEN_CORE']);
  let context='',fieldKey='',fieldRef=null,units=new Map(),lastFired=new Map();
  let seen=new Set(),seenOrder=[],wasActive=false,recovering=false;
  function reset(){context='';fieldKey='';fieldRef=null;units=new Map();lastFired=new Map();seen=new Set();seenOrder=[];wasActive=false;recovering=false;}
  function unitOf(value){
    return value&&typeof value==='object'&&Number.isInteger(value.id)&&value.id>0?value:null;
  }
  function remember(key){
    if(seen.has(key))return false;
    seen.add(key);seenOrder.push(key);
    while(seenOrder.length>48)seen.delete(seenOrder.shift());
    return true;
  }
  return {reset,consume(state,batch,nowMs=Date.now()){
    const pub=state?.match?.public,room=state?.room,field=state?.match?.field,own=state?.me?.playerId;
    const mine=Array.isArray(pub?.players)?pub.players.find(p=>p?.playerId===own):null;
    const spectator=Array.isArray(room?.spectators)&&room.spectators.some(p=>p?.playerId===own);
    const seatMissing=Array.isArray(room?.seats)&&!room.seats.some(p=>p?.playerId===own);
    const active=typeof own==='string'&&!!own&&state?.connection?.status==='online'&&!!room?.inMatch&&
      phases.has(pub?.phase)&&pub?.modeId!=='versus'&&!!mine&&mine.alive!==false&&!mine.left&&mine.status!=='left'&&
      !spectator&&!seatMissing&&!!field&&typeof field.fieldId==='string'&&field.live!==false;
    if(!active){
      if(wasActive&&state?.connection?.status!=='online')recovering=true;
      wasActive=false;fieldRef=null;units=new Map();
      return {active:false,events:[]};
    }
    const nextContext=String(room.code||room.id||'')+':'+own;
    if(context!==nextContext){reset();context=nextContext;}
    const nextField=field.fieldId+':'+String(field.battleId||pub.round||'');
    if(fieldKey!==nextField){fieldKey=nextField;fieldRef=null;seen=new Set();seenOrder=[];}
    if(fieldRef!==field){
      fieldRef=field;units=new Map();
      for(const item of Array.isArray(field.units)?field.units:[]){const unit=unitOf(item);if(unit)units.set(unit.id,unit);}
    }
    wasActive=true;
    if(!batch||batch.t!=='b.ev'||batch.fieldId!==field.fieldId||!Array.isArray(batch.ev)||!Number.isFinite(batch.gt))return {active:true,events:[]};
    // A resync may deliver a copied batch object; compare its content too. Dedupe precedes cooldown.
    let signature;
    try{signature=fieldKey+':'+batch.gt+':'+JSON.stringify(batch.ev);}catch{return {active:true,events:[]};}
    if(!remember(signature))return {active:true,events:[]};
    const skip=recovering;recovering=false;
    const events=[];
    for(const tuple of batch.ev){
      if(!Array.isArray(tuple))continue;
      if(tuple[0]==='spawn'){
        const unit=unitOf(tuple[1]);if(unit)units.set(unit.id,unit);
        continue;
      }
      if(skip||tuple[0]!=='fx')continue;
      const extra=tuple[4];
      if(!extra||typeof extra!=='object')continue;
      let event,source;
      if(tuple[1]==='bondProc'){
        if(extra.src!=='bond:siracusaShip'||extra.key!=='assassin'||!Number.isFinite(extra.amount)||extra.amount<=0)continue;
        source=units.get(extra.from);
        if(!source||source.kind!=='op'||source.side!=='ally'||source.ownerId!==own)continue;
        event='siracusa-true-damage';
      }else if(tuple[1]==='desktopFreeze'){
        // Emitted only by the trusted, hash-pinned local status observer. Generic status tuples have no source.
        if(extra.ownerId!==own||!Number.isInteger(extra.id)||extra.id<=0)continue;
        if(extra.sourceKind==='operator'){
          source=units.get(extra.from);
          if(!source||source.kind!=='op'||source.side!=='ally'||source.ownerId!==own)continue;
          event='kjerag-operator-freeze';
        }else if(extra.sourceKind==='alliance')event='kjerag-alliance-freeze';
        else continue;
      }else continue;
      const last=lastFired.get(event);
      if(!Number.isFinite(nowMs)||(last!==undefined&&nowMs-last<2000))continue;
      lastFired.set(event,nowMs);
      events.push({event,playerId:own,sourceId:source?.id??null,targetId:extra.id,fieldId:field.fieldId,battleId:field.battleId||null,isBot:false});
    }
    return {active:true,events};
  }};
}

module.exports={createBattleMusicDetector};
