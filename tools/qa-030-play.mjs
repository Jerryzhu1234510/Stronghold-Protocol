import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run']});
const page=await browser.newPage(), errors=[], bad=[];
page.on('pageerror',e=>errors.push(e.stack));
page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/assets/'))bad.push({url:r.url(),status:r.status()});});
const report={};
async function image(name,w,h){await page.setViewport({width:w,height:h});await new Promise(r=>setTimeout(r,500));await page.screenshot({path:`../qa-${name}.png`});}
try{
 await page.goto('http://127.0.0.1:27630/',{waitUntil:'networkidle2',timeout:60000});
 await page.waitForFunction(()=>!!window.__SP__);
 await page.evaluate(async()=>{const {register}=await import(`/_build/${window.__SP_GENERATION}/js/account.js`);await register({username:'qa030_'+Date.now(),password:'Local-test-only-030!',nickname:'兼容验收'});});
 await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>!!window.__SP__);
 await page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.textContent.trim()==='我知道了')b.click();});
 await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='进入大厅');if(!b)throw Error('No lobby entry');b.click();});
 await page.waitForFunction(()=>document.body.innerText.includes('创建同盟'),{timeout:20000});
 await image('030-lobby-desktop',1440,900);await image('030-lobby-ipad',1180,820);await image('030-lobby-android',915,412);
 report.account=await page.evaluate(()=>({visible:document.body.innerText.includes('兼容验收'),text:document.body.innerText.slice(0,1100)}));assert.ok(report.account.visible);
 await page.setViewport({width:1440,height:900});
 await page.evaluate(async()=>{const {net}=window.__SP__;await net.request('room.create',{mode:'coop',difficulty:'NORMAL',capacity:4,visibility:'private'});await net.request('room.setAiPicksLast',{on:true});for(let i=0;i<3;i++)await net.request('room.addBot',{});});
 await page.waitForFunction(()=>window.__SP__.store.get().room?.seats.filter(Boolean).length===4);
 await image('030-room',1440,900);
 await page.evaluate(()=>window.__SP__.net.request('room.start',{}));
 await page.waitForFunction(()=>window.__SP__.store.get().match.public?.phase==='INFO_CHECK',{timeout:20000});
 await image('030-briefing',1440,900);
 await page.evaluate(async()=>{const {net,store}=window.__SP__;await net.request('g.infoReady',{setupRevision:store.get().match.public.setupRevision??0});await net.request('g.autoplay',{on:true});});
 await page.waitForFunction(()=>['PREP','COMBAT'].includes(window.__SP__.store.get().match.public?.phase),{timeout:90000});
 await page.waitForFunction(()=>window.__SP_VIEW__?.kind==='engine',{timeout:60000});
 await image('030-play',1440,900);
 report.play=await page.evaluate(()=>({phase:window.__SP__.store.get().match.public?.phase,renderer:window.__SP_VIEW__?.kind,body:document.body.innerText.slice(0,1500)}));
 await page.waitForFunction(()=>window.__SP__.store.get().match.public?.round>=2,{timeout:180000});
 report.round=await page.evaluate(()=>window.__SP__.store.get().match.public?.round);
 await page.evaluate(()=>window.__SP__.net.request('room.leave',{}));
 assert.deepEqual(errors,[]); assert.deepEqual(bad,[]);report.ok=true;
}catch(e){report.error=e.stack;await page.screenshot({path:'../qa-030-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.errors=errors;report.bad=bad;await fs.writeFile('../qa-030-play.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
