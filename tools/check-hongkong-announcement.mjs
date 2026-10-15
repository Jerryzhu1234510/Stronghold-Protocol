import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
const text='网卡的博士可以切换至香港节点',versions=['ee4149fa116a-7','e7e0ee91198d-8','f1f917eba035-9'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={text,clients:[],pass:false};
try {
 for(const generation of versions) {
  const page=await browser.newPage();const base='/_build/'+generation+'/';
  const frames=[];const session=await page.createCDPSession();await session.send('Network.enable');
  session.on('Network.webSocketFrameReceived',e=>{try{const value=JSON.parse(e.response.payloadData);if(value.t==='server.announcement')frames.push(value);}catch{}});
  await page.goto('https://weishuxieyi.icu'+base,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>['connected','online'].includes(globalThis.__SP__?.store.get().connection.status),{timeout:60000});
  const notice=await page.evaluate(async base=>{const {announcementStore}=await import(base+'js/ui/serverAnnouncement.js');return announcementStore.get();},base);
  report.clients.push({generation,notice,frames});await page.close();
 }
 report.pass=report.clients.every(c=>c.frames.some(f=>f.announcement?.text===text));
 if(!report.pass)process.exitCode=1;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await browser.close();await fs.writeFile('../../outputs/hongkong-node-announcement/client-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
