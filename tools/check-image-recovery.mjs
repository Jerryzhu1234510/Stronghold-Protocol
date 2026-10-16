import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startServer } from '../server/index.js';
const server=await startServer({host:'127.0.0.1',port:0,quiet:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={errors:[],requests:[]};
const counts=new Map();
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6b0AAAAASUVORK5CYII=','base64');
try{
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.setCacheEnabled(false);await page.setRequestInterception(true);
 page.on('request',req=>{
   const u=new URL(req.url());
   if(!u.pathname.startsWith('/assets/retry-test-'))return req.continue();
   const n=(counts.get(u.pathname)||0)+1;counts.set(u.pathname,n);report.requests.push(u.pathname+u.search);
   const fail=u.pathname.includes('permanent')?n<=4:u.pathname.includes('old')||n===1;
   return req.respond(fail?{status:503,body:'temporary failure'}:{status:200,contentType:'image/png',body:pixel});
 });
 await page.goto(server.url+'/data/config.json');
 await page.evaluate(async()=>{
   const {h,render}=await import('/vendor/preact.module.js');
   const {Img}=await import('/js/ui/gameComponents.js');
   const {AvatarFrame,BondDisc}=await import('/js/ui/components.js');
   document.body.innerHTML='<div id="test"></div>';
   globalThis.show=(kind,src)=>{
     const Component={Img,AvatarFrame,BondDisc}[kind];
     render(h(Component,{src,icon:src,name:'测试',fallback:h('span',{id:'fallback'},'占位图')}),document.querySelector('#test'));
   };
   globalThis.unmount=()=>render(null,document.querySelector('#test'));
 });
 for(const kind of ['Img','AvatarFrame','BondDisc']){
   const src='/assets/retry-test-'+kind+'.png';await page.evaluate(({kind,src})=>globalThis.show(kind,src),{kind,src});
   await page.waitForFunction(()=>document.querySelector('#test img')?.naturalWidth===1,{timeout:5000});
   assert.equal(counts.get(src),2);await page.evaluate(()=>globalThis.unmount());
 }
 report.shopAvatarBondRecovery=true;
 const permanent='/assets/retry-test-permanent.png';await page.evaluate(src=>globalThis.show('Img',src),permanent);
 await page.waitForFunction(()=>document.querySelector('#fallback'));
 await new Promise(resolve=>setTimeout(resolve,14000));
 assert.equal(counts.get(permanent),4,'one initial request plus three retries');
 await page.evaluate(()=>dispatchEvent(new Event('online')));
 await page.waitForFunction(()=>document.querySelector('#test img')?.naturalWidth===1,{timeout:3000});
 assert.equal(counts.get(permanent),5);report.boundedAndOnlineRecovery=true;
 const old='/assets/retry-test-old.png';await page.evaluate(src=>globalThis.show('Img',src),old);
 await page.waitForSelector('#fallback');
 await page.evaluate(()=>globalThis.show('Img','/assets/retry-test-Img.png'));
 await page.waitForFunction(()=>document.querySelector('#test img')?.naturalWidth===1);
 await new Promise(resolve=>setTimeout(resolve,1600));assert.equal(counts.get(old),1);
 report.sourceChangeCancelsRetry=true;
 await page.evaluate(()=>globalThis.show('Img','/assets/retry-test-old-unmount.png'));
 await page.waitForSelector('#fallback');await page.evaluate(()=>globalThis.unmount());
 await new Promise(resolve=>setTimeout(resolve,1600));assert.equal(counts.get('/assets/retry-test-old-unmount.png'),1);
 report.unmountCancelsRetry=true;
 assert.ok(report.requests.every(u=>!u.includes('?')));assert.deepEqual(report.errors,[]);report.pass=true;
}finally{
 await browser.close();await server.close();await fs.writeFile('../../outputs/image-recovery-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}

