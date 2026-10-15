/* global window, document, Image, innerWidth, innerHeight, getComputedStyle */
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { data, MONSTERS, EQUIPMENT } from '../server/versus/catalog.js';
import { ownCol } from '../server/versus/engine.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'D:/Codex/2026-10-10/a/outputs/versus-integrated';
mkdirSync(out, { recursive: true });
const report = { errors: [], maps: [], passed: false };
let lastPage, lastFrame;
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, seedFn: () => 81 });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const pause = ms => new Promise(r => setTimeout(r, ms));
const request = (page, t, fields = {}) => page.evaluate(async (t, fields) => (await import('/js/net.js')).net.request(t, fields), t, fields);
try {
  for (const [mapVersion, stageId] of [['new','act1autochess_m03'], ['classic','act1autochess_m03']]) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    lastPage = page;
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    page.on('console', msg => { if (/shader|ERROR:|GLSL|precision/.test(msg.text())) console.log(msg.text()); });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url + '/game.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-screen');
    await page.evaluate(async () => (await import('/js/screens/title.js')).enterSession('对抗测试博士'));
    await page.waitForSelector('.lobby-screen');
    await page.waitForFunction(async () => (await import('/js/store.js')).store.get().connection.status === 'online');
    await page.evaluate(async () => (await import('/js/ui/releaseNotes.js')).closeReleaseNotes());
    await request(page, 'room.create', { mode: 'coop', difficulty: 'NORMAL', capacity: 4, visibility: 'public', description: '对抗模式（测试）本地验收', mapVersion });
    await page.waitForSelector('.room-mode-picker select');
    assert.ok(await page.$eval('.room-mode-picker select', e => e.textContent.includes('对抗测试')));
    await page.select('.room-mode-picker select', 'versus');
    await page.waitForFunction(async () => (await import('/js/store.js')).store.get().room.gameMode === 'versus');
    const denied = await page.evaluate(async () => {
      try { await (await import('/js/net.js')).net.request('room.start'); return null; } catch (e) { return e.code; }
    });
    assert.equal(denied, 'NOT_READY');
    await request(page, 'room.setCapacity', { capacity: 8, experimentalAccepted: true });
    for (let i = 0; i < 7; i++) await request(page, 'room.addBot');
    const code = await page.evaluate(async () => (await import('/js/store.js')).store.get().room.code);
    for (const [width,height] of [[1440,900],[844,390],[568,320]]) {
      await page.setViewport({ width,height }); await pause(250);
      await page.screenshot({ path: `${out}/${mapVersion}-room-${width}x${height}.png` });
    }
    await page.setViewport({ width:1440,height:900 });
    await request(page, 'room.start');
    const match = server.lobby.rooms.get(code).match;
    match.game.stage = data.stages[stageId]; match.flush();
    await page.waitForSelector('.brief-bonds');
    assert.equal(match.phase, 'INFO_CHECK'); assert.equal(match.game.gd.largeRoomBonus, 0);
    await page.screenshot({ path: `${out}/${mapVersion}-ban.png` });
    await request(page, 'g.infoReady');
    await page.waitForSelector('iframe[title="对抗模式（测试）"]');
    const frame = await (await page.$('iframe[title="对抗模式（测试）"]')).contentFrame();
    lastFrame = frame;
    await frame.waitForFunction(() => window.__versusView && window.__versusState()?.field, { timeout: 60000 });
    const state = await frame.evaluate(() => window.__versusState());
    assert.equal(state.room.mapVersion, mapVersion); assert.equal(state.field.meta.stageId,stageId);
    assert.equal(state.field.playerId,state.me.id); assert.equal(state.me.strategy,null);
    assert.equal(new Set(state.room.duels.map(d => d.color)).size,4);
    const p = match.players.get(state.me.id), b = match.game.battleOf(p);
    p.coins=100;match.flush();
    await frame.waitForFunction(()=>window.__versusState().me.coins>=100);
    assert.equal(await frame.$eval('.lvcard__price',e=>e.textContent.trim()),'10');
    await frame.click('.lvcard');
    await frame.click('.lvcard');
    await frame.waitForFunction(()=>window.__versusState().me.level===2);
    await frame.waitForFunction(()=>document.querySelector('.lvcard')?.getAttribute('aria-disabled')==='true');
    assert.equal(p.stats.spent,10);
    assert.equal(await frame.$eval('.lvcard',e=>e.getAttribute('aria-disabled')),'true');
    assert.equal(await frame.$eval('.lvcard__price',e=>e.textContent.trim()),'18');
    assert.ok(await frame.$eval('.upgrade-status',e=>e.textContent.includes('秒')));
    match.game.time=p.upgradeNext;match.flush();
    await frame.waitForFunction(()=>document.querySelector('.upgrade-status')?.textContent==='部署 0/2');
    assert.equal(await frame.$eval('.lvcard',e=>e.getAttribute('aria-disabled')),'true');
    for(const [width,height] of [[1440,900],[844,390],[568,320]]) {
      await page.setViewport({width,height});await pause(250);
      const bounds=await frame.$$eval('.shopbar__tools,.funds,.lvcard',es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      assert.ok(bounds.every(r=>r.y>=0&&r.bottom<=height&&r.right<=width),JSON.stringify(bounds));
      await page.screenshot({path:`${out}/${mapVersion}-upgrade-${width}x${height}.png`});
    }
    await page.setViewport({width:1440,height:900});await pause(250);
    if(await frame.$('[aria-label="展开商店"]')) await frame.click('[aria-label="展开商店"]');
    await frame.waitForFunction(()=>document.querySelector('.shop-grid')?.getBoundingClientRect().height>0);
    assert.equal(await frame.$$eval('.shop-offer',es=>es.length),11);
    assert.deepEqual(await frame.$$eval('.shop-offer',es=>es.map(e=>e.dataset.shopKind)),[...Array(5).fill('operator'),...Array(5).fill('monster'),'equipment']);
    assert.equal(await frame.$('.shop-grid .scard__skill,.shop-grid .scard__idesc,.shop-grid .scard__class,.shop-grid .scard__bonds'),null);
    assert.ok(await frame.$eval('.income',e=>e.textContent.includes('每2秒')&&e.textContent.includes('上限100')));
    const buy = (kind, id) => { p.shop[kind][0] = id; match.flush(); };
    const purchase = async kind => {
      const id=p.shop[kind][0];
      await frame.waitForFunction((kind,id)=>document.querySelector(`.shop-offer.${kind}[data-shop-index="0"]`)?.dataset.id===id,{},kind,id);
      await frame.click(`.shop-offer.${kind}[data-shop-index="0"] .scard`); await frame.waitForSelector('.dpanel');
      await frame.waitForSelector(`.shop-offer.${kind} .scard.is-armed`);
      await frame.click(`.shop-offer.${kind} .scard.is-armed`); await frame.waitForFunction(()=>!document.querySelector('.dpanel'));
      await frame.waitForFunction(kind=>window.__versusState().me.shop[kind][0]===null,{},kind);
    };
    const spent=p.stats.spent;
    await frame.click('.shop-offer.operator .scard');await frame.waitForSelector('.dpanel');
    assert.equal(p.stats.spent,spent);assert.equal(p.operators.length,0);
    assert.ok(await frame.$('.dgarrison__text'));
    const panel=await frame.$eval('.versus-detail',e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
    assert.ok(panel.width<=340&&panel.height<650,JSON.stringify(panel));
    await page.screenshot({path:`${out}/${mapVersion}-native-operator-detail.png`});
    await page.mouse.click(400,25);await frame.waitForFunction(()=>!document.querySelector('.dpanel'));
    await frame.click('.shop-offer.operator .scard');
    await frame.click('.shop-offer.operator .scard');
    await frame.waitForSelector('.bench-card.operator');
    const o = p.operators[0], def = data.chess[o.id];
    let tile;
    for (let row=2;row<=5&&!tile;row++) for(let col=3;col<=9;col++) {
      const c=ownCol(p,col); if(b.grid.canStand(row,c,{ranged:def.position==='RANGED'})&&!b.isReservedTile(row,c)) {tile={row,col:c};break;}
    }
    await frame.click('.bench-card.operator');
    await frame.evaluate(() => {
      const v=window.__versusView, original=v.highlightTiles;
      window.__highlightCalls=[];
      v.highlightTiles=(tiles,style)=>{window.__highlightCalls.push({tiles,group:style?.group});return original.call(v,tiles,style);};
    });
    await pause(800);
    assert.ok(await frame.evaluate(()=>window.__highlightCalls.filter(c=>c.group==='select').at(-1)?.tiles.length>0));
    assert.ok(await frame.evaluate(()=>window.__highlightCalls.every(c=>c.tiles!==null)));
    const pos = await frame.evaluate(tile => window.__versusView.tileScreen(tile.row,tile.col), tile);
    await frame.page().mouse.click(pos.x,pos.y);
    await frame.waitForSelector('.fwheel');
    assert.equal(o.row,null);
    await page.keyboard.press('Escape');
    await frame.waitForFunction(() => !document.querySelector('.fwheel'));
    assert.equal(o.row,null);
    // Cancel an off-board drag without consuming the operator, then drag to a legal tile.
    let benchBox=await (await frame.$('.bench-card.operator')).boundingBox();
    await page.mouse.move(benchBox.x+benchBox.width/2,benchBox.y+benchBox.height/2);await page.mouse.down();
    await page.mouse.move(400,20,{steps:12});await page.mouse.up();assert.equal(o.row,null);
    benchBox=await (await frame.$('.bench-card.operator')).boundingBox();
    await page.mouse.move(benchBox.x+benchBox.width/2,benchBox.y+benchBox.height/2);await page.mouse.down();
    await page.mouse.move(pos.x,pos.y,{steps:15});await page.mouse.up();await frame.waitForSelector('.fwheel');
    await pause(600);
    assert.ok(await frame.$('.fwheel'));
    await page.keyboard.press('ArrowLeft'); await pause(400);
    assert.ok(await frame.evaluate(()=>window.__highlightCalls.filter(c=>c.group==='facing').at(-1)?.tiles.length>0));
    await page.keyboard.press('Enter');
    await frame.waitForFunction(uid => window.__versusState().me.operators.find(o=>o.uid===uid)?.row!=null, {}, o.uid);
    assert.equal(b.allyUnits.find(u=>u.uid===o.uid).dir,'LEFT');
    await pause(350);
    const placedPos = await frame.evaluate(tile=>window.__versusView.tileScreen(tile.row,tile.col),tile);
    await page.mouse.click(placedPos.x,placedPos.y);
    await frame.waitForSelector('.dpanel');
    await frame.click('[aria-label="调整朝向"]'); await frame.waitForSelector('.fwheel');
    await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.dir==='UP',{},o.uid);
    assert.equal(b.allyUnits.find(u=>u.uid===o.uid).dir,'UP');
    const dragTo = async (handle, destination) => {
      const box=await handle.boundingBox();assert.ok(box);
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      await page.mouse.move(destination.x,destination.y,{steps:15});await page.mouse.up();
    };
    const moveTile=[];
    for(let row=2;row<=5;row++)for(let col=3;col<=9;col++) {
      const c=ownCol(p,col);
      if(b.grid.canStand(row,c,{ranged:def.position==='RANGED'})&&!b.isReservedTile(row,c))moveTile.push({row,col:c});
    }
    const movedTile=moveTile[0], movingUnit=b.allyUnits.find(u=>u.uid===o.uid&&!u.removed), hpBefore=movingUnit.hp, spBefore=movingUnit.sp;
    const movedPos=await frame.evaluate(t=>window.__versusView.tileScreen(t.row,t.col),movedTile);
    await page.keyboard.press('Escape');
    await pause(200);
    const moveSource=await frame.evaluate(t=>window.__versusView.tileScreen(t.row,t.col),tile);
    await page.mouse.move(moveSource.x,moveSource.y);await page.mouse.down();await page.mouse.move(movedPos.x,movedPos.y,{steps:15});await page.mouse.up();
    await frame.waitForFunction((uid,row,col)=>{const state=window.__versusState(),o=state.me.operators.find(o=>o.uid===uid);return o?.row===row&&o.col===(state.me.side==='R'?20-col:col);},{},o.uid,movedTile.row,movedTile.col);
    assert.equal(movingUnit.tileC,movedTile.col);assert.equal(movingUnit.hp,hpBefore);assert.ok(movingUnit.sp>=spBefore&&movingUnit.sp<spBefore+3);
    assert.equal(await frame.$('.fwheel'),null);
    await pause(350);
    await page.mouse.move(movedPos.x,movedPos.y);await page.mouse.down();await page.mouse.move(placedPos.x,placedPos.y,{steps:15});await page.mouse.up();
    await frame.waitForFunction((uid,row,col)=>{const state=window.__versusState(),o=state.me.operators.find(o=>o.uid===uid);return o?.row===row&&o.col===(state.me.side==='R'?20-col:col);},{},o.uid,tile.row,tile.col);
    await pause(350);
    // All three inventory types coexist; no inventory tabs hide cards.
    buy('operator',o.id); await purchase('operator');
    const replacementOp=p.operators.find(pc=>pc.row==null);
    await dragTo(await frame.$(`.bench-card.operator[data-uid="${replacementOp.uid}"]`),placedPos);
    await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row===null,{},o.uid);
    assert.equal(replacementOp.row,tile.row);
    await dragTo(await frame.$(`.bench-card.operator[data-uid="${o.uid}"]`),placedPos);
    await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row!=null,{},o.uid);
    assert.equal(replacementOp.row,null);
    buy('monster',MONSTERS[0].id);
    await frame.waitForSelector('.shop-offer.monster .scard'); await purchase('monster');
    assert.equal(p.monsters[MONSTERS[0].id],3);
    buy('equipment',EQUIPMENT[0].id);
    await frame.waitForSelector('.shop-offer.equipment .scard'); await purchase('equipment');
    await frame.waitForSelector('.bench-card.equipment');
    assert.equal(await frame.$('.inventory .tabs'),null);
    for(const kind of ['operator','monster','equipment']) assert.ok(await frame.$(`.bench-card.${kind}`));
    assert.equal(await frame.evaluate(()=>[...window.__versusView.debug.views.keys()].filter(k=>String(k).startsWith('b:')).length),3);
    await dragTo(await frame.$('.bench-card.equipment'),placedPos);
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.items.length===1,{},o.uid);
    assert.equal(o.items[0],EQUIPMENT[0].id);
    buy('equipment',EQUIPMENT[1].id);await purchase('equipment');
    const benchOperator=p.operators.find(o=>o.row==null), benchOperatorBox=await (await frame.$(`.bench-card.operator[data-uid="${benchOperator.uid}"]`)).boundingBox();
    await dragTo(await frame.$('.bench-card.equipment'),{x:benchOperatorBox.x+benchOperatorBox.width/2,y:benchOperatorBox.y+benchOperatorBox.height/2});
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.items.length===1,{},benchOperator.uid);
    buy('equipment',EQUIPMENT[2].id);await purchase('equipment');
    await frame.click('.bench-card.equipment');await frame.waitForSelector('.uframe__btn--sell');
    await frame.click('.uframe__btn--sell');await frame.waitForFunction(()=>!document.querySelector('.bench-card.equipment'));
    buy('equipment',EQUIPMENT[0].id);await purchase('equipment');
    const ranged=Object.values(data.chess).find(c=>c.position==='RANGED'&&!c.isGolden&&!c.hideInShop&&c.chessId!==o.id&&c.tier<=6&&!match.game.bannedChess.has(c.chessId));
    p.coins=100;buy('operator',ranged.chessId);await purchase('operator');
    const highOp=p.operators.at(-1);
    await frame.click(`.bench-card.operator[data-uid="${highOp.uid}"]`);
    await frame.click('.dpanel__close');
    const highTile={row:3,col:ownCol(p,3)},highPos=await frame.evaluate(t=>window.__versusView.tileScreen(t.row,t.col),highTile);
    assert.ok(await frame.evaluate(t=>window.__highlightCalls.filter(c=>c.group==='select').at(-1).tiles.some(([r,c])=>r===t.row&&c===t.col),highTile));
    await page.mouse.click(highPos.x,highPos.y);await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row===3,{},highOp.uid);
    match.game.deadline=match.game.time; match.game.tick(); match.flush();
    await frame.waitForFunction(() => window.__versusState().room.status==='combat');
    await page.waitForFunction(async ()=>(await import('/js/audio.js')).audio.wantBgm==='combat:1');
    await page.evaluate(async () => {
      const {audio}=await import('/js/audio.js');window.__versusSounds=[];window.__versusVoices=[];
      const battle=audio.battle.bind(audio),voice=audio.voice.bind(audio);
      audio.battle=(name,o)=>{window.__versusSounds.push(name);return battle(name,o);};
      audio.voice=(id,slot,o)=>{window.__versusVoices.push({id,slot});return voice(id,slot,o);};
    });
    const alive=b.allyUnits.find(u=>u.uid===o.uid&&!u.removed);
    b._ev(['skill',alive.id,true]);b._ev(['leak',98765]);match.flush();await pause(250);
    assert.ok(await page.evaluate(()=>window.__versusSounds.includes('leak')));
    assert.ok(await page.evaluate(()=>window.__versusVoices.some(v=>v.slot.startsWith('skill'))));
    await frame.click('.bench-card.monster');
    const launch = {row:4,col:ownCol(p,9)};
    assert.ok(b.grid.groundPassable(launch.row,launch.col));
    const launchPos = await frame.evaluate(t => window.__versusView.tileScreen(t.row,t.col),launch);
    // Real touch drag uses the same native tile picker as mouse and the 3D board.
    const touch=await page.createCDPSession();
    const monsterBox=await (await frame.$('.bench-card.monster')).boundingBox();
    const start={x:monsterBox.x+monsterBox.width/2,y:monsterBox.y+monsterBox.height/2};
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
    for(let i=1;i<=12;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(launchPos.x-start.x)*i/12,y:start.y+(launchPos.y-start.y)*i/12,id:1}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
    await frame.waitForFunction(id => window.__versusState().field.meta.units.some(u=>u.outgoing&&u.sourcePlayerId===id), {}, p.id);
    assert.equal(p.monsters[MONSTERS[0].id],undefined);
    assert.equal(match.game.battleOf(match.game.duels.find(d=>d.id===p.duel).pair.find(other=>other!==p)).enemies.filter(e=>e.sourcePlayerId===p.id).length,3);
    assert.equal(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')),'false');
    const before=await frame.evaluate(() => window.__versusState().field);
    assert.ok(before.routes[0]?.cells.length>1);
    const ownMonster=before.meta.units.find(u=>u.outgoing);
    await pause(1600);
    const after=await frame.evaluate(() => window.__versusState().field);
    const moved=after.snapshot.units.find(t=>t[0]===ownMonster.id), old=before.snapshot.units.find(t=>t[0]===ownMonster.id);
    assert.ok(moved&&old&&(moved[1]!==old[1]||moved[2]!==old[2]));
    assert.ok(after.meta.units.filter(u=>u.kind==='op').every(u=>u.ownerId===p.id));
    await frame.click('[aria-label="大地图"]');
    await frame.waitForFunction(()=>document.querySelector('[aria-label="大地图"]').getAttribute('aria-pressed')==='true');
    await frame.click(`.bench-card.operator[data-uid="${p.operators.find(o=>o.row==null).uid}"]`);
    assert.equal(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')),'true');
    await frame.click('.dpanel__close');
    const candidate=p.operators.find(o=>o.row==null), candidateDef=data.chess[candidate.id];
    let bigTile;
    for(let row=2;row<=5&&!bigTile;row++)for(let col=3;col<=9;col++) {
      const c=ownCol(p,col);
      if(b.grid.canStand(row,c,{ranged:candidateDef.position==='RANGED'})&&!b.isReservedTile(row,c)){bigTile={row,col:c};break;}
    }
    const bigPos=await frame.evaluate(t=>window.__versusView.tileScreen(t.row,t.col),bigTile);
    await page.mouse.click(bigPos.x,bigPos.y);await frame.waitForSelector('.fwheel');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await frame.waitForFunction(uid=>window.__versusState().me.operators.find(o=>o.uid===uid)?.row!=null,{},candidate.uid);
    assert.equal(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')),'true');
    const opponent=match.game.duels.find(d=>d.id===p.duel).pair.find(other=>other!==p);
    const opponentOp=opponent.operators.find(o=>o.row!=null);
    assert.ok(opponentOp);
    opponent.monsters[MONSTERS[0].id]=1;opponent.launchNext=0;
    match.game.action(opponent,{action:'launch',id:MONSTERS[0].id,row:4,col:ownCol(opponent,9)});match.flush();
    await pause(1000);
    p.monsters[MONSTERS[0].id]=3;p.launchNext=0;match.flush();
    await frame.waitForSelector('.bench-card.monster');await frame.click('.bench-card.monster');
    const fullLaunchPos=await frame.evaluate(t=>window.__versusView.tileScreen(t.row,t.col),launch);
    await page.mouse.click(fullLaunchPos.x,fullLaunchPos.y);
    await frame.waitForFunction(id=>!window.__versusState().me.monsters[id],{},MONSTERS[0].id);
    assert.equal(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')),'true');
    await page.screenshot({path:`${out}/${mapVersion}-monster-routes.png`});
    const canvas=await frame.$('.field canvas');
    const encoded=await canvas.screenshot({encoding:'base64'});
    const pixels=await frame.evaluate(async encoded=>{
      const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      const bytes=ctx.getImageData(0,0,c.width,c.height).data;let blue=0,red=0;
      for(let i=0;i<bytes.length;i+=4){const [r,g,b]=[bytes[i],bytes[i+1],bytes[i+2]];
        if(r>=75&&r<=95&&g>=175&&g<=198&&b>=240)blue++;
        if(r>=240&&g>=80&&g<=102&&b>=98&&b<=120)red++;
      }
      return {blue,red};
    },encoded);
    assert.ok(pixels.blue>5&&pixels.red>5,JSON.stringify(pixels));
    assert.equal(await frame.$eval('[aria-label="大地图"]',e=>e.getAttribute('aria-pressed')),'true');
    await frame.click('[aria-label="大地图"]');
    await frame.waitForFunction(()=>document.querySelector('[aria-label="大地图"]').getAttribute('aria-pressed')==='false');
    await frame.click('[aria-label="大地图"]');
    await frame.waitForFunction(()=>document.querySelector('[aria-label="大地图"]').getAttribute('aria-pressed')==='true');
    await pause(250);
    assert.ok(await frame.evaluate(()=>[2,18].every(col=>{const p=window.__versusView.tileScreen(2,col);return p.x>0&&p.x<innerWidth;})));
    assert.ok(await frame.evaluate(id=>[...window.__versusView.debug.views.values()].some(u=>u.info.ownerId===id),opponent.id));
    await page.screenshot({path:`${out}/${mapVersion}-both-lineups.png`});
    await frame.click('[aria-label="大地图"]');await frame.waitForFunction(()=>document.querySelector('[aria-label="大地图"]').getAttribute('aria-pressed')==='false');
    assert.ok(await frame.evaluate(id=>[...window.__versusView.debug.views.values()].filter(u=>u.info.kind==='op'&&!u._inventory).every(u=>u.info.ownerId===id),p.id));
    await frame.click('.top-end button[aria-label="淘汰赛与观战"]');
    await frame.waitForSelector('.watch-roster'); assert.equal(await frame.$$eval('.watch-roster button',bs=>bs.length),8);
    const other=state.room.duels.find(d=>d.id!==state.field.duelId).players[0];
    const name=state.room.players.find(p=>p.id===other).name;
    await frame.click(`.watch-roster button[aria-label="查看${name}的战场"]`);
    await frame.waitForFunction(id=>window.__versusState().field.playerId===id,{},other);
    await frame.click(`.watch-roster button[aria-label="查看${p.name}的战场"]`);
    await frame.waitForFunction(id=>window.__versusState().field.playerId===id,{},p.id);
    await frame.click('.top-end button[aria-label="淘汰赛与观战"]');
    buy('equipment',EQUIPMENT[0].id);
    await frame.waitForSelector('.shop-offer.equipment[data-id]');
    const layouts=[];
    for(const [width,height] of [[1440,900],[844,390],[568,320],[390,844]]) {
      await page.setViewport({width,height}); await pause(700);
      const layout=await frame.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,
      rects:[...document.querySelectorAll('.topbar,.workspace,.shopbar,.shopbar-tab,.inventory,.top-end button,.field-tools button')].map(e=>{const r=e.getBoundingClientRect();return {cls:e.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})}));
      assert.ok(layout.scroll<=width,JSON.stringify(layout));
      assert.ok(layout.rects.every(r=>r.x>=-1&&r.y>=-1&&r.right<=width+1&&r.bottom<=height+1),JSON.stringify(layout));
      await page.screenshot({path:`${out}/${mapVersion}-${width}x${height}.png`}); layouts.push(layout);
      // The host game's portrait prompt intentionally hides the embedded battle frame.
      if(width<height)continue;
      const folded=!!await frame.$('[aria-label="展开商店"]');
      if(folded)await frame.click('[aria-label="展开商店"]');
      await frame.waitForFunction(()=>document.querySelector('.shop-grid')?.getBoundingClientRect().height>0);
      const shopLayout=await frame.$eval('.shop-grid',e=>({scroll:e.scrollWidth,width:e.clientWidth,overflow:getComputedStyle(e).overflowX,
        cards:[...e.children].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width};})}));
      assert.ok(shopLayout.scroll<=shopLayout.width+1,JSON.stringify(shopLayout));
      assert.equal(shopLayout.overflow,'hidden');assert.equal(shopLayout.cards.length,11);
      assert.ok(shopLayout.cards.every(c=>c.width>0&&c.x>=0&&c.right<=width),JSON.stringify(shopLayout));
      await page.screenshot({path:`${out}/${mapVersion}-fixed-shop-${width}x${height}.png`});
      if(folded)await frame.click('[aria-label="收起商店"]');
      if(width>height&&width<=1000) {
        await frame.click('[aria-label="展开商店"]');await frame.waitForSelector('[aria-label="收起商店"]');
        assert.equal(await frame.$('.shop-meta .tabs'),null);
        await frame.click('.shop-offer.monster[data-id] .scard');await frame.waitForSelector('.dpanel');
        assert.ok(await frame.$('.dpanel--enemy'));
        const detailBounds=await frame.$eval('.versus-detail',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
        assert.ok(detailBounds.x>=0&&detailBounds.bottom<=height&&detailBounds.right<=width,JSON.stringify(detailBounds));
        await page.screenshot({path:`${out}/${mapVersion}-shop-detail-${width}x${height}.png`});
        await frame.click('.dpanel__close');await frame.click('[aria-label="收起商店"]');
      }
    }
    await page.setViewport({width:1440,height:900});await pause(400);
    if(await frame.$('[aria-label="展开商店"]'))await frame.click('[aria-label="展开商店"]');
    match.game.status='preparation';match.game.deadline=Infinity;match.flush();
    const bystanders=b.allyUnits.filter(u=>u.alive&&!u.removed&&u.defId!==o.id).map(u=>({u,hp:u.hp}));
    let mergeDeaths=0;b.on('death',()=>mergeDeaths++);
    p.coins=100;buy('operator',o.id);await purchase('operator');
    await frame.waitForSelector('.versus-reward .shopbar__reward');
    assert.equal(mergeDeaths,0);assert.ok(bystanders.every(({u,hp})=>u.alive&&u.hp===hp));
    assert.ok(p.operators.some(pc=>pc.id===data.chess[o.id].goldenId));
    assert.ok(await frame.$eval('.versus-reward',el=>el.textContent.includes('晋升')));
    await page.screenshot({path:`${out}/${mapVersion}-native-promotion-reward.png`});
    const rewardCoins=p.coins;
    await frame.click('.versus-reward .scard');await frame.click('.versus-reward .scard');
    await frame.waitForFunction(()=>!window.__versusState().me.rewardOffer);assert.equal(p.coins,rewardCoins);
    report.maps.push({mapVersion,stageId,layouts,upgradeCosts:true,upgradeCooldown:true,upgradeDeploymentGate:true,nativeShopComponents:true,nativeDetail:true,blankDismiss:true,deployedMove:true,replaceByDragging:true,equipmentDragBoard:true,equipmentDragBench:true,nativePromotionReward:true,mergeDoesNotKillOthers:true,deployFacing:'LEFT',rotateFacing:'UP',outgoingRoute:true,outlinePixels:pixels,unifiedInventory:true,scoutingEight:true,mouseDrag:true,touchDrag:true,persistentPlacement:true,combatMusic:true,skillVoice:true,leakSound:true,bigMap:true,opponentLineup:true,shootingPlatform:true,twoTapPurchase:true,bundleQuantity:true,benchSelling:true});
    match.game.action(p,{action:'forfeit'});match.flush();
    await frame.waitForSelector('[aria-label="退出观战"]');
    await frame.waitForSelector('#versus-result-title');
    await page.screenshot({path:`${out}/${mapVersion}-settlement.png`});
    assert.equal(await frame.$$eval('.result-player',es=>es.length),2);
    await frame.click('[aria-label="关闭对抗结算"]');
    assert.equal(await frame.$('.finish-banner'),null);
    assert.ok(await frame.$eval('.battle-time .eliminated-status',el=>el.textContent.includes('已淘汰')));
    await page.screenshot({path:`${out}/${mapVersion}-eliminated-status.png`});
    await frame.click('[aria-label="查看对抗结算"]');
    await frame.waitForSelector('#versus-result-title');
    await frame.click('[aria-label="关闭对抗结算"]');
    assert.equal(await frame.$eval('[aria-label="退出观战"]',e=>e.disabled),false);
    if(mapVersion==='classic') {
      while(match.game.status!=='complete') {for(const d of match.game.duels)match.game.finishDuel(d,d.pair[0],'测试');match.game.tick();}
      match.flush();await frame.waitForFunction(()=>window.__versusState().room.status==='complete');
      await frame.waitForFunction(()=>document.querySelectorAll('.result-player').length===8);
      for(const [width,height] of [[1440,900],[844,390]]) {await page.setViewport({width,height});await pause(300);await page.screenshot({path:`${out}/final-result-${width}x${height}.png`});}
      await frame.click('[aria-label="结算返回房间"]');
      report.maps.at(-1).finalRankings=true;
    } else await frame.click('[aria-label="退出观战"]');
    await page.waitForFunction(()=>!document.querySelector('iframe[title="对抗模式（测试）"]'));
    report.maps.at(-1).eliminatedExit=mapVersion==='new';
    report.maps.at(-1).settlementReopen=true;
    await context.close();
  }
  assert.deepEqual(report.errors,[]); report.passed=true;
} catch(e) { report.failure=e.stack;report.ui=await lastFrame?.evaluate(()=>({toast:document.querySelector('.toast')?.textContent,detail:document.querySelector('#detail-title')?.textContent,shop:window.__versusState()?.me.shop,coins:window.__versusState()?.me.coins}));await lastPage?.screenshot({path:`${out}/failure.png`});throw e; }
finally { writeFileSync(`${out}/browser.json`,JSON.stringify(report,null,2)); await browser.close(); await server.close(); }
