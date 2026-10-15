'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {unzip}=require('./mods.cjs');
const {digest}=require('./resources.cjs');
const HASH=/^[a-f0-9]{64}$/;
const TYPES=/\.(png|jpg|jpeg|webp|gif|avif|svg|mp3|ogg|wav|m4a|aac|opus|flac|woff|woff2|ttf|otf|skel|atlas|obj|json|bin|css)$/i;
class PatchManager{
 constructor(root){this.root=path.resolve(root);this.entries=new Map();this.userEntries=new Map();this.bundled=null}
 async initialize(){await fs.mkdir(this.root,{recursive:true});try{const m=JSON.parse(await fs.readFile(path.join(this.root,'index.json'),'utf8'));if(m.version===1&&Array.isArray(m.entries)&&m.entries.length<30000)for(const item of m.entries)if(HASH.test(item.hash)&&Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=33554432){const value={hash:item.hash,bytes:item.bytes,core:item.core===true};this.entries.set(item.hash,value);this.userEntries.set(item.hash,value)}}catch{}return this}
 async addBundledPack(directory){
  try{await fs.access(path.join(directory,'bundle-info.json'))}catch(error){if(error.code==='ENOENT')return this;throw error}
  const {ResourceLibrary}=require('./resources.cjs');
  const bundled=await new ResourceLibrary({directory,origin:'https://weishuxieyiwangye.cn:8443',remote:async()=>{throw Error('Bundled patch must remain local')}}).initialize();
  await this.bundled?.close();this.bundled=bundled;
  for(const [hash,item]of Object.entries(bundled.index.entries))if(!this.entries.has(hash))this.entries.set(hash,{hash,bytes:item.bytes,core:item.core===true});
  return this;
 }
 async importArchive(bytes){
  const zip=unzip(bytes),names=[...zip.keys()].filter(p=>p==='sp-resource-patch.json'||/^[^/]+\/sp-resource-patch.json$/.test(p));if(names.length!==1)throw Error('增量包缺少唯一的 sp-resource-patch.json');
  const name=names[0],base=name.slice(0,-'sp-resource-patch.json'.length),raw=zip.get(name);if(raw.length>1048576)throw Error('增量包清单过大');
  const m=JSON.parse(raw.toString('utf8'));if(m.format!==1||m.server!=='8443'||!Array.isArray(m.files)||!m.files.length||m.files.length>5000)throw Error('资源增量包格式无效');
  const pending=[];
  for(const item of m.files){
   if(!HASH.test(item.hash)||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>33554432||typeof item.path!=='string'||!TYPES.test(item.path)||item.path.startsWith('/')||item.path.includes('\\')||item.path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('资源增量包文件无效');
   const body=zip.get(base+item.path);if(!body||body.length!==item.bytes||digest(body)!==item.hash)throw Error('资源增量包校验失败');pending.push({item,body});
  }
  let added=0;for(const {item,body}of pending){if(this.entries.has(item.hash))continue;await fs.writeFile(path.join(this.root,item.hash+'.bin'),body);const value={hash:item.hash,bytes:item.bytes,core:! /\.(mp3|ogg|wav|m4a|aac|opus|flac)$/i.test(item.path)};this.entries.set(item.hash,value);this.userEntries.set(item.hash,value);added++}
  const dest=path.join(this.root,'index.json');await fs.writeFile(dest+'.tmp',JSON.stringify({version:1,entries:[...this.userEntries.values()]}));await fs.rename(dest+'.tmp',dest);return {added,total:this.entries.size};
 }
 async get(hash,size){const item=this.entries.get(hash);if(!item||item.bytes!==size)return null;
  if(this.userEntries.has(hash)){try{const bytes=await fs.readFile(path.join(this.root,hash+'.bin'));if(bytes.length===size&&digest(bytes)===hash)return bytes}catch{}}
  const bundled=this.bundled?.index.entries[hash];if(!bundled||bundled.bytes!==size)return null;
  try{const bytes=await this.bundled.read(bundled);return bytes.length===size&&digest(bytes)===hash?bytes:null}catch{return null}
 }
 async close(){await this.bundled?.close()}
}
module.exports={PatchManager};
