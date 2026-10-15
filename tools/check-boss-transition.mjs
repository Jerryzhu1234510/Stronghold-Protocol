/* global window, document, Image */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeMatch, give, legalTileFor, chessOfTier } from '../test/match/harness.js';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/boss-transition';
mkdirSync(out, { recursive: true });
const url = process.env.SP_PREVIEW_URL || 'http://localhost:8923';
const copy = value => JSON.parse(JSON.stringify(value));
const fixtures = [];
for (const capacity of [4, 5, 6, 7, 8]) {
  const h = makeMatch({ humans:capacity, capacity, difficulty:'ABYSS', fake:true, seed:8300+capacity }).start();
  try {
    h.setStage('act1autochess_m01').toPrep(13);
    const ps = h.ps('p_3');
    const normal = copy({pub:h.m.publicView(),priv:ps.privateView()});
    h.toPrep(14);
    for (const player of h.m.alivePlayers()) { player.board.clear(); player.ready = false; player.recompute(); }
    for (const [i, dir] of ['RIGHT','UP','DOWN'].entries()) {
      const id = chessOfTier(1)[i];
      give(h.m, ps, id, 'board', legalTileFor(h.m, ps, id)).dir = dir;
    }
    const mate = h.ps('p_2'), id = chessOfTier(1)[3];
    give(h.m, mate, id, 'board', legalTileFor(h.m, mate, id)).dir = 'RIGHT';
    ps.recompute(); mate.recompute();
    const boss = copy({pub:h.m.publicView(),priv:ps.privateView()});
    assert.equal(boss.priv.prepField.side,'R');
    assert.ok(boss.priv.bossMate.units.length);
    fixtures.push({capacity,normal,boss,scout:copy(h.m.prepFieldMeta(h.ps('p_0')))});
  } finally { h.m.dispose(); }
}
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const results = [], errors = [];
const pause = ms => new Promise(r=>setTimeout(r,ms));
try {
  for (const [width,height,touch] of [[1440,900,false],[844,390,true],[568,320,true]]) {
    const page = await browser.newPage();
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console', m=>{if(m.type()==='warning' && m.text().startsWith('[field]')) errors.push(m.text());});
    await page.setViewport({width,height,isMobile:touch,hasTouch:touch});
    await page.goto(`${url}/dev/game-mock.html?shot=1`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__SP_VIEW__?.raw?.debug?.camKind==='prep',{timeout:60000});
    const load = async (state, full=true) => {
      await page.evaluate((s,full)=>{
        const store = window.__MOCK__.store;
        s.pub.deadline=Date.now()+90000; s.pub.serverNow=Date.now();
        if(full) store.set({me:{...store.get().me,playerId:s.priv.playerId},room:{...store.get().room,capacity:s.pub.capacity},match:{...store.get().match,public:s.pub,private:s.priv,field:null}});
        else store.patch('match',{private:s.priv});
      },copy(state),full);
      await pause(750);
    };
    const check = async (label, expected='R') => {
      const state = await page.evaluate(()=>{
        const raw=window.__SP_VIEW__.raw, priv=window.__MOCK__.store.get().match.private;
        return {camera:raw.debug.camKind,field:raw.prepField(),units:priv.board.filter(p=>p.kind==='chess').map(p=>{
          const v=raw.debug.views.get('p:'+p.uid),t=raw.tileScreen(p.row,p.col);
          const d=raw.prepField().mirror ? 20-p.col : p.col;
          const project=raw.debug.cam.project(d,p.row-7,raw.debug.tiles.heightAt(p.row-7,d));
          return {row:p.row,col:p.col,stored:p.dir,x:v?.x,y:v?.y,dir:v?.dir,tile:t,project};
        }),mates:[...raw.debug.views.keys()].filter(k=>String(k).startsWith('m:')).length,stats:raw.stats()};
      });
      assert.equal(state.camera,'bossPrep',label);
      assert.equal(state.field.side,expected,label);
      assert.equal(state.field.mirror,expected==='R',label);
      for(const u of state.units) {
        assert.ok(Math.abs(u.x-(expected==='R'?20-u.col:u.col))<.01,label+' x');
        assert.ok(Math.abs(u.y-(u.row-7))<.01,label+' y');
        const dir = expected==='R' ? ({RIGHT:'LEFT',LEFT:'RIGHT'}[u.stored]||u.stored) : u.stored;
        assert.equal(u.dir,dir,label+' facing');
        assert.ok(Math.abs(u.tile.x-u.project.x)<.01 && Math.abs(u.tile.y-u.project.y)<.01,label+' hit geometry');
      }
      assert.ok(state.mates>0,label+' partner');
      results.push({label,width,height,...state});
    };
    for(const f of fixtures) {
      await load(f.normal);
      assert.equal(await page.evaluate(()=>window.__SP_VIEW__.raw.prepField().kind),'board');
      await load(f.boss);
      await check(`${f.capacity}-player normal-to-boss`);
      // A private refresh must repair a renderer that diverged from the remembered request.
      await page.evaluate(()=>window.__SP_VIEW__.raw.setCamera('prep',{side:'L',instant:true}));
      await load(f.boss,false);
      await check(`${f.capacity}-player stale-field-recovery`);
    }
    const f=fixtures.at(-1);
    await load({...f.boss,pub:{...f.boss.pub,bossRound:null,hiddenRound:null}});
    await check('private-assignment-without-public-boss-metadata');
    await load(f.normal);
    await load(f.boss,false);
    assert.equal(await page.evaluate(()=>window.__SP_VIEW__.raw.prepField().kind),'board','ignore future private assignment');
    await page.evaluate(pub=>{
      pub.deadline=Date.now()+90000; pub.serverNow=Date.now();
      window.__MOCK__.store.patch('match',{public:pub});
    },f.boss.pub);
    await pause(750);
    await check('private-before-public');
    await page.evaluate(async scout=>{
      const net=(await import('/js/net.js')).net,store=window.__MOCK__.store;
      const original=net.request.bind(net);
      net.request=async(t,p)=>{
        if(t==='g.watch') { store.patch('match',{field:scout}); return {}; }
        return original(t,p);
      };
      document.querySelector('.team__row:not(.is-self) .team__btn').click();
    },f.scout);
    await pause(750);
    assert.equal(await page.evaluate(()=>window.__SP_VIEW__.raw.prepField().side),'L','scout left player');
    await page.click('.team__row.is-self .team__btn');
    await pause(750);
    await check('return-from-left-scout');
    await page.click('.funds__collapse');
    await pause(750);
    await check('folded-shop');
    await page.screenshot({path:`${out}/boss-right-${width}x${height}.png`});
    const colors=await page.evaluate(async()=>{
      const app=window.__SP_VIEW__.raw.debug.app;
      const source=app.renderer.extract.canvas(app.stage);
      const image=new Image(); image.src=source.toDataURL(); await image.decode();
      const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      const {data}=ctx.getImageData(0,0,canvas.width,canvas.height),seen=new Set();
      for(let i=0;i<data.length;i+=80) if(data[i+3]>0) seen.add(`${data[i]},${data[i+1]},${data[i+2]}`);
      return seen.size;
    });
    assert.ok(colors>100,`${width}x${height}: nonblank canvas (${colors})`);
    results.push({label:'canvas-pixels',width,height,colors});
    await page.evaluate(()=>window.__MOCK__.store.patch('match',{public:null,private:null}));
    await pause(200);
    await load(f.boss);
    await page.waitForFunction(()=>window.__SP_VIEW__?.raw?.prepField().side==='R',{timeout:60000});
    await pause(750);
    await check('reconnect-into-boss-prep');
    await page.screenshot({path:`${out}/boss-right-shop-${width}x${height}.png`});
    await load({...f.boss,pub:{...f.boss.pub,round:15,phase:'ROUND_START'},priv:{...f.boss.priv,prepField:{...f.boss.priv.prepField,round:15}}});
    await check('hidden-boss-round-start');
    await load({...f.boss,pub:{...f.boss.pub,round:15},priv:{...f.boss.priv,prepField:{...f.boss.priv.prepField,round:15}}});
    await check('hidden-boss-prep');
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks:results.length,errors}));
} finally {
  writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));
  await browser.close();
}
