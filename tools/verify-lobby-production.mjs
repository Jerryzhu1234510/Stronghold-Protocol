import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const out=path.resolve('../../outputs/lobby-r19-deploy');
const plan=JSON.parse(readFileSync(path.join(out,'deployment.json'),'utf8'));
assert.ok(plan.activated);
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
const report={passed:false, generation:plan.generation, errors:[], checks:[]};const pages=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function click(page,label,scope=''){
 const h=await page.evaluateHandle((label,scope)=>[...document.querySelectorAll(`${scope} button`)].find(e=>e.textContent.trim()===label&&!e.disabled),label,scope);assert.ok(h.asElement(),label);await h.asElement().click();await h.dispose();await pause(150);
}
async function req(page,t,fields={}){return page.evaluate(async (t,fields)=>(await import(`/_build/${window.__SP_GENERATION}/js/net.js`)).net.request(t,fields),t,fields);}
async function open(name){
 const ctx=await browser.createBrowserContext(),page=await ctx.newPage();pages.push(page);
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.setViewport({width:1440,height:900});
 await page.evaluateOnNewDocument(()=>{navigator.clipboard.writeText=async text=>(window.__copies||=[]).push(text);});
 await page.goto('https://weishuxieyi.icu/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForSelector('.title-screen',{timeout:60000});
 assert.equal(await page.evaluate(()=>window.__SP_GENERATION),plan.generation);
 await page.evaluate(async name=>(await import(`/_build/${window.__SP_GENERATION}/js/screens/title.js`)).enterSession(name),name);
 await page.waitForSelector('.lobby-screen');
 await page.waitForSelector('.release-notes');await click(page,'我知道了','.release-notes');
 await page.waitForSelector('.room-directory');
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.lobby-screen button')].some(e=>e.textContent.includes('快速匹配'))),false);
 return page;
}
try{
 const host=await open('上线检查'),viewer=await open('验证助手');
 await click(host,'创建同盟');await host.waitForSelector('.room-access-modal');
 await host.click('.room-access-option:nth-child(2)');await host.type('.room-description-field textarea','上线验证临时房间，稍后自动移除');await click(host,'确认创建','.room-access-modal');
 await host.waitForSelector('.room-screen');
 const room=await host.evaluate(async()=>(await import(`/_build/${window.__SP_GENERATION}/js/store.js`)).store.get().room);
 assert.equal(room.visibility,'private');report.code=room.code;
 await host.select('.room-map-picker select','classic');
 await host.waitForFunction(async()=>(await import(`/_build/${window.__SP_GENERATION}/js/store.js`)).store.get().room.mapVersion==='classic');
 await host.setViewport({width:844,height:390,isMobile:true,hasTouch:true});await pause(700);
 await host.waitForSelector('.room-screen');if(await host.$('.release-notes'))await click(host,'我知道了','.release-notes');
 const hit=await host.evaluate(()=>[...document.querySelectorAll('.invite__btns button')].map(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:e.textContent.trim(),visible:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,height:r.height,reachable:e.contains(h)};}));
 report.mobileCopyButtons=hit;await host.screenshot({path:path.join(out,'live-room-mobile.png')});assert.equal(hit.length,2);assert.ok(hit.every(e=>e.visible&&e.reachable&&e.height>=44),JSON.stringify(hit));
 await click(host,'复制密钥','.invite');await click(host,'复制链接','.invite');
 const copies=await host.evaluate(()=>window.__copies);assert.equal(copies[0],room.code);assert.ok(copies[1].startsWith('https://weishuxieyi.icu/'));assert.ok(copies[1].includes('房间简介：上线验证临时房间'));assert.ok(copies[1].includes('0.1.4 经典棋盘'));report.checks.push('mobile copy targets and invitation contents');
 await host.screenshot({path:path.join(out,'live-room-mobile.png')});
 await req(viewer,'room.join',{code:room.code});await viewer.waitForSelector('.room-chat-strip');
 await req(host,'room.chat',{text:'上线验证消息'});
 await viewer.waitForFunction(()=>document.querySelector('.room-chat-strip')?.textContent.includes('上线验证消息'));
 await req(viewer,'room.leave');
 await req(host,'room.setVisibility',{visibility:'public'});
 const directory=await viewer.evaluate(async()=>{const{net}=await import(`/_build/${window.__SP_GENERATION}/js/net.js`);const frame=new Promise(resolve=>{const off=net.on('room.directory',m=>{off();resolve(m);});});await net.request('room.list',{});return frame;});
 assert.ok(directory.rooms.some(r=>r.code===room.code&&!r.recruitment));
 await req(host,'room.setVisibility',{visibility:'private'});report.checks.push('public directory, private invite and two-way room chat');
 const r2=await host.evaluate(async()=>{
  await navigator.serviceWorker.ready;
  for(let i=0;!navigator.serviceWorker.controller&&i<60;i++)await new Promise(r=>setTimeout(r,100));
  const g=window.__SP_GENERATION,m=await(await fetch(`/_build/${g}/data/resource-cache.json`)).json(),local=await(await fetch(`/_build/${g}/data/local-assets.json`)).json();
  const [asset,item]=Object.entries(m.entries).filter(([p,v])=>p.startsWith('/assets/local/map/autochess/')&&p.endsWith('.png')&&v.bytes>0).sort((a,b)=>a[1].bytes-b[1].bytes)[0];
  const response=await fetch(`/_build/${g}${asset}`),body=await response.arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return{controlled:!!navigator.serviceWorker.controller,asset,source:response.headers.get('x-sp-resource-source'),status:response.status,bytes:body.byteLength,hash,expectedHash:item.hash,expectedBytes:item.bytes,mappings:m.cdn.mappedResources,boardEntries:local.count};
 });
 assert.equal(r2.status,200);assert.equal(r2.hash,r2.expectedHash);assert.equal(r2.bytes,r2.expectedBytes);assert.equal(r2.mappings,12881);assert.equal(r2.boardEntries,74);assert.equal(r2.source,'r2');report.r2=r2;
 await req(host,'room.leave');report.testRoomRemoved=true;
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report));
}finally{
 for(const page of pages){try{await req(page,'room.leave');}catch{}}
 await browser.close();writeFileSync(path.join(out,'live-browser.json'),JSON.stringify(report,null,2));
}
