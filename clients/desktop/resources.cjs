'use strict';
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const HASH=/^[a-f0-9]{64}$/;
const BUILD=/^\/_build\/([A-Za-z0-9_-]{1,80})(\/.*)$/;
const MEDIA=/\.(mp3|ogg|wav|m4a|aac|flac|opus|mp4|webm)$/i;
const digest=b=>createHash('sha256').update(b).digest('hex');
function canonical(value){
  try{const p=decodeURIComponent(value).replace(/^\/(assets|fonts|media)\/~[0-9a-f]{16}(\/)/,'/$1$2');if(p.includes('\\')||p.includes('\0')||p.split('/').some(x=>x==='.'||x==='..'))return null;return p.split('/').map(encodeURIComponent).join('/');}catch{return null}
}
function mime(value){const ext=value.split('.').pop().toLowerCase();return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',avif:'image/avif',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',opus:'audio/opus',flac:'audio/flac',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',atlas:'text/plain; charset=utf-8',obj:'text/plain; charset=utf-8',json:'application/json; charset=utf-8',css:'text/css; charset=utf-8'})[ext]||'application/octet-stream'}
function rangeFor(value,size){
  if(!value)return {start:0,end:size-1,status:200};
  const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))return null;
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start<0||start>=size||(!m[1]&&Number(m[2])<=0))return null;
  return {start,end,status:206};
}
class ResourceLibrary{
  constructor({directory,origin,remote,mods=null,patches=null}){this.directory=directory;this.origin=origin;this.remote=remote;this.mods=mods;this.patches=patches;this.activeBuild='';this.snapshots=new Map();this.pending=new Map();this.verified=new Set();this.verifying=new Map();this.metrics={hits:0,bytes:0,updates:0,corrupt:0,modHits:0,patchHits:0};}
  async initialize(){
    const meta=JSON.parse(await fs.readFile(this.directory+'/bundle-info.json','utf8'));
    const raw=await fs.readFile(this.directory+'/index.json');if(digest(raw)!==meta.indexSha256)throw Error('内置资源索引校验失败');
    this.index=JSON.parse(raw);const size=(await fs.stat(this.directory+'/assets.bin')).size;
    if(this.index.version!==1||size!==this.index.bytes)throw Error('内置资源文件不完整');
    this.core=[];
    for(const [hash,item]of Object.entries(this.index.entries)){
      if(!HASH.test(hash)||!Number.isSafeInteger(item.offset)||!Number.isSafeInteger(item.bytes)||item.offset<0||item.bytes<=0||item.bytes>33554432||item.offset+item.bytes>size)throw Error('内置资源索引无效');
      if(item.core)this.core.push({hash,bytes:item.bytes});
    }
    // Reuses the existing native resource bridge understood by the live web client.
    const native=new Map(this.core.map(i=>[i.hash,i]));for(const item of this.patches?.entries.values()||[])if(item.core)native.set(item.hash,{hash:item.hash,bytes:item.bytes});
    this.file=await fs.open(this.directory+'/assets.bin','r');return this;
  }
  get bridge(){const native=new Map(this.core.map(i=>[i.hash,i]));for(const item of this.patches?.entries.values()||[])if(item.core)native.set(item.hash,{hash:item.hash,bytes:item.bytes});return JSON.stringify({version:1,source:'android-bundled',files:this.index.files,entries:[...native.values()]});}
  setPage(url){try{const u=new URL(url),m=BUILD.exec(u.pathname);if(u.origin===this.origin&&m)this.activeBuild=m[1]}catch{}}
  async manifest(build){
    if(this.snapshots.has(build))return this.snapshots.get(build);
    if(this.pending.has(build))return this.pending.get(build);
    const promise=(async()=>{
      const response=await this.remote(new Request(this.origin+'/_build/'+build+'/data/resource-cache.json',{cache:'force-cache',signal:AbortSignal.timeout(20000)}));
      if(!response.ok)throw Error('资源清单暂不可用');
      if(Number(response.headers.get('content-length'))>8388608)throw Error('资源清单过大');
      const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>8388608)throw Error('资源清单过大');
      const value=JSON.parse(new TextDecoder().decode(bytes));
      if(value.version!==1||!value.entries||Array.isArray(value.entries)||Object.keys(value.entries).length>50000)throw Error('服务器资源清单无效');
      for(const [url,item]of Object.entries(value.entries))if(!/^\/(assets|fonts)\//.test(url)||canonical(url)!==url||!HASH.test(item?.hash)||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>33554432)throw Error('服务器资源清单无效');
      // The 8443 host is Windows: preserve exact keys and resolve unique case-insensitive aliases.
      const folded=new Map(),aliases=new Map();for(const [key,item]of Object.entries(value.entries)){const k=key.toLowerCase();folded.set(k,folded.has(k)?null:item)}for(const [key,item]of Object.entries(value.aliases||{})){const k=key.toLowerCase();aliases.set(k,aliases.has(k)?null:item)}
      const cdn=new Map();for(const [key,item]of Object.entries(value.entries)){try{const u=new URL(item.cdn);if(this.origin==='https://weishuxieyi.icu'&&u.origin==='https://assets.weishuxieyi.icu'&&u.pathname.startsWith('/pilot/content/'+item.hash+'.')&&!u.search&&!u.hash&&!u.username&&!u.password)cdn.set(u.href,key)}catch{}}
      const snapshot={...value,folded,aliasFolded:aliases,cdn,raw:bytes};if(!this.activeBuild)this.activeBuild=build;this.snapshots.set(build,snapshot);if(this.snapshots.size>8)this.snapshots.delete(this.snapshots.keys().next().value);return snapshot;
    })().finally(()=>this.pending.delete(build));this.pending.set(build,promise);return promise;
  }
  async read(item,start=0,end=item.bytes-1){
    const body=Buffer.alloc(end-start+1);let offset=0;
    while(offset<body.length){const result=await this.file.read(body,offset,body.length-offset,item.offset+start+offset);if(!result.bytesRead)throw Error('内置资源读取不完整');offset+=result.bytesRead;}return body;
  }
  async verifiedBody(hash,item){
    if(this.verifying.has(hash))return this.verifying.get(hash);
    const promise=(async()=>{const body=await this.read(item);if(digest(body)!==hash)throw Error('内置资源损坏');this.verified.add(hash);return body})().finally(()=>this.verifying.delete(hash));
    this.verifying.set(hash,promise);return promise;
  }
  async handle(request,localOnly=false){
    const fallback=()=>localOnly?null:this.remote(request);
    const url=new URL(request.url);
    if(!['GET','HEAD'].includes(request.method))return fallback();
    if(url.origin!==this.origin){
      const key=this.snapshots.get(this.activeBuild)?.cdn.get(url.href);
      if(key){const mapped=new Request(this.origin+'/_build/'+this.activeBuild+key,{method:request.method,headers:request.headers});const local=await this.handle(mapped,true);if(local)return local;}
      return fallback();
    }
    const match=BUILD.exec(url.pathname),build=match?.[1]||this.activeBuild,path=canonical(match?.[2]||url.pathname);
    if(!build||!path)return fallback();
    if(path==='/data/resource-cache.json'){
      try{const snap=await this.manifest(build);return new Response(request.method==='HEAD'?null:snap.raw,{headers:{'content-type':'application/json','content-length':String(snap.raw.length),'cache-control':'no-store'}})}catch{return fallback()}
    }
    // fonts.css is a versioned code stylesheet; its font files are bundled.
    if(!/^\/(assets|fonts|media)\//.test(path)||path.endsWith('.css'))return fallback();
    try{
      const snap=await this.manifest(build),key=path.startsWith('/media/')?(snap.aliases?.[path]||snap.aliasFolded.get(path.toLowerCase())):path;
      let expected=key&&(snap.entries[key]||snap.folded.get(key.toLowerCase()));
      if(!expected&&this.index.extraBuilds?.includes(build))expected=this.index.extras?.[key];
      if(!expected)expected=this.index.extrasByBuild?.[build]?.[key];
      const mod=expected&&await this.mods?.replacement(key,expected.hash);
      if(mod){
        const range=rangeFor(request.headers.get('range'),mod.bytes.length);if(!range)return new Response(null,{status:416,headers:{'content-range':'bytes */'+mod.bytes.length}});
        const headers={'content-type':mime(mod.path),'content-length':String(range.end-range.start+1),'cache-control':'no-store','accept-ranges':'bytes','x-sp-native-resource':'DESKTOP-MOD'};if(range.status===206)headers['content-range']=`bytes ${range.start}-${range.end}/${mod.bytes.length}`;
        this.metrics.modHits++;return new Response(request.method==='HEAD'?null:mod.bytes.subarray(range.start,range.end+1),{status:range.status,headers});
      }
      const item=expected&&this.index.entries[expected.hash];
      if(!item||item.bytes!==expected.bytes){
        const bytes=expected&&await this.patches?.get(expected.hash,expected.bytes);
        if(bytes){const range=rangeFor(request.headers.get('range'),bytes.length);if(!range)return new Response(null,{status:416,headers:{'content-range':'bytes */'+bytes.length}});const headers={'content-type':mime(key),'content-length':String(range.end-range.start+1),'cache-control':'no-store','accept-ranges':'bytes','x-sp-native-resource':'DESKTOP-PATCH'};if(range.status===206)headers['content-range']=`bytes ${range.start}-${range.end}/${bytes.length}`;this.metrics.patchHits++;return new Response(request.method==='HEAD'?null:bytes.subarray(range.start,range.end+1),{status:range.status,headers})}
        this.metrics.updates++;return fallback()
      }
      const range=rangeFor(request.headers.get('range'),item.bytes);
      if(!range)return new Response(null,{status:416,headers:{'content-range':'bytes */'+item.bytes}});
      let body=null;
      if(request.method!=='HEAD'){
        if(!this.verified.has(expected.hash)){const full=await this.verifiedBody(expected.hash,item);body=full.subarray(range.start,range.end+1)}
        else body=await this.read(item,range.start,range.end);
      }
      const headers={'content-type':mime(key),'content-length':String(range.end-range.start+1),'cache-control':'no-store','accept-ranges':'bytes','access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin','x-sp-native-resource':'DESKTOP-BUNDLED','x-sp-resource-bytes':String(item.bytes)};
      if(range.status===206)headers['content-range']=`bytes ${range.start}-${range.end}/${item.bytes}`;
      this.metrics.hits++;this.metrics.bytes+=body?.length||0;
      return new Response(body,{status:range.status,headers});
    }catch(error){this.metrics.corrupt++;this.metrics.lastError=String(error.message||error);return fallback()}
  }
  status(){return {files:this.index.files,unique:Object.keys(this.index.entries).length,...this.metrics}}
  async close(){await this.file?.close()}
}
module.exports={ResourceLibrary,canonical,rangeFor,mime,MEDIA,digest};
