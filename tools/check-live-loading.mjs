/* global __SP__, location */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
const output=process.argv[2];
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:process.argv.includes('--h1')?['--disable-http2','--disable-quic']:[]});
const results=[];
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});
 for(let i=0;i<2;i++) {
  const errors=[];page.removeAllListeners('pageerror');page.on('pageerror',e=>errors.push(e.message));
  const start=Date.now();await page.goto('https://weishuxieyi.icu/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>['connected','online'].includes(globalThis.__SP__?.store.get().connection.status),{timeout:60000});
  const readyMs=Date.now()-start;
  const data=await page.evaluate(async()=>{
   const start=performance.now();await __SP__.data.loadAll(['chess','bonds','items','assets','backups']);
   return {dataMs:Math.round(performance.now()-start),url:location.href,assets:performance.getEntriesByType('resource').filter(x=>/\/(assets|fonts)\//.test(x.name)).length,json:performance.getEntriesByType('resource').filter(x=>x.name.includes('/data/')).map(x=>({url:x.name.split('/').pop(),ms:Math.round(x.duration),bytes:x.transferSize})),scripts:performance.getEntriesByType('resource').filter(x=>x.initiatorType==='script').length,
    slow:performance.getEntriesByType('resource').sort((a,b)=>b.duration-a.duration).slice(0,8).map(x=>({url:x.name.split('/').pop(),ms:Math.round(x.duration),bytes:x.transferSize,protocol:x.nextHopProtocol,start:Math.round(x.startTime),response:Math.round(x.responseStart-x.startTime)}))};
  });
  results.push({round:i,readyMs,...data,errors});console.log(JSON.stringify(results.at(-1)));
 }
 if(output)await fs.writeFile(output,JSON.stringify(results,null,2));
}finally{await browser.close()}
