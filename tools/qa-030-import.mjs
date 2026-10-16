import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const probeOnly=process.argv.includes('--probe-only');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.resolve('../private-web-import030'),args:['--disable-gpu','--no-first-run']});
const page=await browser.newPage(),report={artLogicalRequests:0,startedAt:new Date().toISOString(),progress:[]},errors=[];
browser.on('disconnected',()=>{report.disconnectedAt=new Date().toISOString();});
page.on('error',e=>{report.pageCrash=e.message;});
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/\/(?:assets|media)\//.test(new URL(r.url()).pathname))report.artLogicalRequests++;});
try{
 await page.goto('http://127.0.0.1:27630/',{waitUntil:'networkidle2',timeout:60000});
 if(!probeOnly){
 await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='qa-zip';document.body.append(input);});
 const input=await page.$('#qa-zip');
 await input.uploadFile(path.resolve('../export/网页资源包-v0.3.0-本地测试完整包.zip'));
 const start=Date.now();
 await page.evaluate(async()=>{const {assetImport}=await import(`/_build/${window.__SP_GENERATION}/js/assetPack.js`);window.__qaImport=assetImport;void assetImport.start({type:'zip',data:document.querySelector('#qa-zip').files[0]});});
 for(let attempt=0;attempt<360;attempt++){
  report.lastState=await page.evaluate(()=>window.__qaImport?.get());
  if(['complete','partial','error','cancelled'].includes(report.lastState?.phase))break;
  if(attempt%15===0){report.progress.push({seconds:Math.round((Date.now()-start)/1000),...report.lastState});console.log(JSON.stringify({progress:report.progress.at(-1)}));}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 report.seconds=Math.round((Date.now()-start)/100)/10;report.import=await page.evaluate(()=>window.__qaImport.get());
 assert.equal(report.import.phase,'complete');assert.equal(report.import.failed,0);assert.equal(report.import.rejected,0);assert.equal(report.import.accepted,report.import.total);assert.ok(report.import.accepted>29000);
 }
 const before=report.artLogicalRequests;
 report.probe=await page.evaluate(async()=>{await navigator.serviceWorker.ready;await new Promise(r=>setTimeout(r,1000));const manifest=await fetch('/data/assets.json').then(r=>r.json());const scan=v=>typeof v==='string'&&/^\/assets\/.*\.png$/.test(v)?v:v&&typeof v==='object'?Object.values(v).map(scan).find(Boolean):null;const r=await fetch(scan(manifest));return{status:r.status,hit:r.headers.get('x-sp-resource-cache'),bytes:(await r.arrayBuffer()).byteLength};});
 assert.equal(report.probe.hit,'HIT');assert.equal(report.probe.status,200);report.probeRequestCount=report.artLogicalRequests-before;
 report.meshProbe=await page.evaluate(async()=>{const manifest=await fetch('/data/local-assets.json').then(r=>r.json());const scan=v=>typeof v==='string'&&/^\/assets\/.*\.obj$/.test(v)?v:v&&typeof v==='object'?Object.values(v).map(scan).find(Boolean):null;const url=scan(manifest);if(!url)return{error:'no mesh URL in manifest'};const r=await fetch(url);return{status:r.status,hit:r.headers.get('x-sp-resource-cache'),bytes:(await r.arrayBuffer()).byteLength};});
 assert.equal(report.meshProbe.hit,'HIT');assert.equal(report.meshProbe.status,200);
 assert.deepEqual(errors,[]);report.ok=true;
}catch(error){report.error=error.stack;report.cause=String(error.cause||'');process.exitCode=1;}
finally{report.errors=errors;report.finishedAt=new Date().toISOString();await fs.writeFile(probeOnly?'../qa-import030-probes.json':'../qa-import030.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
