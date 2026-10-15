/* global window, document, innerWidth, innerHeight, getComputedStyle */
import puppeteer from 'puppeteer-core';
import {startServer} from '../server/index.js';
import {OPERATORS,MONSTERS,EQUIPMENT,data} from '../server/versus/catalog.js';
import {ownCol} from '../server/versus/engine.js';
import {versusCanStand} from '../shared/versusPlacement.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const out='D:/Codex/2026-10-10/a/outputs/versus-assault';mkdirSync(out,{recursive:true});
const report={passed:false,errors:[],maps:[]};
const server=await startServer({port:0,host:'127.0.0.1',quiet:true,seedFn:()=>81});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
const playwright=process.env.VERSUS_PLAYWRIGHT
 ? await(await import(pathToFileURL(process.env.VERSUS_PLAYWRIGHT).href)).chromium.connectOverCDP(browser.wsEndpoint()) : null;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const request=(page,t,fields={})=>page.evaluate(async(t,fields)=>(await import('/js/net.js')).net.request(t,fields),t,fields);
let page;
try {
 for(const mapVersion of ['new','classic']) {
  const context=await browser.createBrowserContext();page=await context.newPage();
  const nativeViewport=page.setViewport.bind(page),input=await page.createCDPSession();
  page.setViewport=async viewport=>{await nativeViewport({...viewport,hasTouch:false});await input.send('Emulation.setTouchEmulationEnabled',{enabled:viewport.width<=1000,maxTouchPoints:1});};
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.setViewport({width:1440,height:900});await page.goto(server.url+'/game.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.title-screen');await page.evaluate(async()=>(await import('/js/screens/title.js')).enterSession('攻守验收博士'));
  await page.waitForSelector('.lobby-screen');await page.waitForFunction(async()=>(await import('/js/store.js')).store.get().connection.status==='online');
  await page.evaluate(async()=>(await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
  await request(page,'room.create',{mode:'coop',difficulty:'NORMAL',capacity:4,visibility:'public',description:'四人攻守测试',mapVersion});
  await page.waitForSelector('.room-mode-picker select');await page.select('.room-mode-picker select','versus');
  await page.waitForFunction(async()=>(await import('/js/store.js')).store.get().room.gameMode==='versus');
  assert.equal(await page.evaluate(async()=>(await import('/js/store.js')).store.get().room.difficulty),'HARD');
  assert.ok(await page.$eval('.room-heading',e=>e.textContent.includes('绝境模拟')));
  assert.equal(await page.$eval('.room-capacity-picker select',e=>e.options.length),1);
  for(let i=0;i<3;i++)await request(page,'room.addBot');
  const code=await page.evaluate(async()=>(await import('/js/store.js')).store.get().room.code);
  await request(page,'room.start');const match=server.lobby.rooms.get(code).match;clearInterval(match.timer);
  match.game.stage=data.stages.act1autochess_m03;match.flush();
  await page.waitForSelector('.brief-bonds');assert.equal(match.phase,'INFO_CHECK');
  await page.screenshot({path:`${out}/${mapVersion}-ban.png`});await request(page,'g.infoReady');
  await page.waitForSelector('iframe[title="对抗模式（测试）"]');
  const frame=await(await page.$('iframe[title="对抗模式（测试）"]')).contentFrame();
  const nativeClick=frame.click.bind(frame);
  frame.click=async(selector,...args)=>{
   for(let attempt=0;;attempt++)try{return await nativeClick(selector,...args);}catch(e){
    if(attempt>=2||!e.message.includes('detached'))throw e;
    await pause(100);
   }
  };
  await frame.waitForFunction(()=>window.__versusView&&window.__versusState()?.field,{timeout:60000});
  const initial=await frame.evaluate(()=>window.__versusState()),p=match.players.get(initial.me.id),game=match.game;
  await page.evaluate(async()=>{const a=(await import('/js/audio.js')).audio,play=a.sfx.bind(a);window.__versusUiSounds=[];a.sfx=(sound,...args)=>{window.__versusUiSounds.push(sound);return play(sound,...args);};});
  game.players.forEach(p=>p.bot=false);const d=game.duels.find(d=>d.id===p.duel);
  if(p.role==='attack')game.beginLeg(d);
  game.status='combat';d.readyAt=game.time;match.flush();
  await frame.waitForFunction(()=>window.__versusState().me.role==='defend');
  assert.equal(initial.room.players.length,4);assert.equal(initial.room.duels.length,2);
  const checkRules=async()=>{
   await frame.click('[aria-label="对抗模式规则"]');await frame.waitForSelector('.versus-rules');
   const rules=await frame.$eval('.versus-rules',e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),entries:e.querySelectorAll('dt').length}));
   assert.equal(rules.entries,8);assert.match(rules.text,/测试版/);assert.match(rules.text,/扣血\+5/);assert.match(rules.text,/每5秒加1层/);
   assert.ok(rules.rect.y>=0&&rules.rect.bottom<=(await page.viewport()).height+1,JSON.stringify(rules.rect));
   assert.ok(await frame.$eval('.versus-rules',e=>e.querySelector('.modal__title').getBoundingClientRect().bottom<=e.querySelector('.modal__body').getBoundingClientRect().top),'rules header must not overlap body');
   await page.screenshot({path:`${out}/${mapVersion}-rules-${(await page.viewport()).width}.png`});
   await frame.click('[aria-label="关闭规则"]');await frame.waitForFunction(()=>!document.querySelector('.versus-rules'));
  };
  await checkRules();
  const card=OPERATORS.find(c=>!c.isGolden&&!game.bannedChess.has(c.id)&&c.tier<=2&&data.chess[c.id].goldenId);
  p.coins=100;p.shop.operator[0]=card.id;match.flush();
  if(await frame.$('[aria-label="展开商店"]'))await frame.click('[aria-label="展开商店"]');
  await frame.waitForSelector('.shopbar__cards .scard');
  const buy=async()=>{
   const before=p.stats.spent;
   p.shop.operator[0]=card.id;match.flush();
   await frame.waitForFunction(()=>!document.querySelector('.shopbar__cards .scard')?.classList.contains('scard--sold'));
   await frame.click('.shopbar__cards .scard');await frame.waitForSelector('.dpanel');
   await frame.click('.shopbar__cards .scard');await frame.waitForFunction(()=>!document.querySelector('.dpanel'));
   await frame.waitForFunction(()=>window.__versusState().me.shop.operator[0]===null);
   assert.ok(p.stats.spent>before);
  };
  const coins=p.coins;await frame.click('.shopbar__cards .scard');await frame.waitForSelector('.dpanel');assert.equal(p.coins,coins);
  assert.ok(await frame.$('.dgarrison__text'));
  const panel=await frame.$eval('.dpanel',e=>({width:e.offsetWidth,height:e.offsetHeight,font:getComputedStyle(e.querySelector('.dgarrison__text')).fontSize,rem:parseFloat(getComputedStyle(document.documentElement).fontSize)}));
  assert.ok(Math.abs(panel.width-panel.rem*4.9)<=1&&panel.height<860&&parseFloat(panel.font)>=10,JSON.stringify(panel));
  assert.equal(await frame.$('.versus-detail'),null,'native details must not use a custom wrapper');
  await page.screenshot({path:`${out}/${mapVersion}-native-detail.png`});
  await page.mouse.click(400,25);await frame.waitForFunction(()=>!document.querySelector('.dpanel'));await buy();
  const o=p.operators[0],b=game.battleOf(p),tiles=[];
  for(let row=2;row<=5;row++)for(let col=3;col<=9;col++)if(versusCanStand(b.grid,game.stage,row,ownCol(p,col),data.chess[o.id]))tiles.push({row,col:ownCol(p,col)});
  const tile=tiles.at(-1);
  const tilePos=async t=>frame.evaluate(t=>window.__versusView.tileScreen(t.row,t.col),t);
  const drag=async(from,to)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:15});await page.mouse.up();};
  const center=async selector=>{const box=await(await frame.$(selector)).boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};};
  await pause(300);await drag(await center('.bench-card.operator'),await tilePos(tile));await frame.waitForSelector('.fwheel');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await frame.waitForFunction(()=>window.__versusState().me.operators[0].row!=null);
  const unit=b.allyUnits.find(u=>u.uid===o.uid);unit.hp=123;const sp=unit.sp;
  await pause(350);const target=tiles.at(-2);
  const source=await tilePos(tile);
  assert.equal(await frame.evaluate(source=>window.__versusView.unitAt(source.x,source.y)?.uid,source),o.uid);
  match.flush();await pause(200);await page.mouse.click(source.x,source.y);await frame.waitForSelector('[data-live="battle"]');
  assert.ok(await frame.$eval('.dhp',e=>e.textContent.includes('123')));
  const liveBefore=await frame.$eval('.dstats',e=>e.textContent);
  b.addBuff(unit,{key:'qa:live',mods:{atkPct:.5},persist:true});unit.hp=124;match.flush();
  await frame.waitForFunction(()=>document.querySelector('.dhp')?.textContent.includes('124'));
  assert.notEqual(await frame.$eval('.dstats',e=>e.textContent),liveBefore);
  await page.screenshot({path:`${out}/${mapVersion}-live-operator.png`});
  b.removeBuff(unit,'qa:live');unit.hp=123;match.flush();await frame.click('.dpanel__close');
  await drag(source,await tilePos(target));
  await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
  await frame.waitForFunction((uid,row,col)=>{const state=window.__versusState(),o=state.me.operators.find(o=>o.uid===uid);return o?.row===row&&o.col===(state.me.side==='R'?20-col:col);},{},o.uid,target.row,target.col);
  assert.equal(unit.tileC,target.col);assert.equal(unit.hp,123);assert.equal(unit.sp,sp);
  assert.equal(unit.dir,'LEFT');assert.equal(o.dir,p.side==='R'?'RIGHT':'LEFT');
  await buy();const second=p.operators.find(o=>o.row==null);await pause(250);
  await drag(await center(`.bench-card.operator[data-uid="${second.uid}"]`),await tilePos(target));await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row===null,{},o.uid);
  assert.equal(second.row,target.row);
  p.items.push({uid:game.nextUid++,id:EQUIPMENT[0].id});match.flush();await frame.waitForSelector('.bench-card.equipment');await pause(250);
  await frame.waitForFunction(()=>[...window.__versusView.debug.views.values()].some(v=>v.info.kind==='item'&&v.info.icon&&v.root.visible&&v.bounds().width>10));
  await drag(await center('.bench-card.equipment'),await tilePos(target));
  await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.items.length===1,{},second.uid);
  await frame.waitForFunction(uid=>[...window.__versusView.debug.views.values()].some(v=>!v._inventory&&v.info.uid===uid&&v.itemPips?.length===1&&v.itemPips[0].visible&&v.itemPips[0]._url),{},second.uid);
  assert.ok(await page.evaluate(()=>['buy','drop','equip'].every(sound=>window.__versusUiSounds.includes(sound))));
  for(const row of [0,1]){
    await pause(200);await drag(await tilePos(target),await tilePos({row,col:ownCol(p,7)}));
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row===null,{},second.uid);
    assert.equal(await frame.$('.fwheel'),null);
    await frame.waitForFunction(uid=>window.__versusView.debug.views.get(`b:${uid}`)?.itemPips?.length===1,{},second.uid);
    await pause(200);await drag(await center(`.bench-card.operator[data-uid="${second.uid}"]`),await tilePos(target));
    await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row!==null,{},second.uid);
  }
  const inspect=async(role)=>{
   for(const [width,height] of [[1440,900],[844,390],[568,320]]){
    await page.setViewport({width,height,deviceScaleFactor:width<=1000?2:1,hasTouch:width<=1000});await pause(500);
    await checkRules();
    if(width<=1000&&await frame.$('[aria-label="收起盟约"]')){await frame.click('[aria-label="收起盟约"]');await pause(200);}
    if(await frame.$('[aria-label="展开商店"]'))await frame.click('[aria-label="展开商店"]');
    await frame.waitForFunction(()=>{const row=document.querySelector('.shopbar__row')?.getBoundingClientRect();return row&&row.height>=35&&row.bottom<=innerHeight+1;});
    const bounds=await frame.$$eval('.shopbar__row,.shopbar__tools,.funds,.shopbar .scard',es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
    assert.ok(bounds.every(r=>r.x>=-1&&r.y>=0&&r.right<=width+1&&r.bottom<=height+1),JSON.stringify(bounds));
    assert.ok(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await frame.$('.toast'),null,'successful native commands must not report audio or interaction errors');
    const bondBounds=await frame.evaluate(()=>{const a=document.querySelector('.workspace').getBoundingClientRect(),b=document.querySelector('.gm__bonds').getBoundingClientRect(),c=document.querySelector('.shopbar').getBoundingClientRect();return {mapBottom:a.bottom,bondTop:b.top,bondBottom:b.bottom,shopTop:c.top};});
    assert.ok(bondBounds.bondTop<bondBounds.mapBottom/2&&bondBounds.bondBottom<bondBounds.mapBottom&&Math.abs(bondBounds.mapBottom-bondBounds.shopTop)<=1,JSON.stringify(bondBounds));
    const active=await frame.evaluate(()=>{const s=window.__versusState();return Object.entries(s.field.bonds).filter(([,b])=>b.count>0&&b.active).map(([id])=>id);});
    for(const id of active)assert.ok(await frame.$(`.bslot[data-bond="${id}"].is-active .bond`),`missing active bond ${id}`);
    assert.equal(await frame.$('.shell>.bond-strip'),null,'bonds must not occupy a band above the shop');
    const bondPosition=await frame.$eval('.gm__bonds',e=>{const r=e.getBoundingClientRect(),hud=e.parentElement.getBoundingClientRect(),rem=parseFloat(getComputedStyle(document.documentElement).fontSize);return {left:r.left-hud.left,top:r.top-hud.top,rem};});
    assert.ok(Math.abs(bondPosition.left-1.56*bondPosition.rem)<1&&Math.abs(bondPosition.top-1.36*bondPosition.rem)<1,'bonds use the original normal-mode position');
    if(role==='defend'){
      const priorStatus=game.status;game.status='preparation';match.flush();
      await frame.waitForFunction(()=>window.__versusState().room.status==='preparation');
      if(await frame.$('[aria-label="展开盟约"]'))await frame.click('[aria-label="展开盟约"]');
      await pause(250);
      const clearance=await frame.evaluate(()=>{
        const v=window.__versusView,field=document.querySelector('.field').getBoundingClientRect(),bonds=document.querySelector('.gm__bond-list').getBoundingClientRect();
        const models=[...v.debug.views.values()].filter(m=>!m._inventory&&m.info.kind==='op'&&m.root?.visible&&m.spineReady).map(m=>{const b=m.bounds();return {uid:m.info.uid,top:field.top+b.y,height:b.height};});
        const tiles=[];for(let row=2;row<=5;row++)for(let c=3;c<=9;c++){const col=window.__versusState().field.side==='R'?20-c:c,t=v.tileScreen(row,col);if(t.x>=0&&t.x<innerWidth&&t.y>=0&&t.y<innerHeight)tiles.push(document.elementFromPoint(t.x,t.y)?.tagName);}
        return {models,bondBottom:bonds.bottom,tiles,scale:v.debug.cam.scale};
      });
      assert.ok(clearance.models.length>0&&clearance.models.every(m=>m.top>=clearance.bondBottom),JSON.stringify(clearance));
      assert.ok(clearance.tiles.length>0&&clearance.tiles.every(tag=>tag==='CANVAS'),'expanded bonds must not intercept defender deployment tiles');
      await page.screenshot({path:`${out}/${mapVersion}-native-bonds-preparation-${width}.png`});
      game.status=priorStatus;match.flush();
      if(width<=1000){await frame.click('[aria-label="收起盟约"]');await pause(200);}
    }
    assert.ok(await frame.$eval('canvas',e=>e.width>0&&e.height>0));
    if(role==='defend'&&width<=1000){
      const metrics=await frame.evaluate(uid=>{
        const debug=window.__versusView.debug,model=[...debug.views.values()].find(v=>v.info.uid===uid);
        const bounds=model?.bounds(),pixels=debug.app.renderer.extract.pixels(debug.app.stage),colors=new Set();
        let opaque=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0){opaque++;colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);}
        return {scale:debug.cam.scale,bounds,spineReady:model?.spineReady,opaque,colors:colors.size};
      },second.uid);
      assert.ok(metrics.scale>=(width===568?30:36)&&metrics.scale<=60,`unreadable phone scale ${metrics.scale}`);
      assert.ok(metrics.bounds?.height>=35&&metrics.bounds.y>=0,JSON.stringify(metrics));
      assert.ok(metrics.spineReady&&metrics.opaque>1000&&metrics.colors>20,JSON.stringify(metrics));
      report.phoneMetrics ||= [];report.phoneMetrics.push({mapVersion,width,height,...metrics});
    }
    const benchBounds=await frame.evaluate(()=>{const map=document.querySelector('.workspace').getBoundingClientRect();return [...document.querySelectorAll('.bench-slot')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,mapBottom:map.bottom};});});
    assert.ok(benchBounds.every(r=>r.y>=30&&r.bottom<=r.mapBottom&&r.x>=0&&r.right<=width),JSON.stringify(benchBounds));
    assert.equal(await frame.$('.topbar h1'),null,'branding must not consume the battle header');
    if(width<=1000)assert.ok(await frame.evaluate(()=>{const d=window.__versusView.debug,r=d.app.renderer.resolution;return r>=2&&[...d.views.values()].every(v=>!v.versusOutline||v.versusOutline.resolution===r);}),
      'both native renderer and PvP outlines must use the phone pixel density');
    await page.screenshot({path:`${out}/${mapVersion}-${role}-${width}x${height}.png`});
    if(playwright){
      const pwPage=playwright.contexts().flatMap(c=>c.pages()).find(p=>p.url()===page.url());
      const pwFrame=pwPage.frames().find(f=>f.url().includes('versus.html'));
      const rendered=await pwFrame.evaluate(()=>{const d=window.__versusView.debug,pixels=d.app.renderer.extract.pixels(d.app.stage);let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])opaque++;return {opaque,models:[...d.views.values()].filter(v=>v.root?.visible&&v.spineReady).length};});
      assert.ok(rendered.opaque>1000&&rendered.models>0,JSON.stringify(rendered));
      await pwPage.screenshot({path:`${out}/${mapVersion}-${role}-${width}x${height}-playwright.png`});
      report.playwright=true;
    }
    if(role==='defend'&&width===844){
      const fresh=OPERATORS.find(c=>!c.isGolden&&c.tier<=2&&!game.bannedChess.has(c.id)&&!p.operators.some(o=>o.id===c.id));
      p.coins=100;p.shop.operator[0]=fresh.id;match.flush();
      await frame.waitForFunction(id=>window.__versusState().me.shop.operator[0]===id,{},fresh.id);
      await frame.click('.shopbar__cards .scard');await frame.waitForSelector('.dpanel');
      const detailMetrics=await frame.$eval('.dpanel',e=>{const a=e.getBoundingClientRect(),s=e.querySelector('.dstats'),r=e.querySelector('.drange');return {height:a.height,width:a.width,rem:parseFloat(getComputedStyle(document.documentElement).fontSize),stats:s.getBoundingClientRect().toJSON(),range:r.getBoundingClientRect().toJSON(),trait:e.querySelector('.dgarrison').getBoundingClientRect().toJSON(),shopTop:document.querySelector('.shopbar').getBoundingClientRect().top};});
      assert.ok(detailMetrics.height>250&&Math.abs(detailMetrics.width-detailMetrics.rem*4.9)<=1,JSON.stringify(detailMetrics));
      assert.ok(Math.abs(detailMetrics.stats.y-detailMetrics.range.y)<3,'native stats and range must stay side by side');
      assert.ok(detailMetrics.trait.bottom<detailMetrics.shopTop&&detailMetrics.stats.bottom<detailMetrics.shopTop,
        'native traits and stats must be visible immediately, without scrolling past the shop');
      await page.screenshot({path:`${out}/${mapVersion}-phone-native-detail.png`});
      await frame.click('.shopbar__cards .scard');await frame.waitForFunction(()=>!document.querySelector('.dpanel'));
      await frame.waitForFunction(id=>window.__versusState().me.operators.some(o=>o.id===id&&o.row==null),{},fresh.id);
      const bought=p.operators.find(o=>o.id===fresh.id&&o.row==null);
      await frame.waitForFunction(uid=>window.__versusView.debug.views.get(`b:${uid}`)?.spineReady,{},bought.uid);
      let available;
      for(let row=2;row<=5&&!available;row++)for(let col=3;col<=9;col++){
        const world=ownCol(p,col);
        if(versusCanStand(b.grid,game.stage,row,world,data.chess[bought.id])&&!p.operators.some(o=>o.row===row&&o.col===col)){available={row,col:world};break;}
      }
      assert.ok(available,'the newly bought operator has a legal deployment tile');
      const from=await center(`.bench-card.operator[data-uid="${bought.uid}"]`),to=await tilePos(available);
      const touch=await page.touchscreen.touchStart(from.x,from.y);
      for(let step=1;step<=12;step++)await touch.move(from.x+(to.x-from.x)*step/12,from.y+(to.y-from.y)*step/12);
      await touch.end();await frame.waitForSelector('.fwheel');
      await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
      await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row!=null,{},bought.uid);
      assert.equal(await frame.$('.shopbar-tab'),null,'buy and deploy must not fold the shop');
      await page.screenshot({path:`${out}/${mapVersion}-phone-buy-deploy-open.png`});
      game.action(p,{action:'withdraw',uid:bought.uid});match.flush();
    }
    if(role==='attack'&&width===844){
      if(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')==='true'))await frame.click('[aria-label="大地图"]');
      p.coins=100;p.shop.monster[0]=MONSTERS[0].id;match.flush();
      await frame.waitForFunction(id=>window.__versusState().me.shop.monster[0]===id,{},MONSTERS[0].id);
      await frame.click('.shop-offer.monster .scard');await frame.waitForSelector('.dpanel');
      await frame.click('.shop-offer.monster .scard');await frame.waitForFunction(()=>!document.querySelector('.dpanel'));
      await frame.waitForSelector('.bench-card.monster');
      await frame.waitForFunction(()=>[...window.__versusView.debug.views.values()].some(v=>v._inventory&&v.info.kind==='enemy'&&v.spineReady));
      const localBench=await frame.$eval('.bench-slot',e=>e.getBoundingClientRect().toJSON());
      assert.ok(localBench.bottom<height-100,JSON.stringify(localBench));
      let launch;for(let row=2;row<=5&&!launch;row++)for(const col of game.launchColumns(p))if(game.battleOf(opponent).grid.groundPassable(row,col)){launch={row,col};break;}
      await pause(300);
      const from=await center('.bench-card.monster'),to=await tilePos(launch);
      const hit=await frame.evaluate(({from,to})=>({from:document.elementFromPoint(from.x,from.y)?.outerHTML.slice(0,300),to:document.elementFromPoint(to.x,to.y)?.tagName,tile:window.__versusView.tileAt(to.x,to.y)}),{from,to});
      assert.deepEqual({row:hit.tile?.row,col:hit.tile?.col},launch,JSON.stringify({from,to,hit,launch}));
      assert.equal(hit.to,'CANVAS',JSON.stringify({from,to,hit,launch}));
      const touch=await page.touchscreen.touchStart(from.x,from.y);
      for(let step=1;step<=12;step++)await touch.move(from.x+(to.x-from.x)*step/12,from.y+(to.y-from.y)*step/12);
      await touch.end();await frame.waitForFunction(()=>Object.keys(window.__versusState().me.monsters).length===0);
      assert.equal(await frame.$('.shopbar-tab'),null,'launching monsters must not fold the shop');
      assert.equal(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')),'false');
      await page.screenshot({path:`${out}/${mapVersion}-phone-buy-launch-open.png`});
    }
    if(role==='defend'&&width<=1000){
      await frame.click('[aria-label="收起商店"]');await pause(350);
      await page.screenshot({path:`${out}/${mapVersion}-${role}-folded-${width}x${height}.png`});
      await frame.click('[aria-label="展开商店"]');await pause(350);
    }
   }
  };
  await inspect('defend');await page.setViewport({width:1440,height:900});
  p.level=6;game.refresh(p,false);match.flush();await pause(200);await inspect('defend-max');
  assert.equal(await frame.$$eval('.shopbar__cards>.scard,.shopbar__cards>.scard-wrap',es=>es.length),10);
  assert.equal(await frame.$$eval('.shopbar__item .scard',es=>es.length),1);
  p.level=1;game.refresh(p,false);match.flush();await page.setViewport({width:1440,height:900});
  await buy();assert.equal(p.stats.merges,1);await frame.waitForSelector('.shopbar__reward');
  await page.screenshot({path:`${out}/${mapVersion}-native-merge.png`});
  await frame.click('.shopbar__rwcards .scard');await frame.click('.shopbar__rwcards .scard');await frame.waitForFunction(()=>!window.__versusState().me.rewardOffer);
  const clemnt=game.acquireOperator(p,'chess_char_4_27_a');
  game.action(p,{action:'deploy',uid:clemnt.uid,row:2,col:ownCol(p,4),dir:'RIGHT'});match.flush();
  const caster=b.allyUnits.find(u=>u.uid===clemnt.uid&&u.kind==='op');
  assert.equal(caster.skill.id,'skchr_clemnt_2');
  await frame.waitForFunction(uid=>[...window.__versusView.debug.views.values()].some(v=>v.info.uid===uid&&v.spineReady),{},clemnt.uid);
  for(const [width,height] of [[1440,900],[568,320]]){
   await page.setViewport({width,height});await pause(400);
   caster.skill.stop();caster.skill.charges=1;assert.ok(caster.skill.activate('test',{free:true}));
   for(let i=0;i<48;i++)b.step();match.flush();
   await frame.waitForFunction(()=>window.__versusView.debug.fx.zones.some(z=>String(z.key).startsWith('clemnt:vortex:')),{timeout:5000});
   const pixels=async()=>frame.evaluate(()=>{
    const {fx,app}=window.__versusView.debug,z=fx.zones.find(z=>String(z.key).startsWith('clemnt:vortex:'));
    if(!z)return null;
    const pixels=app.renderer.extract.pixels(z.swirl);let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0)colored++;
    return {colored,points:[...z.swirl.geometry.points],width:z.swirl.getBounds().width,height:z.swirl.getBounds().height};
   });
   await pause(100);const first=await pixels();assert.ok(first?.colored>50&&first.width>25&&first.height>10,JSON.stringify(first));
   await page.screenshot({path:`${out}/${mapVersion}-vortex-${width}.png`});await pause(100);
   const second=await pixels();assert.ok(second?.colored>50);assert.notDeepEqual(first.points,second.points,'water spiral must rotate');
   await pause(1100);assert.equal(await frame.evaluate(()=>window.__versusView.debug.fx.zones.some(z=>String(z.key).startsWith('clemnt:vortex:'))),false);
  }
  await page.setViewport({width:1440,height:900});
  // Force a new attack assignment to inspect its UI independently of the game's tournament result.
  game.setRole(p,'attack');const opponent=d.pair.find(o=>o!==p);game.setRole(opponent,'defend');
  d.battles=d.pair.map(p=>game.makeBattle(p,d));d.leg++;d.readyAt=game.time;match.flush();
  await frame.waitForFunction(()=>window.__versusState().me.role==='attack');
  if(await frame.$('[aria-label="展开商店"]'))await frame.click('[aria-label="展开商店"]');
  assert.equal(await frame.$('.shopbar__item'),null);assert.equal(await frame.$('.shopbar__cards>.scard'),null);
  p.shop.monster[0]=MONSTERS[0].id;p.coins=100;match.flush();await pause(300);
  await frame.click('.shop-offer.monster .scard');await frame.click('.shop-offer.monster .scard');await frame.waitForSelector('.bench-card.monster');
  let launch;for(let row=2;row<=5&&!launch;row++)for(const col of game.launchColumns(p))if(game.battleOf(opponent).grid.groundPassable(row,col)) {launch={row,col};break;}
  await frame.click('.bench-card.monster');await frame.click('.dpanel__close');await pause(100);
  const pos=await tilePos(launch);await page.mouse.click(pos.x,pos.y);await frame.waitForFunction(()=>Object.keys(window.__versusState().me.monsters).length===0);
  const enemies=game.battleOf(opponent).aliveEnemies();assert.equal(enemies.filter(u=>u.sourcePlayerId===p.id).length,2);
  const enemy=enemies[0],before=[enemy.x,enemy.y];for(let i=0;i<45;i++)game.tick();match.flush();assert.notDeepEqual([enemy.x,enemy.y],before);
  await pause(350);
  const enemyPoint=await frame.evaluate(defId=>{
   const v=[...window.__versusView.debug.views.values()].find(v=>v.info.kind==='enemy'&&v.info.defId===defId),r=v?.bounds();
   if(!r)return null;
   for(let y=r.y+2;y<r.y+r.height;y+=3)for(let x=r.x+2;x<r.x+r.width;x+=3)if(window.__versusView.unitAt(x,y)?.kind==='enemy')return {x,y};
   return null;
  },enemy.defId);
  assert.ok(enemyPoint,'enemy can be clicked');await page.mouse.click(enemyPoint.x,enemyPoint.y);await frame.waitForSelector('[data-live="battle"]');
  assert.equal(await frame.$('.uframe'),null,'enemy detail is read-only');
  await page.screenshot({path:`${out}/${mapVersion}-live-monster.png`});await frame.click('.dpanel__close');
  await frame.click('[aria-label="大地图"]');await pause(400);assert.ok(await frame.evaluate(()=>window.__versusState().field.overview.meta.units.some(u=>u.sourcePlayerId)));
  await inspect('attack');
  p.level=6;game.refresh(p,false);match.flush();await inspect('attack-max');
  assert.equal(await frame.$$eval('.shopbar__cards .shop-offer',es=>es.length),10);
  const screenshot=await page.screenshot();assert.ok(new Set(screenshot).size>100);
  await page.setViewport({width:1440,height:900});game.round=0;game.history=[];game.players.forEach(p=>{p.eliminated=false;p.placement=null;});game.beginStage([...game.players]);
  game.status='combat';
  for(const duel of game.duels){duel.elapsed=480;game.resolveDuel(duel);assert.equal(duel.leg,2);assert.equal(duel.done,false);duel.elapsed=480;game.resolveDuel(duel);}
  game.tick();assert.equal(game.round,2);assert.equal(game.duels.length,1);
  const final=game.duels[0];final.elapsed=480;game.resolveDuel(final);final.elapsed=480;game.resolveDuel(final);game.tick();match.flush();
  await frame.waitForSelector('.versus-result');await frame.waitForFunction(()=>window.__versusState().room.status==='complete');
  assert.deepEqual(game.publicView().results.map(p=>p.placement),[1,2,3,3]);
  const activeResultIds=['soloShip',...Object.keys(data.bonds).filter(id=>!data.bonds[id].noStack).slice(0,8)];
  const inactiveResultId=Object.keys(data.bonds).find(id=>!activeResultIds.includes(id)&&!data.bonds[id].noStack);
  for(const player of game.players){
   const defense=player.role==='defend'?player:player.roleBanks.defend;
   defense.bonds=Object.fromEntries([...activeResultIds.map((id,i)=>[id,{active:true,count:3,layers:i}]),[inactiveResultId,{active:false,count:1,layers:200}]]);
  }
  match.flush();
  await frame.waitForFunction(()=>document.querySelector('.result-bonds')?.children.length===9);
  for(const [width,height] of [[1440,900],[844,390],[568,320]]){
   await page.setViewport({width,height,deviceScaleFactor:width<=1000?2:1});await pause(200);
   const rows=await frame.$$eval('.result-bonds',es=>es.map(e=>[...e.children].map(b=>({id:b.dataset.bond,text:b.textContent,rect:b.getBoundingClientRect().toJSON()}))));
   for(const row of rows){
    assert.deepEqual(row.map(b=>b.id).sort(),[...activeResultIds].sort());
    assert.equal(row.find(b=>b.id==='soloShip').text,data.bonds.soloShip.name,'native hidden-layer bonds must not print a stack count');
    assert.ok(row.every(b=>b.rect.x>=0&&b.rect.right<=width+1),'all active result bonds wrap within the viewport');
   }
   await page.screenshot({path:`${out}/${mapVersion}-settlement-bonds-${width}.png`});
  }
  await page.screenshot({path:`${out}/${mapVersion}-settlement.png`});
  await page.evaluate(async bonds=>{
   const {h,render}=await import('/vendor/preact.module.js');
   const {ResultScreen}=await import('/js/screens/result.js');
   const host=document.createElement('div');host.id='qa-native-result';host.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(host);
   render(h(ResultScreen,{archive:{myId:'qa',result:{victory:true,roundsPassed:14,players:[{playerId:'qa',name:'盟约结算验收',seat:1,alive:true,lp:20,lineup:[],bonds,stats:{}}]}}}),host);
  },[...activeResultIds.map((bondId,i)=>({bondId,active:true,layers:i})),{bondId:inactiveResultId,active:false,layers:200}]);
  await page.waitForSelector('#qa-native-result .rbond');
  for(const [width,height] of [[1440,900],[844,390],[568,320]]){
   await page.setViewport({width,height});await pause(200);
   const bonds=await page.$$eval('#qa-native-result .rbond',es=>es.map(e=>({id:e.dataset.bond,number:e.querySelector('.num')?.textContent,rect:e.getBoundingClientRect().toJSON()})));
   assert.deepEqual(bonds.map(b=>b.id).sort(),[...activeResultIds].sort());
   assert.equal(bonds.find(b=>b.id==='soloShip').number,undefined);
   assert.ok(bonds.every(b=>b.rect.x>=0&&b.rect.right<=width+1));
   await page.screenshot({path:`${out}/${mapVersion}-native-settlement-bonds-${width}.png`});
  }
  await page.evaluate(async()=>{const {render}=await import('/vendor/preact.module.js');const host=document.getElementById('qa-native-result');render(null,host);host.remove();});
  report.maps.push({mapVersion,passed:true,roles:true,twoTap:true,nativeShop:true,nativeDetailLayout:true,mobileBuyDeployOpen:true,mobileBuyLaunchOpen:true,highDpiOutlines:true,maxShopSlots:11,drag:true,withdrawRows:[0,1],moveFacing:true,replacement:true,equipment:true,equipmentPips:true,bondBand:true,mergeReward:true,batchLaunch:2,viewports:3,tournament:true,settlement:true,activeResultBonds:9,inactiveResultBondsHidden:true,rules:true,liveStats:true,vortex:true});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
} catch(e){report.failure=e.stack;console.error(e);if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{writeFileSync(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
console.log(JSON.stringify(report,null,2));
