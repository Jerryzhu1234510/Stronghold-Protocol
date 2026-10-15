/* global __SP__, document */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=new URL('../../../outputs/live-r12-room-qa/',import.meta.url);await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try {
 for(const [width,height] of [[1440,900],[844,390]]) {
  const context=await browser.createBrowserContext(),page=await context.newPage();
  await page.setViewport({width,height,isMobile:width<1000,hasTouch:width<1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const start=Date.now();await page.goto('https://weishuxieyi.icu/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>['connected','online'].includes(globalThis.__SP__?.store.get().connection.status),{timeout:60000});
  const readyMs=Date.now()-start;
  await page.evaluate(async()=>{const {enterSession}=await import('./js/screens/title.js');enterSession('加载验收');});
  await page.waitForFunction(()=>globalThis.__SP__?.store.get().me.playerId,{timeout:20000});
  const created=await page.evaluate(async()=>{const start=performance.now();await __SP__.net.request('room.create',{mode:'solo',difficulty:'NORMAL'});return Math.round(performance.now()-start)});
  await page.waitForFunction(()=>globalThis.__SP__?.store.get().room?.code,{timeout:20000});
  const code=await page.evaluate(()=>__SP__.store.get().room.code);
  await page.evaluate(()=>__SP__.net.request('room.start'));
  await page.waitForFunction(()=>globalThis.__SP__?.store.get().match.public?.phase==='INFO_CHECK',{timeout:20000});
  await page.evaluate(()=>__SP__.net.request('g.infoReady'));
  await page.waitForFunction(()=>globalThis.__SP__?.store.get().match.public?.phase==='BAND_DRAFT',{timeout:60000});
  await page.evaluate(async()=>{
   const {GAME_FILES}=await import('./js/ui/gameComponents.js');await __SP__.data.loadAll(GAME_FILES);
   const band=__SP__.data.list('bands').find(x=>!x.modeTypeList||x.modeTypeList.includes('SINGLE'));
   await __SP__.net.request('g.band',{bandId:band.bandId});
  });
  await page.waitForFunction(()=>globalThis.__SP__?.store.get().match.public?.phase==='PREP',{timeout:20000});
  await page.waitForSelector('.shopbar',{timeout:20000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.shopbar .scard__art')].every(x=>x.complete&&x.naturalWidth>0),{timeout:25000});
  const shop=await page.evaluate(()=>({text:document.querySelector('.shopbar').textContent,images:[...document.querySelectorAll('.shopbar img')].map(x=>({complete:x.complete,w:x.naturalWidth,url:x.getAttribute('src')}))}));
  assert.ok(!shop.text.includes('chess_char_'),shop.text);assert.ok(shop.text.includes('刷新'));
  const reconnectAt=Date.now();await page.evaluate(()=>__SP__.net.reconnectNow());
  await page.waitForFunction(()=>['connected','online'].includes(__SP__.store.get().connection.status)&&__SP__.store.get().room?.inMatch&&__SP__.store.get().match.public?.phase==='PREP',{timeout:20000});
  assert.equal(await page.evaluate(()=>__SP__.store.get().room.code),code);
  const reconnectMs=Date.now()-reconnectAt;
  const cache=await page.evaluate(async()=>{
   const {resourceCacheAction}=await import('./js/resources/client.js');
   const status=await resourceCacheAction('warm');
   const manifest=await (await fetch('./data/resource-cache.json')).json();
   const asset=Object.entries(manifest.entries).find(([url,item])=>url.endsWith('.png')&&item.bytes<10000)?.[0];
   await fetch('.'+asset).then(r=>r.arrayBuffer());
   const hit=await fetch('.'+asset);await hit.arrayBuffer();
   const after=await resourceCacheAction();
   return {state:status.preload.state,files:after.files,hits:after.hits,hit:hit.headers.get('x-sp-resource-cache'),controller:navigator.serviceWorker.controller?.scriptURL};
  });console.log(JSON.stringify({width,readyMs,created,reconnectMs,cache,shop,errors}));assert.ok(['paused','complete'].includes(cache.state));assert.ok(cache.files>0);assert.equal(cache.hit,'HIT');
  await page.screenshot({path:new URL(`shop-${width}.png`,output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  await page.evaluate(()=>__SP__.net.request('room.leave'));
  assert.deepEqual(errors,[]);
  const result={viewport:[width,height],readyMs,createRoomMs:created,reconnectMs,cache,shop,errors};results.push(result);console.log(JSON.stringify(result));await context.close();
 }
 await fs.writeFile(new URL('results.json',output),JSON.stringify(results,null,2));
}catch(error){console.error(error);throw error}finally{
 for(const p of await browser.pages()) { try{await p.evaluate(()=>globalThis.__SP__?.net.request('room.leave').catch(()=>{}))}catch{} }
 await browser.close();
}
