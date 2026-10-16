/* global __SP_VIEW__, __perfProbe, __SP_RUNNER__ */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { TestClient } from '../test/helpers/wsClient.js';
import { attachWsSimClient } from '../test/match/simClient.js';
import { getData } from '../server/data.js';
import { toDataSource } from '../server/sim/simdata.js';
import { StateDecoder } from '../shared/stateDelta.js';
const out='../../outputs/performance-r18/eight-player';
const profile=process.argv[2]||'low30',slow=profile==='high60-slow';
const {generation}=JSON.parse(await fs.readFile('../../outputs/performance-r18/deployment.json','utf8'));
const base=`/_build/${generation}/`, origin='https://weishuxieyi.icu';
const report={generation,profile,startedAt:new Date().toISOString(),passed:false,errors:[],serverErrors:[],samples:[],peers:[],frames:{},cleanup:[]};
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage();
const clients=[], sims=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true,isLandscape:true});
page.on('pageerror',e=>report.errors.push(e.message));
await page.evaluateOnNewDocument(slow=>localStorage.setItem('sp.pref.settings',JSON.stringify({quality:slow?'high':'low',frameRate:slow?60:30,damageNumbers:slow,muted:true})),slow);
const cdp=await page.createCDPSession();await cdp.send('Network.enable');
const requests=new Map();
cdp.on('Network.webSocketFrameSent',e=>{try{const m=JSON.parse(e.response.payloadData);if(m.rid!=null)requests.set(m.rid,m.t);}catch{}});
cdp.on('Network.webSocketFrameReceived',e=>{try { const m=JSON.parse(e.response.payloadData);report.frames[m.t]=(report.frames[m.t]||0)+1;if(m.t==='error')report.serverErrors.push({code:m.code,detail:m.detail,request:requests.get(m.rid)}); }catch{}});
let created=false;
try {
 await page.goto(origin+base,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>globalThis.__SP__?.store.get().connection.status==='connected',{timeout:60000});
 await page.waitForSelector('.release-notes .modal__actions button',{timeout:60000});
 await page.click('.release-notes .modal__actions button');
 await page.evaluate(async base=>{const {enterSession}=await import(base+'js/screens/title.js');enterSession('8人性能验证');},base);
 await page.waitForFunction(()=>__SP__.store.get().connection.status==='online',{timeout:30000});
 await page.evaluate(()=>__SP__.net.request('room.create',{mode:'coop',difficulty:'FUNNY',capacity:8,experimentalAccepted:true}));created=true;
 await page.waitForFunction(()=>__SP__.store.get().room?.code);
 const code=await page.evaluate(()=>__SP__.store.get().room.code);
 const ds=toDataSource(getData({log:{warn(){},info(){},error(){}}}));
 for(let i=1;i<8;i++){
  const c=await TestClient.connect(`wss://weishuxieyi.icu${base}ws`,{timeout:15000});clients.push(c);
  const welcome=await c.hello('8人验证'+i,undefined,{stateDelta:true});c.id=welcome.playerId;
  const decoder=new StateDecoder();let current=null,privateState=null;
  const peer={index:i,frames:0,deltas:0,decodeErrors:[],rtts:[],phases:[],boards:[]};report.peers.push(peer);
  c.ws.on('message',raw=>{try{const m=JSON.parse(String(raw));peer.frames++;if(m.t==='m.delta')peer.deltas++;const d=decoder.decode(m);if(d.t==='m.public'){current=d;const k=d.round+':'+d.phase;if(peer.phases.at(-1)!==k)peer.phases.push(k);peer.players=d.players?.length;}if(d.t==='m.private'){privateState=d;peer.boardCount=d.board?.length??d.self?.board?.length;}}catch(e){peer.decodeErrors.push(e.message);}});
  c.current=()=>current;c.privateState=()=>privateState;
  const sc=attachWsSimClient(c,{ds,pace:'paced',speed:2});sims.push(sc);
  let reply=await c.request({t:'room.join',code},15000);assert.equal(reply.t,'ok',JSON.stringify(reply));
  reply=await c.request({t:'room.ready',ready:true},15000);assert.equal(reply.t,'ok',JSON.stringify(reply));
 }
 await page.waitForFunction(()=>__SP__.store.get().room?.seats.filter(Boolean).length===8);
 await page.evaluate(()=>__SP__.net.request('room.start'));
 await page.waitForFunction(()=>__SP__.store.get().match?.public?.phase==='INFO_CHECK',{timeout:60000});
 for(const c of clients){const reply=await c.request({t:'g.autoplay',on:true},15000);assert.equal(reply.t,'ok',JSON.stringify(reply));}
 await page.evaluate(()=>__SP__.net.request('g.autoplay',{on:true}));
 await page.waitForFunction(()=>globalThis.__SP_RUNNER__?.stats().ticks>10,{timeout:90000});
 if(slow)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 console.log('Eight connected players entered live combat; sampling mobile viewport.');
 await page.evaluate(()=>{
  globalThis.__perfProbe={frames:0,longTasks:[],gaps:[],last:performance.now()};
  const app=__SP_VIEW__?.raw?.debug?.app;app?.ticker.add(()=>__perfProbe.frames++);
  new PerformanceObserver(list=>{for(const e of list.getEntries())__perfProbe.longTasks.push({at:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:false});
  const frame=now=>{__perfProbe.gaps.push(now-__perfProbe.last);__perfProbe.last=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });
 for(let n=0;n<(slow?12:18);n++){
  const t=performance.now();
  const rtts=await Promise.all(clients.map(async(c,i)=>{const start=performance.now();const m=await c.request({t:'ping',c:Date.now()},15000);assert.equal(m.t,'pong');const ms=performance.now()-start;report.peers[i].rtts.push(ms);return ms;}));
  await delay(Math.max(0,5000-(performance.now()-t)));
  const sample=await page.evaluate(()=>({at:Date.now(),phase:__SP__.store.get().match?.public?.phase,round:__SP__.store.get().match?.public?.round,players:__SP__.store.get().match?.public?.players?.length,runner:__SP_RUNNER__?.stats(),battle:__SP_RUNNER__?.state(),frames:__perfProbe.frames,longTaskCount:__perfProbe.longTasks.length,longTaskMax:Math.max(0,...__perfProbe.longTasks.map(t=>t.duration)),gapMax:Math.max(0,...__perfProbe.gaps),renderCap:__SP_VIEW__?.raw?.debug?.app?.ticker.maxFPS}));
  sample.rttMax=Math.max(...rtts);report.samples.push(sample);
  if(n%6===5)console.log(JSON.stringify({elapsed:(n+1)*5,round:sample.round,phase:sample.phase,rttMax:Math.round(sample.rttMax),runnerErrors:sample.runner?.errors}));
 }
 await page.screenshot({path:out+'/live-eight-'+profile+'.png'});
 report.simulations=sims.map(s=>({starts:s.starts.length,results:s.log.filter(m=>m.t==='b.result').length,error:s.error?.message}));
 assert.ok(report.peers.every(p=>p.players===8&&p.deltas>0&&p.decodeErrors.length===0),'all eight receive exact negotiated state');
 assert.ok(report.simulations.every(s=>s.starts>0&&!s.error));
 assert.ok(report.samples.every(s=>s.runner?.errors===0));assert.deepEqual(report.errors,[]);
 report.expectedPreferenceReplies=report.serverErrors.filter(e=>e.code==='ROOM_STARTED'&&e.detail==='stored for the next match'&&['room.diy','room.ownership'].includes(e.request));
 assert.equal(report.expectedPreferenceReplies.length,report.serverErrors.length,'unexpected server errors');
 report.passed=true;
}catch(e){report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{
 for(const s of sims)s.close();
 for(const c of clients){try{const m=await c.request({t:'g.leave'},15000);report.cleanup.push(m.t==='ok');}catch(e){report.cleanup.push(e.message);}await c.terminate();}
 if(created){try{await page.evaluate(()=>__SP__.net.request('g.leave'));report.cleanup.push(true);}catch(e){report.cleanup.push(e.message);}}
 await browser.close();report.finishedAt=new Date().toISOString();await fs.writeFile(out+'/live-eight-'+profile+'.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,failure:report.failure,errors:report.errors,cleanup:report.cleanup,peers:report.peers.map(p=>({players:p.players,deltas:p.deltas,decodeErrors:p.decodeErrors.length})),samples:report.samples.length}));
}

