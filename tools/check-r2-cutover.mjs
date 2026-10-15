import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin='https://weishuxieyi.icu';
const base=process.argv[2]||'/r2-cutover-test/';
const output=path.resolve(process.argv[3]||'../../outputs/r2-cutover/browser-staged');
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'profile-'));
const report={at:new Date().toISOString(),base,phases:[],errors:[],pass:false};
let browser,page,workerSession,phase;
async function action(action,extra={}) {
  return page.evaluate(async ({action,extra})=>{
    const channel=new MessageChannel();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Worker action timed out')),30000);
      channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.ok?resolve(e.data):reject(new Error(e.data.error));};
      navigator.serviceWorker.controller.postMessage({action,...extra},[channel.port2]);
    });
  },{action,extra});
}
async function open() {
  browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:profile});
  page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(origin+base+(base.startsWith('/_build/')?'data/resource-cache.json':''),{waitUntil:'domcontentloaded',timeout:60000});
  await page.evaluate(async base=>{
    await navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base});
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Worker control timeout')),15000);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
    });
  },base);
  await action('status');
  const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url()===origin+base+'js/resources/worker.js',{timeout:20000});
  workerSession=await target.createCDPSession();await workerSession.send('Network.enable');
  workerSession.on('Network.requestWillBeSent',e=>{
    if(!phase)return;
    const u=new URL(e.request.url);
    if(u.origin==='https://assets.weishuxieyi.icu') {phase.r2Requests++;phase.urls.push(e.request.url);}
    else if(u.origin===origin&&/\/(assets|fonts|media)\//.test(u.pathname)){phase.tencentRequests++;phase.urls.push(e.request.url);}
  });
}
async function filesPhase(name,files) {
  const started=Date.now();
  phase={name,r2Requests:0,tencentRequests:0,urls:[]};report.phases.push(phase);
  phase.results=await page.evaluate(async ({base,files})=>{
    const results=[];
    for(const [url,item] of files) {
      const started=performance.now();
      const response=await fetch(base+url.slice(1),{cache:'reload',signal:AbortSignal.timeout(60000)});
      const data=await response.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
      results.push({url,status:response.status,bytes:data.byteLength,elapsedMs:Math.round(performance.now()-started),valid:hash===item.hash&&data.byteLength===item.bytes,
        hit:response.headers.get('x-sp-resource-cache'),source:response.headers.get('x-sp-resource-source')});
    }
    return results;
  },{base,files});
  await new Promise(resolve=>setTimeout(resolve,200));
  phase.elapsedMs=Date.now()-started;
  for(const row of phase.results)assert.ok(row.status===200&&row.valid,JSON.stringify(row));
  console.log(JSON.stringify({name,r2Requests:phase.r2Requests,tencentRequests:phase.tencentRequests}));
  return phase;
}
try {
  await open();
  const manifest=await page.evaluate(async base=>(await fetch(base+'data/resource-cache.json')).json(),base);
  assert.ok(manifest.count>12000);assert.equal(manifest.cdn?.mappedResources,manifest.count);
  const entries=Object.entries(manifest.entries);
  const models=['.skel','.atlas','.png'].map(ext=>entries.find(([url])=>url.includes('/spine/op/char_4202_haruka/front/')&&url.endsWith(ext)));
  const pick=ext=>entries.filter(([url,item])=>url.endsWith(ext)&&item.bytes>2000&&item.bytes<100000).sort((a,b)=>a[1].bytes-b[1].bytes).at(5);
  const font=entries.find(([url])=>url.endsWith('.woff2'));
  const files=[...models,pick('.webp'),pick('.mp3'),font].filter(Boolean);assert.equal(files.length,6);
  report.samples=files.map(([url,item])=>({url,bytes:item.bytes}));
  await action('clear');
  const cold=await filesPhase('cold_r2',files);assert.equal(cold.r2Requests,6);assert.equal(cold.tencentRequests,0);
  assert.ok(cold.results.every(x=>x.source==='r2'));
  const warm=await filesPhase('local_reuse',files);assert.equal(warm.r2Requests+warm.tencentRequests,0);assert.ok(warm.results.every(x=>x.hit==='HIT'));
  if(!base.startsWith('/_build/')) {
    await page.addScriptTag({url:base+'vendor/pixi.min.js'});await page.addScriptTag({url:base+'vendor/pixi-spine.js'});
    report.model=await page.evaluate(async ({base,skel})=>{
      const asset=await PIXI.Assets.load(base+skel.slice(1));
      if(!asset?.spineData)throw new Error('Spine skeleton parser failed');
      const app=new PIXI.Application({width:400,height:400,backgroundColor:0x1b2030,antialias:true});
      document.body.append(app.view);
      const spine=new PIXI.spine.Spine(asset.spineData);app.stage.addChild(spine);
      const bounds=spine.getLocalBounds();spine.scale.set(Math.min(300/Math.max(1,bounds.width),300/Math.max(1,bounds.height)));
      spine.position.set(200-(bounds.x+bounds.width/2)*spine.scale.x,200-(bounds.y+bounds.height/2)*spine.scale.y);
      const animation=asset.spineData.animations[0]?.name;if(animation)spine.state.setAnimation(0,animation,true);
      app.renderer.render(app.stage);
      return {bones:asset.spineData.bones.length,slots:asset.spineData.slots.length,animations:asset.spineData.animations.length,textureWidth:spine.spineData?.skins?.length??0};
    },{base,skel:models[0][0]});
    assert.ok(report.model.bones>0&&report.model.animations>0);
    await page.screenshot({path:path.join(output,'model.png'),fullPage:true});
  }
  phase=null;await browser.close();browser=null;await open();
  const restart=await filesPhase('browser_restart_reuse',files);assert.equal(restart.r2Requests+restart.tencentRequests,0);
  await page.setOfflineMode(true);await workerSession.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  const offline=await filesPhase('offline_reuse',files);assert.equal(offline.r2Requests+offline.tencentRequests,0);
  await page.setOfflineMode(false);await workerSession.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await action('enable',{enabled:false});
  const disabled=await filesPhase('local_cache_disabled_r2',files);assert.equal(disabled.r2Requests,6);assert.equal(disabled.tencentRequests,0);
  await action('enable',{enabled:true});await action('clear');
  await workerSession.send('Network.setBlockedURLs',{urls:['https://assets.weishuxieyi.icu/*']});
  const failed=await filesPhase('blocked_r2_tencent_fallback',files);assert.equal(failed.tencentRequests,6);assert.ok(failed.results.every(x=>x.source==='tencent'));
  report.finalStatus=await action('status');assert.ok(report.finalStatus.cdn.failures>=1);
  const range=await page.evaluate(async ({base,url})=>{
    const r=await fetch(base+url.slice(1),{headers:{Range:'bytes=0-99'},cache:'reload'});
    return {status:r.status,bytes:(await r.arrayBuffer()).byteLength,hit:r.headers.get('x-sp-resource-cache')};
  },{base,url:files[4][0]});
  report.range=range;assert.equal(range.status,206);assert.equal(range.bytes,100);assert.equal(range.hit,'HIT');
  assert.deepEqual(report.errors,[]);report.pass=true;
} catch(error) {report.error=error.stack;process.exitCode=1;}
finally {
  phase=null;await browser?.close();
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,model:report.model,error:report.error}));
}
