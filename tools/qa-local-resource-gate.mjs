// Real Edge + the deployed worker wrapper; no production writes or account access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { pinText } from '../server/hot/gateway.mjs';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';
import { patchResourceWorker } from '../deploy/8443-front/resource-desktop-r01/worker-patch.mjs';
import { MIME } from '../server/http/files.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const accepted = path.resolve(root, '../weishu-maintenance/sync-026-extensions-local');
const manifest = JSON.parse(await fs.readFile(path.join(accepted, 'metadata-local-026.json')));
const catalog = resourceRoutingCatalog(manifest);
const probePath = '/assets/ui/settle/settlemen_personal_success.png';
const picks = [probePath,
  '/assets/audio/voice/cn/char_2015_dusk/CN_022.mp3',
  '/assets/local/map/fx/%5Bopt%5Dmerged_textures.png',
  '/assets/audio/bgm/m_bat_act1autochess_loop.mp3'];
for (const ext of ['.atlas', '.skel']) picks.push(Object.entries(manifest.entries).find(([p,i])=>p.endsWith(ext)&&i.bytes>50&&i.bytes<120000)[0]);
for(const pathname of Object.keys(manifest.entries)) if(pathname.startsWith('/fonts/')) picks.push(pathname);
const seed = [];
for (const pathname of picks) {
  assert.ok(manifest.entries[pathname], pathname);
  const item = manifest.entries[pathname];
  const body = await fs.readFile(path.join(accepted, 'server-026/public', decodeURIComponent(pathname)));
  assert.equal(body.length, item.bytes);
  seed.push({ pathname, ...item, body: body.toString('base64') });
}
const assetRequests = [], scriptRequests = [], report = { runs: [], errors: [], pass: false };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pinned = /^\/_build\/([^/]+)(\/.*)$/.exec(url.pathname);
    const generation = pinned?.[1], pathname = pinned?.[2] || url.pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (/^\/(?:assets|fonts|media)\//i.test(pathname)) {
      assetRequests.push(req.url);res.writeHead(503);res.end('Network assets deliberately unavailable');return;
    }
    if (pathname === '/game.html') {
      res.setHeader('Content-Type','text/html');
      if(generation.startsWith('qa-full')) {
        const source=(await fs.readFile(path.join(root,'public/js/browser/game.html'),'utf8')).replace("location.hostname === 'weishuxieyiwangye.cn'",'true');
        res.end(pinText(source,'text/html','/game.html',generation));
      } else res.end('<!doctype html><meta charset="utf-8"><script>window.__SP_LOCAL_RESOURCES_REQUIRED=true;</script><p>Local resource control fixture</p>');
      return;
    }
    if(pathname.startsWith('/api/')) {res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"unauthorized"}');return;}
    if(pathname==='/population'||pathname==='/healthz') {res.setHeader('Content-Type','application/json');res.end('{"ok":true,"online":0}');return;}
    if (pathname === '/data/resource-cache.json') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));return; }
    if (pathname.startsWith('/data/resource-routes/')) {
      const value=catalog.get(path.posix.basename(pathname));res.writeHead(value?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(value||{}));return;
    }
    let file;
    if (pathname.startsWith('/resource-policy/')) file=path.join(root,'deploy/8443-front/resource-desktop-r01',path.posix.basename(pathname));
    else if (pathname.startsWith('/shared/')||pathname.startsWith('/data/')) file=path.join(root,pathname);
    else if (/^\/(js|css|vendor|i18n)\//.test(pathname)) file=path.join(root,'public',pathname);
    else {res.writeHead(404);res.end();return;}
    let source;
    try{source=await fs.readFile(file,'utf8');}catch{source=await fs.readFile(path.join(accepted,'server-026',path.relative(root,file)),'utf8');}
    const type=MIME[path.extname(pathname)]||'text/javascript';
    if (generation) source=pinText(source,type,pathname,generation);
    if (pathname==='/js/resources/worker.js') {
      scriptRequests.push(req.url);
      await new Promise(r=>setTimeout(r,500));
      source=patchResourceWorker(source);
      res.setHeader('Service-Worker-Allowed','/');
    }
    res.setHeader('Content-Type',type);res.end(source);
  } catch(error) {res.writeHead(404);res.end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(origin+'/_build/qa-first/game.html');
  // Both cache layouts used by already delivered resource packs remain readable.
  await page.evaluate(async seed=>{
    const {resourceCaches}=await import('/resource-policy/cache-store.mjs');
    for (const [i,item] of seed.entries()) {
      const bytes=Uint8Array.from(atob(item.body),c=>c.charCodeAt(0));
      const cache=await (i%2?resourceCaches:caches).open('sp-resource-content-v1');
      const headers={'Content-Type':item.type,'Content-Length':String(bytes.length),'x-sp-resource-bytes':String(bytes.length)};
      await cache.put(location.origin+'/__sp_resource_content/'+item.hash,new Response(bytes,{headers}));
    }
  },seed.map(item=>({...item,type:MIME[path.extname(item.pathname)]||'application/octet-stream'})));
  for (const id of ['qa-first','qa-next']) {
    if(id!=='qa-first') await page.goto(origin+'/_build/'+id+'/game.html');
    const result=await page.evaluate(async({id,seed})=>{
      const base='/_build/'+id+'/';
      // Reproduce the front entry's early registration followed by the game boot guard.
      const early=navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base,updateViaCache:'none'});
      const client=await import(base+'js/resources/client.js');
      const at=performance.now();
      await client.requireLocalResourceController();
      await early;
      const tests=[];
      for(const item of seed) {
        const plain=item.pathname,hashed=plain.replace(/^\/(assets|fonts)\//,'/$1/~'+item.hash.slice(0,16)+'/');
        const variant=plain.includes('/CN_')?plain.replace('/CN_','/cn_'):plain.includes('%5B')?decodeURI(plain):plain;
        for(const target of new Set([base+plain.slice(1),base+hashed.slice(1),base+variant.slice(1),plain])) {
          const r=await fetch(target,{cache:'reload'}),body=await r.arrayBuffer();
          tests.push({path:target,status:r.status,hit:r.headers.get('x-sp-resource-cache'),bytes:body.byteLength,expected:item.bytes});
        }
      }
      const range=await fetch(base+seed[3].pathname.slice(1),{headers:{Range:'bytes=0-31'},cache:'reload'});
      const rangeBody=await range.arrayBuffer();
      const missing=await fetch(base+'assets/audio/bgm/does-not-exist.mp3',{cache:'reload'});
      const missingHit=missing.headers.get('x-sp-resource-cache');
      const ctx=new AudioContext(),decoded=await ctx.decodeAudioData(await missing.arrayBuffer());
      const silentSeconds=decoded.duration;await ctx.close();
      const art=await fetch(base+'assets/does-not-exist.png',{cache:'reload'});await art.arrayBuffer();
      const invalid=await fetch(base+seed[0].pathname.slice(1),{headers:{Range:'bytes=0-1,3-4'},cache:'reload'});await invalid.arrayBuffer();
      return {id,waitMs:performance.now()-at,controller:navigator.serviceWorker.controller?.scriptURL,tests,
        range:{status:range.status,bytes:rangeBody.byteLength,hit:range.headers.get('x-sp-resource-cache')},missingHit,silentSeconds,missingArtStatus:art.status,invalidRangeStatus:invalid.status};
    },{id,seed:seed.map(({body,...v})=>v)});
    assert.equal(result.controller,origin+'/_build/'+id+'/js/resources/worker.js?localOnly=1');
    for(const test of result.tests) {assert.equal(test.status,200,test.path);assert.equal(test.hit,'HIT',test.path);assert.equal(test.bytes,test.expected,test.path);}
    assert.deepEqual(result.range,{status:206,bytes:32,hit:'HIT'});
    assert.equal(result.missingHit,'LOCAL-MISSING');assert.equal(result.silentSeconds,1);
    assert.equal(result.missingArtStatus,503);assert.equal(result.invalidRangeStatus,416);
    assert.deepEqual(assetRequests,[],'zero asset requests to the server');
    report.runs.push(result);console.log(JSON.stringify({id,pass:true,tests:result.tests.length,assetRequests:assetRequests.length}));
  }
  await page.goto(origin+'/_build/qa-full/game.html');
  await page.waitForFunction(()=>window.__SP__&&document.getElementById('boot')?.classList.contains('is-done'),{timeout:30000});
  report.fullBoot=await page.evaluate(()=>({controller:navigator.serviceWorker.controller?.scriptURL,fontsHref:document.querySelector('link[data-sp-resource-href]')?.href,text:document.getElementById('app')?.innerText.slice(0,200)}));
  assert.equal(report.fullBoot.controller,origin+'/_build/qa-full/js/resources/worker.js?localOnly=1');
  assert.equal(report.fullBoot.fontsHref,origin+'/_build/qa-full/fonts/fonts.css');
  assert.deepEqual(assetRequests,[],'even the complete game startup does not fetch assets before worker control');
  await page.evaluate(async hash=>{
    const {resourceCaches}=await import('/resource-policy/cache-store.mjs');
    await(await resourceCaches.open('sp-resource-content-v1')).delete(location.origin+'/__sp_resource_content/'+hash);
  },manifest.entries[probePath].hash);
  await page.goto(origin+'/_build/qa-missing/game.html');
  report.rejectedMissingProbe=await page.evaluate(async()=>{
    try {await(await import('/_build/qa-missing/js/resources/client.js')).requireLocalResourceController();return false;}catch(e){return /未能实际读取/.test(e.message);}
  });
  assert.equal(report.rejectedMissingProbe,true);assert.deepEqual(assetRequests,[]);
  await page.goto(origin+'/_build/qa-full-missing/game.html');
  await page.waitForFunction(()=>document.querySelector('#boot-err a'),{timeout:30000});
  report.fullBootMissing=await page.evaluate(()=>({started:!!window.__SP__,message:document.getElementById('boot-err').innerText,back:document.querySelector('#boot-err a').getAttribute('href')}));
  assert.equal(report.fullBootMissing.started,false);
  assert.match(report.fullBootMissing.message,/未能实际读取/);
  assert.equal(report.fullBootMissing.back,'/#resource-pack');
  assert.deepEqual(assetRequests,[]);
  await page.goto(origin+'/_build/qa-native/game.html');
  const before=scriptRequests.length;
  report.native=await page.evaluate(async()=>{
    window.SPAndroidResources={getManifest(){return '{}';}};
    await(await import('/_build/qa-native/js/resources/client.js')).requireLocalResourceController();
    return {controller:navigator.serviceWorker.controller?.scriptURL??null};
  });
  assert.equal(report.native.controller,null);assert.equal(scriptRequests.length,before);
  assert.deepEqual(report.errors,[]);report.pass=true;
} catch(error) {report.error=error.stack;process.exitCode=1;}
finally {
  await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  report.assetRequests=assetRequests;report.workerRequests=scriptRequests;
  await fs.mkdir(path.join(root,'.cache'),{recursive:true});
  await fs.writeFile(path.join(root,'.cache/local-resource-gate-qa.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,error:report.error,assetRequests,errors:report.errors}));
}
