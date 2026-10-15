import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';

const code=(await readFile(new URL('../public/js/resources/client.js',import.meta.url),'utf8'))
  .replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')
  .replace(/import\.meta\.url/g,JSON.stringify('https://game.test/_build/current/js/resources/client.js'));
function runtime({native=false,hit=true,workerPolicy=true}={}){
 const listeners=new Set(),state={registered:0,reads:0,controlled:false};
 const sw={controller:null,addEventListener:(_,f)=>listeners.add(f),removeEventListener:(_,f)=>listeners.delete(f),
  register:async url=>{
   state.registered++;
   const active={scriptURL:url,postMessage:(_message,ports)=>ports[0].postMessage({ok:true,localOnly:workerPolicy})};
   setTimeout(()=>{state.controlled=true;sw.controller=active;for(const f of listeners)f()},20);
   return {active};
  }};
 const context=vm.createContext({__SP_LOCAL_RESOURCES_REQUIRED:true,isBundledClient:()=>native,isSecureContext:true,
  navigator:{serviceWorker:sw,locks:{}},caches:{},crypto:{subtle:{}},URL,MessageChannel,setTimeout,clearTimeout,
  fetch:async url=>{assert.equal(state.controlled,true,'probe waits for the active controller');state.reads++;assert.match(String(url),/current\/assets\/ui\/settle/);return new Response('local image',{headers:hit?{'x-sp-resource-cache':'HIT'}:{}})}});
 vm.runInContext(code,context);
 return {state,run:()=>vm.runInContext('requireLocalResourceController()',context),context};
}
test('required local startup waits for document control and verifies an actual cache read',async()=>{
 const h=runtime(),pending=h.run();assert.equal(h.state.reads,0);await pending;
 assert.equal(h.state.reads,1);assert.match(vm.runInContext('workerUrl',h.context),/localOnly=1/);
});
test('required local startup rejects a directory-only success or stale worker',async()=>{
 const noHit=runtime({hit:false});await assert.rejects(noHit.run(),/实际读取/);
 const stale=runtime({workerPolicy:false});await assert.rejects(stale.run(),/版本不符/);assert.equal(stale.state.reads,0);
});
test('native bundled clients do not inherit the web-only startup restriction',async()=>{
 const h=runtime({native:true});await h.run();assert.equal(h.state.registered,0);assert.equal(h.state.reads,0);
});
