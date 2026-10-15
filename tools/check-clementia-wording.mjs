import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const out=path.resolve('../../outputs/clementia-wording');
const plan=JSON.parse(await fs.readFile(path.join(out,'plan.json'),'utf8'));
const preview=process.argv.includes('--preview');
const origin='https://weishuxieyi.icu', base=`/_build/${plan.gen}/`;
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={preview,pass:false,viewports:[]};
try {
  for (const [width,height] of [[1440,900],[844,390]]) {
    const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
    await page.setViewport({width,height});page.on('pageerror',e=>errors.push(e.message));
    if(preview) {
      await page.setBypassServiceWorker(true);await page.setRequestInterception(true);
      page.on('request',async request=>{
        const url=new URL(request.url());
        if(url.origin===origin) {
          if(url.pathname===base) return request.respond({status:200,contentType:'text/html; charset=utf-8',body:await fs.readFile(path.join(out,'index.after.html'),'utf8')});
          const key=Object.keys(plan.paths).find(key=>plan.paths[key]===url.pathname);
          if(key)return request.respond({status:200,contentType:key==='garrisons'?'application/json; charset=utf-8':'application/javascript; charset=utf-8',body:await fs.readFile(path.join(out,plan.files[key]),'utf8')});
        }
        return request.continue();
      });
    }
    await page.goto(origin+base,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector('.release-notes__changes',{timeout:60000});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.modal')).position==='fixed', {timeout:60000});
    const announcement=await page.$eval('.release-notes__changes li',el=>el.textContent);
    assert.ok(announcement.includes('克莱门莎所属的已激活盟约各+1层'));
    assert.ok(announcement.includes('此特质不授予其他干员'));
    await page.screenshot({path:path.join(out,`${preview?'preview':'live'}-announcement-${width}.png`)});
    const descriptions=await page.evaluate(async ()=>{
      const d=globalThis.__SP__.data;await d.loadAll(['garrisons']);
      return ['garrison_4231_a','garrison_4231_b'].map(id=>d.lookup('garrisons',id)?.desc);
    });
    for(let i=0;i<2;i++) {
      assert.ok(descriptions[i]?.includes(`每累计击败${i===0?4:3}个敌人`));
      assert.ok(descriptions[i].includes('克莱门莎所属的已激活盟约'));
      assert.ok(descriptions[i].includes('此特质不授予其他干员'));
    }
    assert.deepEqual(errors,[]);report.viewports.push({width,height,announcement,descriptions,errors});
    await context.close();
  }
  report.pass=true;console.log(JSON.stringify({pass:true,preview,viewports:report.viewports.length}));
}finally {
  await browser.close();await fs.writeFile(path.join(out,preview?'preview.json':'live-browser.json'),JSON.stringify(report,null,2));
}
