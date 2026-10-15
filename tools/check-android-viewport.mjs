import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const work='C:/Users/34775/Documents/Codex/2026-10-10/a';
const out=work+'/outputs/android-viewport-qa';
mkdirSync(out,{recursive:true});
const scripts=Object.fromEntries(['fit-left','fit-right','fill'].map(mode=>[mode,readFileSync(work+'/work/android-viewport-test/'+mode+'.js','utf8')]));
const server=await startServer({port:0,host:'127.0.0.1',quiet:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[],errors=[];
try {
  const page=await browser.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:960,height:432,isMobile:true,hasTouch:true,deviceScaleFactor:3});
  await page.goto(`http://127.0.0.1:${server.port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.title-screen');
  await page.evaluate(async()=>(await import('/js/screens/title.js')).enterSession('显示适配核验'));
  await page.waitForSelector('.lobby-screen');
  await page.waitForFunction(async()=>(await import('/js/store.js')).store.get().connection.status==='online');
  await page.evaluate(()=>[...document.querySelectorAll('.release-notes button')].find(e=>e.textContent.trim()==='我知道了')?.click());
  await page.evaluate(async()=>(await import('/js/net.js')).net.request('room.create',{mode:'coop',difficulty:'FUNNY',capacity:4,visibility:'private'}));
  await page.waitForSelector('.room-screen');
  const identity=async()=>page.evaluate(async()=>{
    const s=(await import('/js/store.js')).store.get();
    return{playerId:s.me.playerId,token:s.me.token,attempt:s.connection.attempt,status:s.connection.status,entered:s.session.entered,timeOrigin:performance.timeOrigin};
  });
  const session=await identity(); assert.ok(session.playerId&&session.token&&session.entered); assert.equal(session.status,'online');
  for(const [width,height,dpr] of [[960,432,3],[933,421,3],[844,390,2.625],[640,360,2],[640,320,2],[1280,720,1.5]]) {
    await page.setViewport({width,height,isMobile:true,hasTouch:true,deviceScaleFactor:dpr});
    for(const [mode,script] of Object.entries(scripts)) {
      await page.evaluate(script); await new Promise(r=>setTimeout(r,250));
      const state=await page.evaluate(()=>{
        const bounds=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
        const controls=[...document.querySelectorAll('.invite__btns button,.room-bar__right button,.seat__foot button')].map(e=>{
          const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {text:e.textContent.trim(),...bounds(e),reached:!!hit&&(e.contains(hit)||hit.contains(e))};
        });
        return{root:bounds(document.querySelector('.app-root')),screen:bounds(document.querySelector('.room-screen')),
          safeLeft:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sa-l')),
          safeRight:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sa-r')),controls};
      });
      assert.equal(state.root.x,0);assert.equal(state.root.w,width);assert.equal(state.root.h,height);
      assert.ok(Math.abs(state.screen.x-(mode==='fit-left'?144/dpr:0))<0.05);
      assert.ok(Math.abs(state.screen.right-(width-(mode==='fit-right'?144/dpr:0)))<0.05);
      for(const c of state.controls)assert.ok(c.reached&&c.x>=state.screen.x-1&&c.right<=state.screen.right+1&&c.bottom<=height+1,`${width}x${height} ${mode} ${c.text}`);
      await page.screenshot({path:`${out}/${mode}-${width}x${height}.png`});
      results.push({width,height,dpr,mode,...state});
    }
  }
  assert.deepEqual(await identity(),session,'display mode retains the current page and connection');
  for(const mode of ['fit-left','fill']) {
    const board=await browser.newPage();board.on('pageerror',e=>errors.push(e.message));
    await board.setViewport({width:960,height:432,isMobile:true,hasTouch:true,deviceScaleFactor:3});
    await board.goto(`http://127.0.0.1:${server.port}/dev/game-mock.html?shot=1&variant=bossR`,{waitUntil:'domcontentloaded'});
    await board.addStyleTag({url:`http://127.0.0.1:${server.port}/css/phone-compact.css`});
    await board.waitForFunction(()=>window.__SP_VIEW__?.raw?.debug?.camKind==='bossPrep',{timeout:60000});
    await board.evaluate(scripts[mode]);await new Promise(r=>setTimeout(r,1200));
    const state=await board.evaluate(()=>{
      const raw=window.__SP_VIEW__.raw,s=window.__MOCK__.S(),canvas=document.querySelector('.gm__field canvas'),r=canvas.getBoundingClientRect();
      return{field:raw.prepField(),canvas:{x:r.x,w:r.width},stats:raw.stats(),units:s.priv.board.filter(p=>p.kind==='chess').map(p=>{
        const v=raw.debug.views.get('p:'+p.uid);return{col:p.col,row:p.row,x:v?.x,y:v?.y,dir:v?.dir};
      })};
    });
    assert.equal(state.canvas.x,0);assert.equal(state.canvas.w,960);assert.ok(state.field.mirror);
    for(const u of state.units){assert.ok(Math.abs(u.x-(20-u.col))<0.01);assert.equal(u.dir,'LEFT');}
    const screenshot=await board.screenshot({path:`${out}/bossR-${mode}.png`,encoding:'base64'});
    const pixels=await board.evaluate(async b64=>{
      const image=new Image();image.src='data:image/png;base64,'+b64;await image.decode();
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      const data=ctx.getImageData(0,0,c.width,c.height).data;let bright=0;
      for(let i=0;i<data.length;i+=40)if(data[i]+data[i+1]+data[i+2]>120)bright++;
      return{bright,samples:data.length/40};
    },screenshot);
    assert.ok(pixels.bright>pixels.samples*0.05,'render is nonblank');
    results.push({game:true,mode,...state,pixels});await board.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(out+'/results.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({roomCases:results.filter(r=>!r.game).length,gameCases:results.filter(r=>r.game).length,errors}));
}finally{await browser.close();await server.close();}
