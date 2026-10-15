/* global window, document */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from '../server/index.js';
const out=resolve('.cache/watch-healing-qa');mkdirSync(out,{recursive:true});
const server=await startServer({port:0,host:'127.0.0.1',quiet:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const report={errors:[],views:[]};
try {
  for(const [width,height]of [[1440,900],[844,390]]){
    const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.setViewport({width,height});
    await page.goto(`${server.url}/dev/render-demo.html?scene=normal-m01&t=18&panel=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__demo?.ready||window.__demo?.error,{timeout:60000});
    assert.equal(await page.evaluate(()=>window.__demo.error||null),null);
    await new Promise(r=>setTimeout(r,5000));
    const result=await page.evaluate(async()=>{
      const {view}=window.__demo;const {ctx,fx,views,app}=view.debug;
      window.__demo.pause();
      const entry=[...views.values()].find(v=>v.alive&&v.kind==='op')||[...views.values()].find(v=>v.alive);
      if(!entry)throw new Error('no live model in the scene');
      const key=entry.id;
      const camera=ctx.cam(),project=camera.project.bind(camera);
      camera.project=()=>({x:200,y:150,s:1e8});
      for(let i=0;i<100;i++)fx.heal(entry,100);
      camera.project=project;
      const bounded=fx.parts.every(p=>Number.isFinite(p.s0)&&p.s0<2);
      app.renderer.render(app.stage);
      const bounds=app.stage.getBounds();
      const safeBounds=bounds.width<app.screen.width*8&&bounds.height<app.screen.height*8;
      const pixels=app.renderer.extract.pixels();
      let white=0,visible=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>0)visible++;if(pixels[i]>245&&pixels[i+1]>245&&pixels[i+2]>245)white++;}
      // Returning to preparation must clear every watched-field visual and leave an editable own board.
      view.setPrep({hand:[],board:[],temp:[],loadout:{},funds:0,deployCap:8,deployCount:0},{editable:true});
      const cleared=fx.parts.length===0&&fx.projs.length===0&&fx.tintSprite.alpha===0;
      return {key,bounded,safeBounds,whiteRatio:white/Math.max(1,visible),visible,cleared,mode:view.mode,stats:view.stats()};
    });
    assert.ok(result.bounded);assert.ok(result.safeBounds,JSON.stringify(result));assert.ok(result.visible>1000);assert.ok(result.whiteRatio<.1,JSON.stringify(result));
    assert.ok(result.cleared);assert.equal(result.mode,'prep');
    await page.screenshot({path:`${out}/returned-${width}x${height}.png`});
    report.views.push({width,height,...result});await page.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
} finally {writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
