import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={errors:[],checks:[]};
try {
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 for(const width of [1366,390]){
  await page.setViewport({width,height:900});
  await page.goto('https://weishuxieyi.icu/stats',{waitUntil:'networkidle2',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#network-today').textContent!=='—'&&document.querySelector('#online-players').textContent!=='—');
  const reading=await page.evaluate(()=>({today:document.querySelector('#network-today').textContent,rate:document.querySelector('#network-rate').textContent,status:document.querySelector('#network-status').textContent,online:document.querySelector('#online-players').textContent,overflow:document.documentElement.scrollWidth>innerWidth,errorHidden:document.querySelector('#error').hidden}));
  assert.ok(!reading.overflow&&reading.errorHidden); assert.match(reading.status,/今日记录不完整/);
  report.checks.push({width,...reading});
  await page.screenshot({path:`../../outputs/network-stats-${width}.png`,fullPage:true});
 }
 await page.setRequestInterception(true);
 page.on('request',req=>req.url().includes('/network-data')?req.abort():req.continue());
 await page.reload({waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.querySelector('#network-status').textContent.includes('暂不可用')&&document.querySelector('#online-players').textContent!=='—');
 report.unavailableNetworkDoesNotBlockGameStats=true;
 assert.deepEqual(report.errors,[]); report.pass=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{await browser.close();await fs.writeFile('../../outputs/network-stats-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
