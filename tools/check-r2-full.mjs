// Run with our own headless Edge profile; never attaches to the user's browser.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=path.resolve(process.argv[2]);
const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
const unique=[...new Map(manifest.entries.map(e=>[e.key,e])).values()];
const chosen=new Map();
const select=e=>{if(e)chosen.set(e.key,e);};
for(const extension of ['.mp3','.png','.webp','.json','.obj','.atlas','.skel','.ttf','.woff2','.otf','.css']) {
  const candidates=unique.filter(e=>e.path.endsWith(extension)&&e.bytes>1024&&e.bytes<4*1024*1024)
    .sort((a,b)=>a.bytes-b.bytes);
  select(candidates[Math.floor(candidates.length/2)]);
}
// Keep a complete new character's skeleton/atlas/texture in the acceptance set.
const atlas=unique.find(e=>e.path.includes('/spine/op/')&&e.path.endsWith('.atlas')&&e.key.startsWith('pilot/content/'));
if(atlas)for(const extension of ['.atlas','.skel','.png'])select(manifest.entries.find(e=>e.path===atlas.path.slice(0,-6)+extension));
const files=[...chosen.values()];
const profile=await fs.mkdtemp(path.join(directory,'qa-profile-'));
const report={at:new Date().toISOString(),files:files.length,phases:[],pageErrors:[],pass:false};
let browser;
try {
  browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:profile});
  const page=await browser.newPage();
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto('https://weishuxieyi.icu/resource-test/',{waitUntil:'networkidle2',timeout:60000});
  const session=await page.createCDPSession();await session.send('Network.enable');
  let phase;
  session.on('Network.responseReceived',e=>{
    if(!phase||!e.response.url.startsWith(manifest.base))return;
    const header=name=>Object.entries(e.response.headers).find(([key])=>key.toLowerCase()===name)?.[1]??null;
    phase.network.push({url:e.response.url,status:e.response.status,cacheStatus:header('cf-cache-status'),
      encoding:header('content-encoding'),cors:header('access-control-allow-origin')});
  });
  for(const name of ['first','repeat']) {
    phase={name,network:[]};report.phases.push(phase);
    phase.results=await page.evaluate(async (files,base)=>{
      const results=[];
      for(const file of files) {
        const response=await fetch(base+file.key,{mode:'cors',credentials:'omit',cache:'reload',signal:AbortSignal.timeout(30000)});
        const data=await response.arrayBuffer();
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
        const row={path:file.path,status:response.status,bytes:data.byteLength,hashCorrect:hash===file.hash,
          contentType:response.headers.get('content-type'),decode:'not-needed'};
        if(/\.(png|webp)$/.test(file.path)) {
          const bitmap=await createImageBitmap(new Blob([data],{type:row.contentType}));
          row.decode='image';row.dimensions=[bitmap.width,bitmap.height];bitmap.close();
        } else if(/\.json$/.test(file.path)) {
          JSON.parse(new TextDecoder().decode(data));row.decode='json';
        } else if(/\.(woff2|ttf|otf)$/.test(file.path)) {
          const face=new FontFace('R2Acceptance-'+results.length,data);await face.load();row.decode='font';
        } else if(/\.mp3$/.test(file.path)) {
          const context=new AudioContext();
          try {const audio=await context.decodeAudioData(data.slice(0));row.decode='audio';row.seconds=audio.duration;}
          finally {await context.close();}
        }
        results.push(row);
      }
      return results;
    },files,manifest.base);
    for(let i=0;i<files.length;i++) {
      assert.equal(phase.results[i].status,200);
      assert.equal(phase.results[i].bytes,files[i].bytes);
      assert.ok(phase.results[i].hashCorrect);
    }
    console.log(JSON.stringify({phase:name,verifiedFiles:phase.results.length}));
  }
  const repeated=report.phases[1].network;
  assert.equal(repeated.length,files.length);
  assert.ok(repeated.every(x=>x.cacheStatus==='HIT'&&x.cors==='https://weishuxieyi.icu'));
  for(const row of repeated.filter(x=>/\.(atlas|skel)$/.test(new URL(x.url).pathname)))assert.ok(['br','gzip','zstd'].includes(row.encoding));
  const audio=files.find(e=>e.path.endsWith('.mp3'));
  if(audio) {
    report.range=await page.evaluate(async (file,base)=>{
      const response=await fetch(base+file.key,{headers:{Range:'bytes=0-99'},mode:'cors',credentials:'omit',signal:AbortSignal.timeout(30000)});
      return {status:response.status,bytes:(await response.arrayBuffer()).byteLength,range:response.headers.get('content-range')};
    },audio,manifest.base);
    assert.equal(report.range.status,206);assert.equal(report.range.bytes,100);
  }
  assert.deepEqual(report.pageErrors,[]);report.pass=true;
} catch(error) {report.error=error.stack;process.exitCode=1;}
finally {
  await browser?.close();
  await fs.writeFile(path.join(directory,'browser-download-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,files:report.files,error:report.error}));
}
