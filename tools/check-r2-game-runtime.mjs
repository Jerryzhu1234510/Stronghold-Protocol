import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
const output='../../outputs/r2-cutover';
const gen='ee4149fa116a-7',origin='https://weishuxieyi.icu',base='/_build/'+gen+'/';
const report={at:new Date().toISOString(),generation:gen,errors:[],pass:false};
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>['connected','online'].includes(globalThis.__SP__?.store.get().connection.status),{timeout:60000});
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
 const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url()===origin+base+'js/resources/worker.js');
 const session=await target.createCDPSession();await session.send('Network.enable');report.r2Requests=[];
 session.on('Network.requestWillBeSent',e=>{if(e.request.url.startsWith('https://assets.weishuxieyi.icu/'))report.r2Requests.push(e.request.url);});
 report.runtime=await page.evaluate(async base=>{
  const {resourceCacheAction}=await import(base+'js/resources/client.js');
  const {loadSpineData}=await import(base+'js/assets.js');
  const {ensurePixi}=await import(base+'js/render/app/pixi.js');await ensurePixi();
  const before=await resourceCacheAction('status');
  const data=await loadSpineData({skel:base+'assets/spine/op/char_4202_haruka/front/char_4202_haruka.skel'});
  const app=new PIXI.Application({width:280,height:280,backgroundColor:0x1b2030});
  Object.assign(app.view.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'9999'});document.body.append(app.view);
  const spine=new PIXI.spine.Spine(data);app.stage.addChild(spine);
  const bounds=spine.getLocalBounds();const scale=Math.min(180/Math.max(1,bounds.width),180/Math.max(1,bounds.height));
  spine.scale.set(scale);spine.position.set(140-(bounds.x+bounds.width/2)*scale,140-(bounds.y+bounds.height/2)*scale);
  spine.state.setAnimation(0,data.animations[0].name,true);app.renderer.render(app.stage);
  const after=await resourceCacheAction('status');
  return {url:location.href,connection:__SP__.store.get().connection.status,bones:data.bones.length,animations:data.animations.length,
   newR2Downloads:after.cdn.downloads-before.cdn.downloads,cdn:after.cdn,preload:after.preload,controller:navigator.serviceWorker.controller.scriptURL};
 },base);
 await page.screenshot({path:output+'/game-runtime.png',fullPage:true});
 if(report.runtime.newR2Downloads<3||report.runtime.bones!==516||report.runtime.animations!==17||report.errors.length)throw new Error('Live runtime R2 model verification failed');
 report.pass=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await browser.close();await fs.writeFile(output+'/game-runtime.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
