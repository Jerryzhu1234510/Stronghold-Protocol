import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {ResourceLibrary,digest,canonical}=createRequire(import.meta.url)('../resources.cjs');
const folder=await fs.mkdtemp(new URL('../test-output/hash-path-',import.meta.url));
const body=Buffer.from('fixture resource'),hash=digest(body),origin='https://game.example';
const index={version:1,files:1,bytes:body.length,entries:{[hash]:{offset:0,bytes:body.length,core:true}}},raw=JSON.stringify(index);
await fs.writeFile(path.join(folder,'index.json'),raw);await fs.writeFile(path.join(folder,'bundle-info.json'),JSON.stringify({indexSha256:digest(raw)}));await fs.writeFile(path.join(folder,'assets.bin'),body);
let requests=0;
const lib=await new ResourceLibrary({directory:folder,origin,remote:async request=>{
  const url=new URL(request.url);
  if(url.pathname.endsWith('/data/resource-cache.json'))return Response.json({version:1,entries:{'/assets/a.png':{hash:url.pathname.includes('/new/')?'f'.repeat(64):hash,bytes:body.length}},aliases:{'/media/a':'/assets/a.png'}});
  requests++;return new Response('network');
}}).initialize();lib.setPage(origin+'/_build/old/');
try{
 for(const name of ['/assets/~0123456789abcdef/a.png','/_build/old/assets/~0123456789abcdef/a.png','/_build/old/media/~0123456789abcdef/a']){
  const res=await lib.handle(new Request(origin+name));assert.equal(res.headers.get('x-sp-native-resource'),'DESKTOP-BUNDLED');assert.equal(await res.text(),body.toString());
 }
 const partial=await lib.handle(new Request(origin+'/_build/old/assets/~0123456789abcdef/a.png',{headers:{Range:'bytes=0-3'}}));assert.equal(partial.status,206);assert.equal(await partial.text(),body.subarray(0,4).toString());assert.equal(requests,0);
 lib.mods={replacement:async(key,h)=>{assert.equal(key,'/assets/a.png');assert.equal(h,hash);return {path:'skin.png',bytes:Buffer.from('skin')}}};
 assert.equal(await(await lib.handle(new Request(origin+'/_build/old/assets/~0123456789abcdef/a.png'))).text(),'skin');lib.mods=null;
 assert.equal(await(await lib.handle(new Request(origin+'/_build/new/assets/~0123456789abcdef/a.png'))).text(),'network');
 assert.equal(await(await lib.handle(new Request('https://foreign.example/_build/old/assets/~0123456789abcdef/a.png'))).text(),'network');
 assert.equal(await(await lib.handle(new Request(origin+'/_build/old/assets/~0123456789abcdef/a.png',{method:'POST'}))).text(),'network');assert.equal(requests,3);
 for(const value of ['/assets/~0123456789abcdef/../accounts.json','/assets/~0123456789abcdef/%2e%2e/accounts.json','/assets/~0123456789abcdef/\\accounts.json'])assert.equal(canonical(value),null);
 assert.equal(canonical('/assets/~invalid/a.png'),'/assets/~invalid/a.png');
 console.log(JSON.stringify({ok:true,checks:['hashed images/media aliases hit bundled resource','ranges remain valid','Mod lookup receives canonical original hash','new build, foreign origin and POST do not reuse stale resources','traversal rejected']}));
}finally{await lib.close();}
