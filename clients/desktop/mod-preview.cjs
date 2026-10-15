'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {digest,mime}=require('./resources.cjs');

const EVENT_LABELS=Object.freeze({
  'match-start':'开始对局','round-start':'回合开始','combat-start':'战斗开始','boss-start':'Boss 战开始',
  'unite-start':'联防开始','prep-start':'休整开始','round-end':'回合结束','round-win':'回合胜利',
  'round-loss':'回合失利','match-win':'整局胜利','match-loss':'整局失败','match-end':'对局结束',
  'low-lp':'低生命值','self-zero-lp':'自己生命归零','teammate-zero-lp':'队友生命归零',
  'core-alliance-6-combat-start':'同核心盟约 6 人开战','core-alliance-9-combat-start':'同核心盟约 9 人开战',
  'siracusa-true-damage':'叙拉古真实伤害','kjerag-operator-freeze':'谢拉格干员冻结','kjerag-alliance-freeze':'谢拉格盟约冻结'
});
const BUILTINS=Object.freeze([
  {id:'kalts',name:'凯尔希 · 内置立绘',target:'/assets/char/portrait/char_003_kalts_1.png'},
  {id:'chen',name:'陈 · 内置立绘',target:'/assets/char/portrait/char_010_chen_1.png'},
  {id:'huang',name:'煌 · 内置立绘',target:'/assets/char/portrait/char_017_huang_1.png'}
]);
const typeOf=p=>/\.(png|jpe?g|webp|gif|avif)$/i.test(p)?'image':/\.(mp3|ogg|wav|m4a|aac|opus|flac)$/i.test(p)?'audio':'other';

// Read-only preview view of validated ModManager records. Opaque IDs never become paths.
class ModPreviewLibrary{
  constructor({mods,library,baseline}){this.mods=mods;this.library=library;this.baseline=baseline;}
  entries(){
    const found=new Map();
    for(const record of this.mods.records){
      const add=(id,item,extra={})=>found.set(id,{record,item,id,...extra});
      record.manifest.files.forEach((item,i)=>add(record.manifest.id+':file:'+i,item,{selected:true,variant:null}));
      for(const variant of record.manifest.variants||[])variant.files.forEach((item,i)=>add(record.manifest.id+':variant:'+variant.id+':'+i,item,{selected:record.selections?.[variant.group]===variant.id,variant:variant.groupName+' / '+variant.name}));
      for(const event of record.manifest.events||[])add(record.manifest.id+':event:'+event.event,event,{event:event.event});
      if(record.manifest.sessionMusic)add(record.manifest.id+':session',record.manifest.sessionMusic,{session:true});
    }
    return found;
  }
  catalog(){
    const entries=this.entries(),effectiveTracks=new Map(this.mods.eventTracks().map(e=>[e.event,e.id]));
    const session=this.mods.sessionTrack(),motion=this.mods.motionConfig();
    const winningFiles=new Map();
    for(const e of entries.values())if(e.record.enabled&&e.selected&&e.item.target)winningFiles.set(e.item.target.toLowerCase()+':'+e.item.originalSha256,e.id);
    const records=this.mods.records.map(r=>({id:r.manifest.id,name:r.manifest.name,version:r.manifest.version,enabled:r.enabled,description:r.manifest.description,motion:r.manifest.motion||null,
      events:(r.manifest.events||[]).map(e=>({event:e.event,label:EVENT_LABELS[e.event],asset:r.manifest.id+':event:'+e.event,volume:e.volume,startSeconds:e.startSeconds,effective:effectiveTracks.get(e.event)===r.manifest.id})),
      session:r.manifest.sessionMusic?{asset:r.manifest.id+':session',volume:r.manifest.sessionMusic.volume,startSeconds:r.manifest.sessionMusic.startSeconds,effective:session?.id===r.manifest.id}:null,
      files:[...entries.values()].filter(e=>e.record===r&&!e.event&&!e.session).map(e=>({id:e.id,path:e.item.path,target:e.item.target,type:typeOf(e.item.path),variant:e.variant,selected:e.selected,effective:winningFiles.get(e.item.target.toLowerCase()+':'+e.item.originalSha256)===e.id,originalAvailable:!!this.library.index.entries[e.item.originalSha256]||!!this.library.patches?.entries.has(e.item.originalSha256),matchesBaseline:this.baseline.entries[e.item.target]?.hash===e.item.originalSha256}))
    }));
    return {events:EVENT_LABELS,mods:records,motionModId:motion?.id||null,sessionModId:session?.id||null,builtins:BUILTINS.filter(b=>this.baseline.entries[b.target]).map(b=>({id:'builtin:'+b.id,name:b.name}))};
  }
  async original(hash,bytes){
    const item=this.library.index.entries[hash];
    if(item&&(!bytes||item.bytes===bytes))return this.library.verifiedBody(hash,item);
    const patch=this.library.patches?.entries.get(hash);
    if(patch&&(!bytes||patch.bytes===bytes)){const body=await this.library.patches.get(hash,patch.bytes);if(body)return body;}
    throw Error('本地资源库没有这张原图；预览不会从服务器下载。');
  }
  async asset(id,original=false){
    if(typeof id!=='string'||id.length>180||typeof original!=='boolean')throw Error('预览素材参数无效');
    const builtin=BUILTINS.find(b=>'builtin:'+b.id===id);
    if(builtin){const item=this.baseline.entries[builtin.target];if(!item)throw Error('内置预览图片不存在');return {bytes:await this.original(item.hash,item.bytes),mime:mime(builtin.target),name:builtin.name};}
    const entry=this.entries().get(id);if(!entry||!['image','audio'].includes(typeOf(entry.item.path)))throw Error('只能预览已安装包中的图片和音频');
    const {record,item}=entry;
    if(original){if(!item.target||!item.originalSha256)throw Error('该素材没有对应原版');return {bytes:await this.original(item.originalSha256),mime:mime(item.target),name:item.target};}
    if(!/^[a-f0-9-]{36}$/.test(record.folder)||!/^[a-f0-9]{64}$/.test(item.hash))throw Error('预览素材记录无效');
    const dest=path.resolve(this.mods.root,record.folder,item.hash+'.bin');
    if(!dest.startsWith(path.resolve(this.mods.root)+path.sep))throw Error('预览路径越界');
    const bytes=await fs.readFile(dest);
    if(bytes.length!==item.bytes||digest(bytes)!==item.hash)throw Error('Mod 素材校验失败，请重新导入此包');
    return {bytes,mime:mime(item.path),name:item.path};
  }
}
function isPreviewSender(event,win,url){return !!win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url===url;}
module.exports={ModPreviewLibrary,EVENT_LABELS,BUILTINS,isPreviewSender};
