import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin='https://weishuxieyi.icu',base='/_build/bfd6ad0ba86c-4/';
const output=path.resolve('../../outputs/resource-pressure-verification');
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'browser-profile-'));
const report={at:new Date().toISOString(),origin,base,profile,phases:[],errors:[]};
let browser,page,workerSession,phase=null;
const counts=new Map();
async function open(){
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:profile});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+base+'data/resource-cache.json',{waitUntil:'domcontentloaded',timeout:60000});
 await page.evaluate(async base=>{
   await navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base});
   await navigator.serviceWorker.ready;
   if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Worker did not control page')),15000);
     navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
   });
   // Status waits for the manifest after a worker/browser restart.
   const channel=new MessageChannel();
   await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Status timeout')),15000);
     channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.ok?resolve():reject(new Error(e.data.error));};
     navigator.serviceWorker.controller.postMessage({action:'status'},[channel.port2]);
   });
 },base);
 const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url()===origin+base+'js/resources/worker.js',{timeout:15000});
 workerSession=await target.createCDPSession();await workerSession.send('Network.enable');
 workerSession.on('Network.requestWillBeSent',e=>{
   if(!phase)return;
   const u=new URL(e.request.url);
   if(!u.pathname.startsWith(base+'assets/')&&!u.pathname.startsWith(base+'fonts/'))return;
   counts.set(e.requestId,{phase,url:e.request.url});phase.originRequests++;
 });
 workerSession.on('Network.responseReceived',e=>{
   const record=counts.get(e.requestId);if(!record)return;
   record.status=e.response.status;record.fromDiskCache=e.response.fromDiskCache;
 });
 workerSession.on('Network.loadingFinished',e=>{
   const record=counts.get(e.requestId);if(!record)return;
   record.phase.networkEncodedBytes+=e.encodedDataLength;
   record.phase.network.push({url:record.url,status:record.status,fromDiskCache:!!record.fromDiskCache,encodedBytes:e.encodedDataLength});counts.delete(e.requestId);
 });
}
async function start(name){phase={name,originRequests:0,networkEncodedBytes:0,network:[],results:[]};report.phases.push(phase);}
async function runFiles(files){
 const before=Date.now();
 phase.results=await page.evaluate(async({base,files})=>{
   const out=[];
   for(const [file,item] of files){
     const at=performance.now();
     // Bypass ordinary HTTP cache deliberately: only the game's content cache can avoid these requests.
     const r=await fetch(base+file.slice(1),{cache:'reload',signal:AbortSignal.timeout(60000)});
     const body=await r.arrayBuffer();
     const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');
     out.push({file,status:r.status,hit:r.headers.get('x-sp-resource-cache'),bytes:body.byteLength,valid:digest===item.hash&&body.byteLength===item.bytes,ms:Math.round(performance.now()-at)});
   }
   return out;
 },{base,files});
 phase.ms=Date.now()-before;
 // Allow CDP's trailing loadingFinished notifications to reach the recorder.
 await new Promise(resolve=>setTimeout(resolve,300));
 for(const result of phase.results)assert.ok(result.status===200&&result.valid,JSON.stringify(result));
 console.log(JSON.stringify({name:phase.name,requests:phase.originRequests,encodedBytes:phase.networkEncodedBytes,ms:phase.ms,hits:phase.results.filter(r=>r.hit==='HIT').length}),flush);
}
const flush=undefined;
try{
 await open();
 const manifest=await page.evaluate(async base=>fetch(base+'data/resource-cache.json').then(r=>r.json()),base);
 const entries=Object.entries(manifest.entries);
 const unique=new Map(entries.map(([file,item])=>[item.hash,{file,...item}]));
 report.package={entries:entries.length,uniqueFiles:unique.size,declaredBytes:manifest.totalBytes,uniqueBytes:[...unique.values()].reduce((n,x)=>n+x.bytes,0)};
 // Verify the exact explicit-download API with a small bounded batch, rather than downloading a full pack from a live server.
 await start('manual_preload_3_files');
 phase.manual=await page.evaluate(async()=>{
   const action=async()=>{
     const channel=new MessageChannel();
     return new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>reject(new Error('Warm timeout')),20000);
       channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.ok?resolve(e.data):reject(new Error(e.data.error));};
       navigator.serviceWorker.controller.postMessage({action:'warm',manual:true},[channel.port2]);
     });
   };
   const out=[];for(let i=0;i<3;i++)out.push(await action());
   return out.map(s=>({files:s.files,bytes:s.bytes,preload:s.preload}));
 });
 await new Promise(resolve=>setTimeout(resolve,300));
 const cached=await page.evaluate(async()=> (await (await caches.open('sp-resource-content-v1')).keys()).map(k=>k.url.split('/').at(-1)));
 assert.equal(cached.length,3);
 const manualFiles=cached.map(hash=>{const x=unique.get(hash);assert.ok(x);return [x.file,{hash,bytes:x.bytes}];});
 await start('use_explicitly_downloaded_files');await runFiles(manualFiles);assert.equal(phase.originRequests,0);assert.ok(phase.results.every(r=>r.hit==='HIT'));
 const pick=(fragment,ext)=>entries.filter(([u])=>u.includes(fragment)&&u.endsWith(ext)).sort((a,b)=>a[1].bytes-b[1].bytes).at(Math.floor(entries.filter(([u])=>u.includes(fragment)&&u.endsWith(ext)).length/2));
 const files=[pick('/portraits/','.webp'),pick('/avatars/','.webp'),pick('/skills/','.webp'),
  ...['.skel','.atlas','.png'].map(ext=>entries.find(([u])=>u.includes('/spine/op/char_4202_haruka/front/')&&u.endsWith(ext)))].filter(Boolean);
 assert.ok(files.length>=3);report.sample={files:files.map(([file,x])=>({file,bytes:x.bytes})),rawBytes:files.reduce((n,[,x])=>n+x.bytes,0)};
 await start('cold_first_use');await runFiles(files);assert.equal(phase.originRequests,files.length);
 await start('warm_repeat_use');await runFiles(files);assert.equal(phase.originRequests,0);assert.ok(phase.results.every(r=>r.hit==='HIT'));
 await browser.close();browser=null;workerSession=null;phase=null;
 await open();
 await start('browser_restart_same_resources');await runFiles(files);assert.equal(phase.originRequests,0);assert.ok(phase.results.every(r=>r.hit==='HIT'));
 await page.setOfflineMode(true);await workerSession.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await start('offline_same_resources');await runFiles(files);assert.equal(phase.originRequests,0);assert.ok(phase.results.every(r=>r.hit==='HIT'));
 report.pass=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{
 await browser?.close();await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
