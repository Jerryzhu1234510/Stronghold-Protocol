import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
const source=await fs.readFile(new URL('../public/js/resources/official-compat-sw.js',import.meta.url),'utf8');
function fixture(native=false){
 const origin='https://weishuxieyiwangye.cn:8443', stores=new Map(), requests=[];
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {async match(key){return store.get(typeof key==='string'?key:key.url)?.clone()},async put(key,value){store.set(key,value)}};}};
 const pathname='/assets/char/test.png', hash=createHash('sha256').update('resource').digest('hex');
 const self={location:new URL(origin+'/sw.js'+(native?'?native=1':'')),clients:{async matchAll(){return[];}},addEventListener(){}};
 const fetch=async url=>{requests.push(String(url));return new Response(JSON.stringify({entries:{[pathname]:{hash,bytes:8}},aliases:{'/media/example.mp3':pathname}}),{headers:{'content-type':'application/json'}});};
 vm.runInNewContext(source,{self,caches,fetch,crypto:webcrypto,URL,TextEncoder,Headers,Response,Uint8Array,DataView,Number,Map,Set});
 return {api:self.SPAssetCompat,origin,caches,requests,pathname,hash};
}
test('official imported bytes cover both immutable generations and range reads',async()=>{
 const f=fixture(),cache=await f.caches.open('sp-imported-assets-v1');
 await cache.put(f.origin+'/assets/~0123456789abcdef/char/test.png',new Response('abcdefgh'));
 const req=new Request(f.origin+'/_build/new/assets/~0123456789abcdef/char/test.png',{headers:{range:'bytes=2-5'}});
 const hit=await f.api.lookup(req,cache);assert.equal(hit.status,206);assert.equal(await hit.text(),'cdef');assert.equal(hit.headers.get('x-sp-resource-cache'),'HIT');assert.deepEqual(f.requests,[]);
});
test('previous v2 hash shards are reused without an asset network request',async()=>{
 const f=fixture(),cache=await f.caches.open('sp-imported-assets-v1');
 const legacy=await f.caches.open('sp-resource-content-v2-'+f.hash[0]);
 await legacy.put(f.origin+'/__sp_resource_content/'+f.hash,new Response('resource'));
 const hit=await f.api.lookup(new Request(f.origin+'/_build/new/assets/~0123456789abcdef/char/test.png'),cache);
 assert.equal(await hit.text(),'resource');assert.equal(f.requests.length,1);assert.match(f.requests[0],/\/data\/resource-routes\/\w+\.json$/);
});
test('8443 missing art fails locally; missing audio is silent and never downloaded',async()=>{
 const f=fixture();assert.equal(f.api.only,true);
 const image=f.api.missing(new Request(f.origin+'/assets/missing.png'));assert.equal(image.status,503);
 const audio=f.api.missing(new Request(f.origin+'/media/missing.mp3'));assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/wav');assert.equal((await audio.arrayBuffer()).byteLength,8044);assert.deepEqual(f.requests,[]);
});

test('native protocol handlers receive bundled reads while code stylesheets stay outside art policy',()=>{
 const f=fixture(true);assert.equal(f.api.only,false);
 assert.equal(f.api.isResource('/_build/current/fonts/fonts.css'),false);
 assert.equal(f.api.isResource('/_build/current/fonts/example.woff2'),true);
});
