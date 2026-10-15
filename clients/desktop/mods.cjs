'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {inflateRawSync}=require('node:zlib');
const {randomUUID}=require('node:crypto');
const {canonical,digest}=require('./resources.cjs');
const TYPES=/\.(png|jpg|jpeg|webp|gif|avif|mp3|ogg|wav|m4a|aac|opus|flac|woff|woff2|ttf|otf|skel|atlas)$/i;
const UUID=/^[a-f0-9-]{36}$/;
const kind=p=>/\.(png|jpe?g|webp|gif|avif)$/i.test(p)?'image':/\.(mp3|ogg|wav|m4a|aac|opus|flac)$/i.test(p)?'audio':/\.(woff2?|ttf|otf)$/i.test(p)?'font':p.split('.').pop().toLowerCase();
const ID=/^[-a-z0-9_]{1,48}$/;
const validId=value=>typeof value==='string'&&ID.test(value);
const AUDIO=/\.(mp3|ogg|wav|m4a|aac|opus|flac)$/i;
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const safeAudioPath=value=>typeof value==='string'&&AUDIO.test(value)&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes(':')&&!value.includes('\0')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
const audioSettings=value=>safeAudioPath(value.path)&&Number.isFinite(value.volume)&&value.volume>=0&&value.volume<=1&&Number.isFinite(value.startSeconds)&&value.startSeconds>=0&&value.startSeconds<=3600;
const storedAudio=value=>typeof value.hash==='string'&&/^([a-f0-9]{64})$/.test(value.hash)&&Number.isSafeInteger(value.bytes)&&value.bytes>=1&&value.bytes<=33554432;
const FORMAT4_FIELDS=new Set(['format','id','name','version','server','description','files','variants','events','sessionMusic','motion']);
const SESSION_FIELDS=new Set(['path','volume','startSeconds']);
const STORED_SESSION_FIELDS=new Set([...SESSION_FIELDS,'hash','bytes']);
const MOTION_FIELDS=new Set(['target','bounceHeight','bounceHz','spinRps','flipX','flipY']);
const validSession=value=>isObject(value)&&Object.keys(value).every(k=>STORED_SESSION_FIELDS.has(k))&&audioSettings(value);
const validMotion=value=>isObject(value)&&Object.keys(value).every(k=>MOTION_FIELDS.has(k))&&['own','allies'].includes(value.target)&&Number.isFinite(value.bounceHeight)&&value.bounceHeight>=0&&value.bounceHeight<=0.75&&Number.isFinite(value.bounceHz)&&value.bounceHz>=0.1&&value.bounceHz<=4&&Number.isFinite(value.spinRps)&&value.spinRps>=-2&&value.spinRps<=2&&(value.flipX===undefined||typeof value.flipX==='boolean')&&(value.flipY===undefined||typeof value.flipY==='boolean')&&(value.bounceHeight>0||value.spinRps!==0||value.flipX===true||value.flipY===true);
const EVENTS=new Set(['match-start','round-start','combat-start','boss-start','unite-start','prep-start','round-end','round-win','round-loss','match-win','match-loss','match-end','low-lp','self-zero-lp','teammate-zero-lp','core-alliance-6-combat-start','core-alliance-9-combat-start','siracusa-true-damage','kjerag-operator-freeze','kjerag-alliance-freeze']);
const MAX_EVENTS=32;
const EVENT_FIELDS=new Set(['event','path','volume','startSeconds','includeBots','includeSelf','threshold']);
const STORED_EVENT_FIELDS=new Set([...EVENT_FIELDS,'hash','bytes']);
const validEvent=e=>isObject(e)&&Object.keys(e).every(k=>STORED_EVENT_FIELDS.has(k))&&EVENTS.has(e.event)&&(e.event==='low-lp'?(e.threshold===undefined||Number.isInteger(e.threshold)&&e.threshold>=1&&e.threshold<=999):!Object.hasOwn(e,'threshold'))&&audioSettings(e)&&typeof e.includeBots==='boolean'&&(e.includeSelf===undefined||typeof e.includeSelf==='boolean');
function groups(manifest){return [...new Set((manifest.variants||[]).map(v=>v.group))];}
function selections(manifest,saved={}){return Object.fromEntries(groups(manifest).map(group=>{const choices=manifest.variants.filter(v=>v.group===group);const value=saved[group];return [group,value===null?null:choices.some(v=>v.id===value)?value:(choices.find(v=>v.default)?.id||choices[0].id)];}));}
function effectiveFiles(record){return [...record.manifest.files,...(record.manifest.variants||[]).filter(v=>record.selections?.[v.group]===v.id).flatMap(v=>v.files)];}
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0}
function unzip(bytes){
 if(bytes.length>268435456)throw Error('外观包 ZIP 不能超过256 MB');
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break}
 if(end<0)throw Error('无法识别 ZIP，请使用普通 ZIP 格式');
 const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count!==bytes.readUInt16LE(end+8)||count>5000||count===65535||start+size!==end)throw Error('不支持分卷、ZIP64或过大的外观包');
 const entries=new Map(),seen=new Set();let at=start,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('ZIP 目录损坏');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),expectedCRC=bytes.readUInt32LE(at+16),packed=bytes.readUInt32LE(at+20),length=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42),attrs=bytes.readUInt32LE(at+38);
  if(at+46+nameLength+extra+comment>end)throw Error('ZIP 文件名损坏');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at+46,at+46+nameLength));at+=46+nameLength+extra+comment;
  if(name.includes('\\')||name.startsWith('/')||name.includes(':')||name.includes('\0')||name.split('/').some(p=>p==='..'||p==='.')||(attrs>>>16&0xf000)===0xa000)throw Error('外观包包含不安全路径');
  if(name.endsWith('/'))continue;
  if(seen.has(name.toLowerCase())||!name||flags&1||![0,8].includes(method)||length>33554432||(total+=length)>268435456)throw Error('外观包文件重复、加密或过大');seen.add(name.toLowerCase());
  if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50)throw Error('ZIP 文件头损坏');
  const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),data=local+30+localName+localExtra;
  if(data+packed>start)throw Error('ZIP 数据损坏');
  const compressed=bytes.subarray(data,data+packed),body=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:Math.max(1,length)});
  if(body.length!==length||crc(body)!==expectedCRC)throw Error('ZIP 素材校验失败');entries.set(name,body);
 }
 if(at!==end)throw Error('ZIP 目录长度不符');return entries;
}
function parseMod(bytes){
 const files=unzip(bytes),manifests=[...files.keys()].filter(p=>p==='mod.json'||/^[^/]+\/mod.json$/.test(p));
 if(manifests.length!==1)throw Error('外观包需要唯一的 mod.json 清单');
 const name=manifests[0],prefix=name.slice(0,-'mod.json'.length),raw=files.get(name);if(raw.length>1048576)throw Error('Mod 清单过大');
 const m=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
 if(!isObject(m)||![1,2,3,4].includes(m.format)||!validId(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>64||typeof m.version!=='string'||!m.version||m.version.length>32||m.server!=='8443'||(m.files!==undefined&&!Array.isArray(m.files))||(m.format===1&&(!m.files?.length||m.variants!==undefined))||(m.variants!==undefined&&!Array.isArray(m.variants))||(m.variants?.length||0)>100||(m.events!==undefined&&(![3,4].includes(m.format)||!Array.isArray(m.events)||m.events.length>MAX_EVENTS))||(m.format!==4&&(m.sessionMusic!==undefined||m.motion!==undefined))||(m.format===4&&(!Object.keys(m).every(k=>FORMAT4_FIELDS.has(k))||(m.description!==undefined&&typeof m.description!=='string'))))throw Error('Mod 清单格式无效，本版支持8443服本地外观、音效与受控音乐事件包');
 const payload=new Map();let count=0;
 function readItems(list){
 if(!Array.isArray(list))throw Error('Mod素材列表无效');const targets=new Set(),items=[];
 for(const item of list){
  if(++count>2000||!item||typeof item!=='object')throw Error('每包最多2000个素材项');
  if(typeof item.target!=='string'||!/^\/(assets|fonts)\//.test(item.target)||canonical(item.target)!==item.target||!TYPES.test(item.target)||!/^([a-f0-9]{64})$/.test(item.originalSha256)||typeof item.path!=='string'||!TYPES.test(item.path)||item.path.startsWith('/')||item.path.includes('\\')||item.path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Mod 仅能替换图片、音频、字体或角色外观素材');
  if(kind(item.target)!==kind(item.path))throw Error('替换素材类型与目标不符');
  const key=item.target.toLowerCase();if(targets.has(key))throw Error('Mod 的目标素材重复');targets.add(key);
  const body=files.get(prefix+item.path);if(!body?.length||body.length>33554432)throw Error('Mod 素材缺失或过大：'+item.path);
  const hash=digest(body);payload.set(hash,body);items.push({target:item.target,originalSha256:item.originalSha256,hash,bytes:body.length,path:item.path});
 }
 return items;
 }
 const items=readItems(m.files||[]),variants=[],ids=new Set(),groupInfo=new Map(),targetGroups=new Map();
 for(const v of m.variants||[]){
  if(!v||!validId(v.id)||ids.has(v.id)||!validId(v.group)||typeof v.name!=='string'||!v.name.trim()||v.name.length>64||typeof v.groupName!=='string'||!v.groupName.trim()||v.groupName.length>64||!['appearance','audio'].includes(v.category)||!Array.isArray(v.files)||!v.files.length||(v.default!==undefined&&typeof v.default!=='boolean'))throw Error('外观／音效候选清单无效');
  ids.add(v.id);const info=groupInfo.get(v.group);if(info&&(info.name!==v.groupName||info.category!==v.category||info.default&&v.default))throw Error('同组候选的名称、类别或默认项冲突');
  groupInfo.set(v.group,{name:v.groupName,category:v.category,default:!!v.default||!!info?.default});
  const entries=readItems(v.files);
  for(const item of entries){if((kind(item.path)==='audio')!==(v.category==='audio'))throw Error('音效组只能包含音频，外观组不能包含音频');const key=item.target.toLowerCase(),previous=targetGroups.get(key);if(previous&&previous!==v.group)throw Error('同一目标不能同时属于多个候选组');targetGroups.set(key,v.group);}
  variants.push({id:v.id,name:v.name.trim(),group:v.group,groupName:v.groupName.trim(),category:v.category,default:v.default===true,files:entries});
 }
 const events=[],eventNames=new Set();
 for(const raw of m.events||[]){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.keys(raw).every(k=>EVENT_FIELDS.has(k))||raw.event!=='low-lp'&&Object.hasOwn(raw,'threshold'))throw Error('音乐事件包含不支持的字段');
  const e={event:raw.event,path:raw.path,volume:raw.volume===undefined?0.8:raw.volume,startSeconds:raw.startSeconds===undefined?0:raw.startSeconds,includeBots:raw.includeBots===undefined?true:raw.includeBots,includeSelf:raw.includeSelf===undefined?false:raw.includeSelf,...(raw.event==='low-lp'?{threshold:raw.threshold===undefined?5:raw.threshold}:{})};
  if(!validEvent(e))throw Error('音乐事件无效；仅支持内置受控触发器和本地音频');
  if(eventNames.has(e.event))throw Error('同一 Mod 不能重复定义音乐事件：'+e.event);eventNames.add(e.event);
  const body=files.get(prefix+e.path);if(!body?.length||body.length>33554432)throw Error('音乐文件缺失或超过32 MiB：'+e.path);
  const hash=digest(body);payload.set(hash,body);events.push({...e,hash,bytes:body.length});
 }
 let sessionMusic,motion;
 if(m.sessionMusic!==undefined){
  const raw=m.sessionMusic;
  if(!isObject(raw)||!Object.keys(raw).every(k=>SESSION_FIELDS.has(k)))throw Error('常驻音乐包含不支持的字段');
  const audio={path:raw.path,volume:raw.volume===undefined?0.8:raw.volume,startSeconds:raw.startSeconds===undefined?0:raw.startSeconds};
  if(!validSession(audio))throw Error('常驻音乐仅支持本地音频与有效音量、开始位置');
  const body=files.get(prefix+audio.path);if(!body?.length||body.length>33554432)throw Error('常驻音乐文件缺失或超过32 MiB：'+audio.path);
  const hash=digest(body);payload.set(hash,body);sessionMusic={...audio,hash,bytes:body.length};
 }
 if(m.motion!==undefined){
  const raw=m.motion;
  if(!isObject(raw)||!Object.keys(raw).every(k=>MOTION_FIELDS.has(k)))throw Error('角色视觉动作包含不支持的字段');
  motion={target:raw.target,bounceHeight:raw.bounceHeight===undefined?0.2:raw.bounceHeight,bounceHz:raw.bounceHz===undefined?1:raw.bounceHz,spinRps:raw.spinRps===undefined?0.5:raw.spinRps,flipX:raw.flipX===undefined?false:raw.flipX,flipY:raw.flipY===undefined?false:raw.flipY};
  if(!validMotion(motion))throw Error('角色视觉动作参数无效；只支持本人或队友干员的受限跳动／旋转／翻转');
 }
 if(!count&&!events.length&&!sessionMusic&&!motion)throw Error('Mod没有可用素材或受控效果');
 return {manifest:{format:m.format,id:m.id,name:m.name.trim(),version:m.version,server:'8443',description:String(m.description||'').slice(0,500),files:items,variants,events,...(sessionMusic?{sessionMusic}:{}),...(motion?{motion}:{})},payload};
}
class ModManager{
 constructor(root){this.root=path.resolve(root);this.records=[];this.metrics={hits:0,errors:0};this.configClock=0;}
 async initialize(){await fs.mkdir(this.root,{recursive:true});try{
  const state=JSON.parse(await fs.readFile(path.join(this.root,'registry.json'),'utf8'));
  if(state.version!==1||!Array.isArray(state.mods)||state.mods.length>100)throw Error('Invalid mod registry');
  for(const record of state.mods){if(!UUID.test(record.folder))continue;try{const m=JSON.parse(await fs.readFile(path.join(this.root,record.folder,'mod.json'),'utf8'));if(!isObject(m)||![1,2,3,4].includes(m.format)||m.server!=='8443'||typeof m.name!=='string'||m.name.length>64||!validId(m.id)||typeof m.version!=='string'||m.version.length>32||!Array.isArray(m.files)||m.variants!==undefined&&!Array.isArray(m.variants)||(m.variants?.length||0)>100||(m.events!==undefined&&(!Array.isArray(m.events)||m.events.length>MAX_EVENTS||(![3,4].includes(m.format)&&m.events.length)))||(m.events||[]).some(e=>!validEvent(e)||!storedAudio(e))||new Set((m.events||[]).map(e=>e.event)).size!==(m.events||[]).length||(m.format!==4&&(m.sessionMusic!==undefined||m.motion!==undefined))||(m.format===4&&(!Object.keys(m).every(k=>FORMAT4_FIELDS.has(k))||(m.description!==undefined&&typeof m.description!=='string')))||(m.sessionMusic!==undefined&&(!validSession(m.sessionMusic)||!storedAudio(m.sessionMusic)))||(m.motion!==undefined&&!validMotion(m.motion)))continue;
  if(m.events)m.events=m.events.map(e=>e.event==='low-lp'?{...e,threshold:e.threshold===undefined?5:e.threshold}:e);
  if(m.motion)m.motion={...m.motion,flipX:m.motion.flipX===true,flipY:m.motion.flipY===true};
  const variants=m.variants||[],all=[...m.files,...variants.flatMap(v=>v.files||[])];
  if((m.format===4&&!all.length&&!(m.events||[]).length&&!m.sessionMusic&&!m.motion)||all.length>2000||variants.some(v=>!validId(v.id)||!validId(v.group)||typeof v.name!=='string'||v.name.length>64||typeof v.groupName!=='string'||v.groupName.length>64||!['appearance','audio'].includes(v.category)||!Array.isArray(v.files))||all.some(i=>!/^([a-f0-9]{64})$/.test(i.hash)||!/^([a-f0-9]{64})$/.test(i.originalSha256)||typeof i.target!=='string'||!/^\/(assets|fonts)\//.test(i.target)||canonical(i.target)!==i.target||!TYPES.test(i.target)||typeof i.path!=='string'||!TYPES.test(i.path)||kind(i.target)!==kind(i.path)||!Number.isSafeInteger(i.bytes)||i.bytes<1||i.bytes>33554432))continue;
  const configOrder=Number.isSafeInteger(record.configOrder)&&record.configOrder>=0?record.configOrder:this.configClock+1;this.configClock=Math.max(this.configClock,configOrder);
  this.records.push({folder:record.folder,enabled:record.enabled===true,manifest:m,configOrder,selections:selections(m,record.selections&&typeof record.selections==='object'?record.selections:{})})}catch{}}
 }catch{}return this}
 async save(){const dest=path.join(this.root,'registry.json'),temp=dest+'.tmp';await fs.writeFile(temp,JSON.stringify({version:1,mods:this.records.map(r=>({folder:r.folder,enabled:r.enabled,configOrder:r.configOrder,selections:r.selections||{}}))},null,2));await fs.rename(temp,dest)}
 async install(parsed){
  if(this.records.length>=100&&!this.records.some(r=>r.manifest.id===parsed.manifest.id))throw Error('最多安装100个外观包');
  const folder=randomUUID(),dest=path.join(this.root,folder);await fs.mkdir(dest);
  for(const [hash,bytes]of parsed.payload)await fs.writeFile(path.join(dest,hash+'.bin'),bytes);
  await fs.writeFile(path.join(dest,'mod.json'),JSON.stringify(parsed.manifest,null,2));
  const previous=this.records.find(r=>r.manifest.id===parsed.manifest.id);this.records=this.records.filter(r=>r!==previous);this.records.push({folder,enabled:true,manifest:parsed.manifest,configOrder:++this.configClock,selections:selections(parsed.manifest,previous?.selections)});await this.save();if(previous)await this.deleteFolder(previous.folder);return parsed.manifest;
 }
 async select(id,group,variant){const r=this.records.find(r=>r.manifest.id===id);if(!r||!groups(r.manifest).includes(group)||(variant!==null&&!r.manifest.variants.some(v=>v.group===group&&v.id===variant)))throw Error('外观／音效选项不存在');r.selections={...r.selections,[group]:variant};await this.save();}
 async setEnabled(id,enabled){const r=this.records.find(r=>r.manifest.id===id);if(r){if(enabled===true&&r.enabled!==true)r.configOrder=++this.configClock;r.enabled=enabled;await this.save()}}
 async remove(id){const r=this.records.find(r=>r.manifest.id===id);if(r){this.records=this.records.filter(i=>i!==r);await this.save();await this.deleteFolder(r.folder)}}
 async deleteFolder(folder){if(!UUID.test(folder))throw Error('Invalid Mod folder');const dest=path.resolve(this.root,folder);if(!dest.startsWith(this.root+path.sep)||path.dirname(dest)!==this.root)throw Error('Mod path escaped');await fs.rm(dest,{recursive:true,force:true})}
 async replacement(target,original){
  if(!target)return null;
  for(const record of [...this.records].reverse()){
   if(!record.enabled)continue;
   const item=effectiveFiles(record).reverse().find(i=>i.target.toLowerCase()===target.toLowerCase()&&i.originalSha256===original);if(!item)continue;
   try{const bytes=await fs.readFile(path.join(this.root,record.folder,item.hash+'.bin'));if(bytes.length!==item.bytes||digest(bytes)!==item.hash)throw Error('corrupt mod');this.metrics.hits++;return {bytes,path:item.path}}catch{this.metrics.errors++}
  }return null;
 }
 eventTracks(){
  const tracks=new Map();
  for(const record of [...this.records].reverse())if(record.enabled)for(const e of record.manifest.events||[])if(!tracks.has(e.event))tracks.set(e.event,{...e,includeSelf:e.includeSelf===true,id:record.manifest.id,name:record.manifest.name,url:'/__sp_desktop_mods/audio/'+record.folder+'/'+e.hash+path.extname(e.path).toLowerCase()});
  return [...tracks.values()];
 }
 sessionTrack(){
  const record=this.records.filter(r=>r.enabled&&r.manifest.sessionMusic).sort((a,b)=>(b.configOrder||0)-(a.configOrder||0))[0];
  if(!record)return null;const track=record.manifest.sessionMusic;
  return {...track,id:record.manifest.id,name:record.manifest.name,url:'/__sp_desktop_mods/audio/'+record.folder+'/'+track.hash+path.extname(track.path).toLowerCase()};
 }
 motionConfig(){
  const record=this.records.filter(r=>r.enabled&&r.manifest.motion).sort((a,b)=>(b.configOrder||0)-(a.configOrder||0))[0];
  return record?{...record.manifest.motion,id:record.manifest.id,name:record.manifest.name}:null;
 }
 async eventAsset(url){
  const track=[...this.eventTracks(),this.sessionTrack()].find(e=>e?.url===url);if(!track)return null;
  const record=this.records.find(r=>r.manifest.id===track.id);
  try{const bytes=await fs.readFile(path.join(this.root,record.folder,track.hash+'.bin'));if(bytes.length!==track.bytes||digest(bytes)!==track.hash)throw Error('corrupt event audio');this.metrics.hits++;return {bytes,path:track.path}}catch{this.metrics.errors++;return null;}
 }
}
module.exports={ModManager,parseMod,unzip};
