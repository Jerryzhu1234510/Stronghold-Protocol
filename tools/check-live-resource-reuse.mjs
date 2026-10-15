import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='https://weishuxieyi.icu', base='/_build/8872ea811d2f-3/';
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={at:new Date().toISOString(),base,errors:[]};
try {
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+base+'data/resource-cache.json',{waitUntil:'domcontentloaded',timeout:60000});
 report.setup=await page.evaluate(async base=>{
   const reg=await navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base});
   await navigator.serviceWorker.ready;
   if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('No controller')),15000);
     navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
   });
   return {controller:navigator.serviceWorker.controller.scriptURL,active:reg.active.scriptURL};
 },base);
 const check=async offline=>page.evaluate(async ({base,offline})=>{
   const selected=globalThis.__cacheProbeFiles ??= await fetch(base+'data/resource-cache.json').then(r=>r.json()).then(m=>{
     const entries=Object.entries(m.entries);
     const chosen=['.png','.webp','.atlas','.skel'].map(ext=>entries.filter(([u,x])=>u.startsWith('/assets/')&&u.endsWith(ext)&&x.bytes>1000).sort((a,b)=>a[1].bytes-b[1].bytes)[0]);
     const large='/assets/spine/op/char_4202_haruka/front/char_4202_haruka.skel';
     if(m.entries[large])chosen.push([large,m.entries[large]]);
     return chosen;
   });
   const out=[];
   for(const [path,item] of selected){
     const t=performance.now(),r=await fetch(base+path.slice(1),{cache:'reload'}),b=await r.arrayBuffer();
     const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
     out.push({path,status:r.status,hit:r.headers.get('x-sp-resource-cache'),bytes:b.byteLength,hashCorrect:digest===item.hash,ms:Math.round(performance.now()-t),offline});
   }
   return out;
 },{base,offline});
 report.first=await check(false);report.second=await check(false);
 await page.setOfflineMode(true);report.offline=await check(true);
 for(const row of [...report.first,...report.second,...report.offline])assert.ok(row.hashCorrect&&row.status===200,JSON.stringify(row));
 for(const row of [...report.second,...report.offline])assert.equal(row.hit,'HIT',JSON.stringify(row));
 if(process.argv[2]){
   const nextBase='/_build/'+process.argv[2]+'/';
   const selected=await page.evaluate(()=>globalThis.__cacheProbeFiles);
   await page.setOfflineMode(false);await page.goto(origin+nextBase+'data/resource-cache.json',{waitUntil:'domcontentloaded'});
   report.crossGeneration=await page.evaluate(async({base,selected})=>{
     await navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base});
     await navigator.serviceWorker.ready;
     if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>reject(new Error('No next controller')),15000);
       navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
     });
     await fetch(base+'data/resource-cache.json');
     const out=[];
     for(const [path,item] of selected){
       const r=await fetch(base+path.slice(1),{cache:'reload'}),b=await r.arrayBuffer();
       const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
       out.push({path,hit:r.headers.get('x-sp-resource-cache'),hashCorrect:digest===item.hash});
     }
     const {Img}=await import(base+'js/ui/gameComponents.js');
     const {AvatarFrame}=await import(base+'js/ui/components.js');
     return {files:out,componentsImport:typeof Img==='function'&&typeof AvatarFrame==='function',controller:navigator.serviceWorker.controller.scriptURL};
   },{base:nextBase,selected});
   assert.ok(report.crossGeneration.componentsImport);
   for(const row of report.crossGeneration.files)assert.ok(row.hit==='HIT'&&row.hashCorrect,JSON.stringify(row));
   await page.evaluate(async({base,path})=>{
     const {h,render}=await import(base+'vendor/preact.module.js');
     const {Img}=await import(base+'js/ui/gameComponents.js');
     document.body.innerHTML='<div id="retryTest"></div>';
     render(h(Img,{src:base+path.slice(1),fallback:h('span',{id:'retryFallback'},'占位图')}),document.querySelector('#retryTest'));
   },{base:nextBase,path:selected[0][0]});
   await page.waitForFunction(()=>document.querySelector('#retryTest img')?.naturalWidth>0);
   await page.setOfflineMode(true);
   await page.evaluate(()=>document.querySelector('#retryTest img').dispatchEvent(new Event('error')));
   await page.waitForSelector('#retryFallback');
   await page.waitForFunction(()=>document.querySelector('#retryTest img')?.naturalWidth>0,{timeout:5000});
   report.liveImageRecoveryFromCacheWhileOffline=true;
 }
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{await browser.close();await fs.writeFile('../../outputs/live-resource-reuse.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
