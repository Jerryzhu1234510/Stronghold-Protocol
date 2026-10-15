// Original support textures + Unity particle timing, projected through the game's camera.
// No request at module import or in the lobby. Load only the deployed operator's equipped skill.
const cache = new Map(), textureCache = new Map();
const LIMIT = { high: 320, medium: 180, low: 72 };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = () => Math.random();
let activeLoads = 0;
const waiters = [];
async function limited(fn) {
  if (activeLoads >= 2) await new Promise(resolve => waiters.push(resolve));
  activeLoads++;
  try { return await fn(); } finally { activeLoads--; waiters.shift()?.(); }
}

export function curveValue(curve, t = 0, random = .5) {
  if (!curve) return 0;
  const sample = keys => {
    if (!keys?.length) return 1;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], d = b[0] - a[0];
      if (d <= 0) return b[1];
      const k = (t - a[0]) / d, k2 = k * k, k3 = k2 * k;
      return (2*k3-3*k2+1)*a[1] + (k3-2*k2+k)*d*a[3] + (-2*k3+3*k2)*b[1] + (k3-k2)*d*b[2];
    }
    return keys.at(-1)[1];
  };
  if (curve.mode === 1) return sample(curve.keys) * curve.max;
  if (curve.mode === 2) return lerp(curve.min, curve.max, random);
  if (curve.mode === 3) return lerp(sample(curve.minKeys)*curve.min, sample(curve.keys)*curve.max, random);
  return curve.max;
}

export function gradientValue(g, t = 0, random = .5) {
  if (!g) return [1,1,1,1];
  const sample = keys => {
    const channel = (list, index, fallback) => {
      if (!list?.length) return fallback;
      if (t <= list[0][0]) return list[0][index];
      for (let i=1; i<list.length; i++) if (t <= list[i][0]) {
        const a=list[i-1], b=list[i]; return lerp(a[index], b[index], (t-a[0]) / Math.max(.00001,b[0]-a[0]));
      }
      return list.at(-1)[index];
    };
    return [channel(keys?.rgb,1,1),channel(keys?.rgb,2,1),channel(keys?.rgb,3,1),channel(keys?.a,1,1)];
  };
  if (g.mode===1 || g.mode===4) return sample(g.keys);
  if (g.mode===2) return g.color.map((n,i)=>lerp(g.minColor[i],n,random));
  if (g.mode===3) { const a=sample(g.minKeys), b=sample(g.keys); return b.map((n,i)=>lerp(a[i],n,random)); }
  return g.color || [1,1,1,1];
}

export function recipeNames(payload, skillIndex) {
  const skill = payload.skills?.[clamp(skillIndex|0,0,2)];
  return [...new Set([...(payload.attack||[]), ...Object.values(skill||{}).flat()])];
}
const keyOf = (url, si) => `${url}#${clamp(si|0,0,2)}`;
async function getEntry(P, url, si) {
  const key = keyOf(url,si);
  let entry = cache.get(key);
  if (!entry) {
    entry = { key, refs:0, used:Date.now(), urls:[], ready:null };
    entry.promise = limited(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Original effect manifest: ${response.status}`);
      const payload = await response.json();
      const ids = new Set(recipeNames(payload,si).flatMap(n=>payload.recipes[n]?.emitters.map(e=>e.texture)||[]));
      const loaded = new Map();
      for (const id of ids) {
        const textureUrl = payload.textures[id];
        if (!textureUrl?.startsWith('/assets/support-fx/')) throw new Error('Invalid effect texture path');
        let item = textureCache.get(textureUrl);
        if (!item) {
          item = { refs:0, texture:null };
          item.promise = P.Assets.load(textureUrl).then(texture => (item.texture=texture));
          textureCache.set(textureUrl,item);
        }
        item.refs++; entry.urls.push(textureUrl);
        loaded.set(id,await item.promise);
      }
      entry.ready = { payload, textures:loaded, frames:new Map() };
      return entry.ready;
    }).catch(error => { cache.delete(key); releaseTextures(P,entry); throw error; });
    cache.set(key,entry);
  }
  clearTimeout(entry.timer); entry.refs++; entry.used=Date.now();
  return entry;
}
function releaseTextures(P,entry) {
  for (const url of entry.urls.splice(0)) {
    const item=textureCache.get(url);
    if (item && --item.refs<=0) { textureCache.delete(url); P.Assets.unload(url).catch(()=>{}); }
  }
  for (const frames of entry.ready?.frames.values()||[]) frames.forEach(t=>t.destroy(false));
}
function releaseEntry(P, entry) {
  entry.refs=Math.max(0,entry.refs-1);
  if (!entry.refs) entry.timer=setTimeout(async()=>{
    try { await entry.promise; } catch { return; }
    if (entry.refs || cache.get(entry.key)!==entry) return;
    cache.delete(entry.key); releaseTextures(P,entry);
  },30000);
  entry.timer?.unref?.();
}

export class OriginalSupportEffects {
  constructor(ctx) {
    this.ctx=ctx; this.P=ctx.P; this.entries=new Map(); this.pending=new Map();
    this.effects=[]; this.particles=[]; this.pool=[]; this.active=new Set(); this.lastHit=new Map();
    this.perUnit=new Map();
    this.layer=new this.P.Container(); ctx.layers.fxAdd.addChild(this.layer);
    this.destroyed=false; this.clock=0;
  }
  get limit() { return Math.floor((LIMIT[this.ctx.settings?.quality]||LIMIT.high)*[1,.75,.5,.35][Math.min(3,this.ctx.loadLevel?.()|0)]); }
  _url(view) { return this.ctx.assets?.manifest?.supportFx?.[view?.info?.spine]?.url; }
  prepare(view) {
    const url=this._url(view), si=view?.info?.skillIndex|0;
    if (!url || this.destroyed) return Promise.resolve(false);
    const key=keyOf(url,si);
    if (this.pending.has(key)) return this.pending.get(key);
    const promise=getEntry(this.P,url,si).then(async entry=>{
      if (this.destroyed) { releaseEntry(this.P,entry); return false; }
      this.entries.set(key,entry);
      await entry.promise;
      return !this.destroyed;
    }).catch(()=>{ this.pending.delete(key); return false; });
    this.pending.set(key,promise); return promise;
  }
  _ready(view) { return this.entries.get(keyOf(this._url(view),view?.info?.skillIndex|0))?.ready; }
  _play(view, mode, target = view) {
    const ready=this._ready(view);
    if (!ready || this.destroyed) return false;
    const names=mode==='attack' ? ready.payload.attack : ready.payload.skills[view.info.skillIndex|0]?.[mode];
    const recipes=(names||[]).map(n=>ready.payload.recipes[n]).filter(r=>r?.emitters.length);
    if (!recipes.length) return false;
    if (this.effects.length>=48) this._end(this.effects.shift());
    for (const recipe of recipes) {
      // Only a visual clock, never simulation state. A bounded subset protects phones under heavy battle load.
      const emitters=recipe.emitters.slice(0,this.ctx.settings?.quality==='low'?12:32).map(def=>({def,time:0,rate:0,bursts:new Set(),seed:rand()}));
      this.effects.push({ready,view,target,mode,time:0,emitters,anchor:{x:target.x,y:target.y,z:target.z||0}});
    }
    return true;
  }
  skill(view,on) {
    if (!on) {
      this.active.delete(view.id);
      for (const effect of this.effects) if (effect.view.id===view.id && effect.mode==='buff') effect.ending=true;
      return false;
    }
    this.active.add(view.id);
    const played=this._play(view,'start'); this._play(view,'buff');
    return played;
  }
  hit(view,target) {
    if (!view || !target || !this._ready(view) || this.clock-(this.lastHit.get(view.id)??-1)<.12) return false;
    this.lastHit.set(view.id,this.clock);
    return this._play(view,this.active.has(view.id)?'hit':'attack',target);
  }
  _frame(effect,def,k) {
    const base=effect.ready.textures.get(def.texture);
    if (!def.sheet) return base;
    const {x,y}=def.sheet, key=`${def.texture}:${x}:${y}`;
    let frames=effect.ready.frames.get(key);
    if (!frames) {
      const w=base.width/x,h=base.height/y;
      frames=Array.from({length:x*y},(_,i)=>new this.P.Texture(base.baseTexture,new this.P.Rectangle((i%x)*w,Math.floor(i/x)*h,w,h)));
      effect.ready.frames.set(key,frames);
    }
    const frame=curveValue(def.sheet.curve,k,.5)*def.sheet.cycles;
    return frames[clamp(Math.floor((frame%1)*frames.length),0,frames.length-1)];
  }
  _spawn(effect,emitter,count) {
    const d=emitter.def;
    for (let i=0;i<Math.min(24,count);i++) {
      if (this.particles.length>=this.limit) return;
      const owner=effect.view.id, ownerCap=Math.max(8,Math.ceil(this.limit/Math.max(4,this.active.size)));
      if ((this.perUnit.get(owner)||0)>=ownerCap) return;
      const seed=rand(), sp=this.pool.pop()||new this.P.Sprite();
      if (!sp.parent) this.layer.addChild(sp);
      sp.anchor.set(.5); sp.visible=true; sp.blendMode=d.add?this.P.BLEND_MODES.ADD:this.P.BLEND_MODES.NORMAL;
      const shape=d.shape, angle=rand()*Math.PI*2, radius=Math.sqrt(rand())*(shape.enabled?shape.radius:0);
      const dx=radius*Math.cos(angle), dz=radius*Math.sin(angle);
      const speed=curveValue(d.speed,0,seed), velocity=d.velocity?.map(c=>curveValue(c,0,seed))||[0,0,0];
      const life=clamp(curveValue(d.life,0,seed),.06,8)/Math.max(.1,d.simulationSpeed);
      const size=clamp(curveValue(d.size,0,seed),.015,8);
      const p={sp,effect,d,owner,seed,time:0,life,size,sizeY:d.sizeY?clamp(curveValue(d.sizeY,0,seed),.015,8):size,
        x:dx+d.position[0],y:d.position[1],z:dz+d.position[2],
        vx:velocity[0]+Math.cos(angle)*speed*.4,vy:velocity[1]+(shape.type===4?speed:0),vz:velocity[2]+Math.sin(angle)*speed*.4,
        rotation:curveValue(d.startRotation,0,seed)+d.rotation,color:gradientValue(d.startColor,0,seed)};
      sp.texture=this._frame(effect,d,0); this.particles.push(p); this.perUnit.set(owner,(this.perUnit.get(owner)||0)+1);
    }
  }
  _free(p) { p.sp.visible=false; p.sp.alpha=0; this.pool.push(p.sp); this.perUnit.set(p.owner,Math.max(0,(this.perUnit.get(p.owner)||0)-1)); }
  _end(effect) { effect.ending=true; }
  update(dt) {
    this.clock+=dt;
    const rate=Math.max(.25,Number(this.ctx.timeScale?.())||1), gameDt=Math.min(.1,dt*rate);
    for (const effect of this.effects) {
      effect.time+=gameDt;
      const following=effect.mode==='buff' || effect.mode==='start';
      if (effect.view.destroyed || effect.view.alive===false) effect.ending=true;
      if (following && !effect.view.destroyed) effect.anchor={x:effect.view.x,y:effect.view.y,z:effect.view.z||0};
      for (const emitter of effect.emitters) {
        const d=emitter.def; emitter.time+=gameDt*Math.max(.1,d.simulationSpeed);
        const t=emitter.time-curveValue(d.delay,0,emitter.seed), duration=Math.max(.05,d.duration);
        if (t<0 || effect.ending) continue;
        const repeat=effect.mode==='buff' && d.loop, phase=repeat?(t%duration):t;
        if (!repeat && (phase>duration || effect.time>3)) continue;
        emitter.rate+=Math.max(0,curveValue(d.rate,phase/duration,emitter.seed))*gameDt*Math.max(.1,d.simulationSpeed);
        const n=Math.min(6,Math.floor(emitter.rate)); emitter.rate-=n;
        if (n) this._spawn(effect,emitter,n);
        d.bursts.forEach((burst,index)=>{
          const cycles=Math.min(8,burst.cycles||1);
          for(let cycle=0;cycle<cycles;cycle++) {
            const key=`${repeat?Math.floor(t/duration):0}:${index}:${cycle}`, time=burst.time+cycle*burst.interval;
            if (phase>=time && !emitter.bursts.has(key)) { emitter.bursts.add(key); this._spawn(effect,emitter,Math.ceil(curveValue(burst.count,0,emitter.seed))); }
          }
        });
      }
      if (effect.mode!=='buff' && effect.time>5) effect.ending=true;
    }
    const cam=this.ctx.cam();
    let w=0;
    for (const p of this.particles) {
      p.time+=gameDt;
      if (p.time>=p.life || p.effect.ending && p.effect.mode==='buff') { this._free(p); continue; }
      const k=p.time/p.life,d=p.d,face=p.effect.view.facing<0?-1:1;
      const particleDt=gameDt*Math.max(.1,d.simulationSpeed);
      p.vy-=curveValue(d.gravity,k,p.seed)*9.81*particleDt;
      p.x+=p.vx*particleDt; p.y+=p.vy*particleDt; p.z+=p.vz*particleDt;
      const anchor=p.effect.anchor, projected=cam.project(anchor.x+p.x*face,anchor.y+p.z,anchor.z+p.y);
      p.sp.position.set(projected.x,projected.y);
      p.sp.texture=this._frame(p.effect,d,k);
      const scale=d.sizeOverLife?Math.max(0,curveValue(d.sizeOverLife,k,p.seed)):1;
      // Unity mesh/material scales may cover the whole board; flat projections must stay readable.
      const sx=clamp(p.size*scale*Math.abs(d.scale[0]),0,3.2)*projected.s/p.sp.texture.width;
      const sy=clamp(p.sizeY*scale*Math.abs(d.scale[1]),0,3.2)*projected.s/p.sp.texture.height*(d.ground?.45:1);
      p.sp.scale.set(face*sx,sy);
      if (d.rotationOverLife) p.rotation+=curveValue(d.rotationOverLife,k,p.seed)*gameDt;
      p.sp.rotation=p.rotation;
      const c=gradientValue(d.colorOverLife,k,p.seed), rgb=c.slice(0,3).map((n,i)=>clamp(n*p.color[i]*d.materialColor[i],0,1));
      p.sp.tint=(Math.round(rgb[0]*255)<<16)|(Math.round(rgb[1]*255)<<8)|Math.round(rgb[2]*255);
      p.sp.alpha=clamp(c[3]*p.color[3]*d.materialColor[3]*d.opacity,0,1)*Math.min(1,(1-k)*8)*.65;
      this.particles[w++]=p;
    }
    this.particles.length=w;
    this.effects=this.effects.filter(effect=>!effect.ending || this.particles.some(p=>p.effect===effect));
  }
  clear() {
    this.particles.forEach(p=>this._free(p)); this.particles.length=0; this.effects.length=0;
    this.active.clear(); this.lastHit.clear(); this.perUnit.clear();
  }
  destroy() {
    this.destroyed=true; this.clear(); this.layer.destroy({children:true}); this.pool.length=0;
    for (const entry of this.entries.values()) releaseEntry(this.P,entry);
    this.entries.clear();
  }
  get counts() { return { particles:this.particles.length,effects:this.effects.length,loaded:this.entries.size }; }
}
