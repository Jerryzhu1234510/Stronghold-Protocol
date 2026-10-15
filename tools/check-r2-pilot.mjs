import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve(process.argv[2]||'../../outputs/r2-browser-qa');await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'profile-'));
const report={at:new Date().toISOString(),errors:[],phases:[],profile};
const expectCompression=process.argv.includes('--expect-compression');
let browser,page,phase;
async function open(){
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:profile});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const session=await page.createCDPSession();await session.send('Network.enable');
 const requests=new Map();
 session.on('Network.requestWillBeSent',e=>{
  if(phase&&(e.request.url.includes('.r2.dev/pilot/')||e.request.url.startsWith('https://assets.weishuxieyi.icu/pilot/')||e.request.url.includes('/assets/'))){
   requests.set(e.requestId,phase);phase.materialRequests++;
  }
 });
 session.on('Network.loadingFinished',e=>{const p=requests.get(e.requestId);if(p){p.encodedBytes+=e.encodedDataLength;requests.delete(e.requestId);}});
 session.on('Network.responseReceived',e=>{
  const p=requests.get(e.requestId);if(!p)return;
  const header=name=>Object.entries(e.response.headers).find(([key])=>key.toLowerCase()===name)?.[1]??null;
  p.responses.push({url:e.response.url,status:e.response.status,cacheStatus:header('cf-cache-status'),encoding:header('content-encoding'),contentType:header('content-type')});
 });
 await page.goto('https://weishuxieyi.icu/resource-test/',{waitUntil:'networkidle2',timeout:60000});
 await page.waitForFunction(()=>!document.querySelector('#r2').disabled);
}
async function run(source,name){
 phase={name,materialRequests:0,encodedBytes:0,responses:[]};report.phases.push(phase);
 const count=await page.evaluate(()=>globalThis.__spPilotResults?.length||0);
 await page.click('#'+source);
 await page.waitForFunction(n=>(globalThis.__spPilotResults?.length||0)>n,{timeout:125000},count);
 phase.result=await page.evaluate(()=>globalThis.__spPilotResults.at(-1));
 await new Promise(r=>setTimeout(r,200));
 console.log(JSON.stringify({name,pass:phase.result.pass,ms:phase.result.ms,requests:phase.materialRequests,encodedBytes:phase.encodedBytes}));
 assert.ok(phase.result.pass,JSON.stringify(phase.result));
 if(source==='cache')assert.equal(phase.materialRequests,0);
 else assert.equal(phase.materialRequests,5);
 if(source==='r2'&&expectCompression){
  for(const extension of ['.atlas','.skel']){
   const response=phase.responses.find(r=>new URL(r.url).pathname.endsWith(extension));
   assert.ok(response&&['br','gzip','zstd'].includes(response.encoding),JSON.stringify(phase.responses));
  }
  assert.ok(phase.encodedBytes<phase.result.rows.reduce((sum,r)=>sum+r.bytes,0)/2,'Expected actual wire transfer to be smaller than half the decoded material size');
 }
 phase=null;
}
try{
 await open();
 await run('tencent','Tencent cold');await run('r2','R2 first');await run('r2','R2 repeat');await run('cache','Local reuse');
 for(const width of [1366,390]){
  await page.setViewport({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,`page-${width}.png`),fullPage:true});
 }
 await browser.close();await open();await run('cache','Browser restart');
 await page.setOfflineMode(true);await run('cache','Offline cache');
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{await browser?.close();await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
