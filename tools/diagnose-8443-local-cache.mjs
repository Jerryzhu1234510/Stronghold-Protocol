// Read-only production probe; no login, rooms, cache clearing or server mutations.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import http from 'node:http';
import {createProxyHandler} from '../deploy/8443-front/resource-desktop-r01/proxy-transfer-r02.mjs';
import {pinText} from '../server/hot/gateway.mjs';
let proxy;
if(process.env.SP_LOCAL_GATEWAY){
 const upstream=new URL(process.env.SP_LOCAL_GATEWAY);
 const forward=createProxyHandler({host:upstream.hostname,port:Number(upstream.port),headers:req=>req.headers});
 proxy=http.createServer(async(req,res)=>{
  if(process.env.SP_POLICY_CANDIDATE&&/\/_build\/[^/]+\/js\/resources\/policy\.js$/.test(req.url)){
   const generation=req.url.split('/')[2];res.setHeader('Content-Type','text/javascript');
   const source=await fs.readFile(new URL('../public/js/resources/policy.js',import.meta.url),'utf8');
   res.end(pinText(source,'text/javascript','/js/resources/policy.js',generation));return;
  }
  if(/^\/resource-policy\/(cache-store|compat)\.mjs$/.test(req.url)){
   const name=req.url.slice('/resource-policy/'.length);res.setHeader('Content-Type','text/javascript');
   res.end(await fs.readFile(new URL('../deploy/8443-front/resource-desktop-r01/'+name,import.meta.url)));return;
  }
  forward(req,res);
 });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
}
const origin=proxy?'http://127.0.0.1:'+proxy.address().port:'https://weishuxieyiwangye.cn:8443',build=process.env.SP_DIAG_BUILD||'3585f364453b-1',base='/_build/'+build+'/';
const report={at:new Date().toISOString(),build,errors:[]};
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
  args:['--no-proxy-server','--host-resolver-rules=MAP weishuxieyiwangye.cn 103.205.253.194']});
try{
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+base+'data/resource-cache.json',{waitUntil:'domcontentloaded',timeout:60000});
 report.cache=await page.evaluate(async ({base})=>{
  const manifest=JSON.parse(document.body.innerText);
  const aliases=Object.entries(manifest.aliases||{});
  const reg=await navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base,updateViaCache:'none'});
  for(let i=0;i<100&&!reg.active;i++)await new Promise(r=>setTimeout(r,100));
  if(!reg.active)throw Error('Worker did not activate');
  for(let i=0;i<100&&!navigator.serviceWorker.controller;i++)await new Promise(r=>setTimeout(r,100));
  const ready=await new Promise((resolve,reject)=>{const c=new MessageChannel();const timer=setTimeout(()=>reject(Error('Worker readiness timed out')),30000);c.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data)};reg.active.postMessage({action:'ready',enabled:true},[c.port2])});
  const {resourceCaches}=await import('/resource-policy/cache-store.mjs');
  const content=await resourceCaches.open('sp-resource-content-v1');
  const entries=Object.entries(manifest.entries);
  const selected=['.png','.atlas','.skel','.mp3'].map(ext=>entries.filter(([url,item])=>url.endsWith(ext)&&item.bytes>50&&item.bytes<120000).sort((a,b)=>a[1].bytes-b[1].bytes)[0]).filter(Boolean);
  for(const path of ['/assets/audio/voice/cn/char_2015_dusk/CN_022.mp3','/assets/local/map/fx/%5Bopt%5Dmerged_textures.png'])if(manifest.entries[path])selected.push([path,manifest.entries[path]]);
  const samples=[];
  for(const [path,item] of selected){
   const url=base+path.slice(1),first=await fetch(url,{cache:'reload'}),body=await first.arrayBuffer();
   if(body.byteLength!==item.bytes)throw Error('Probe asset mismatch '+path);
   const key=location.origin+'/__sp_resource_content/'+item.hash;
   await content.put(key,new Response(body,{headers:{'content-length':String(item.bytes),'x-sp-resource-bytes':String(item.bytes)}}));
   const again=await fetch(url,{cache:'reload'});await again.arrayBuffer();
   const hashed=path.replace(/^\/(assets|fonts)\//,'/$1/~'+item.hash.slice(0,16)+'/');
   const immutable=await fetch(base+hashed.slice(1),{cache:'reload'});await immutable.arrayBuffer();
   const alias=aliases.find(([,target])=>target===path||target===base.slice(0,-1)+path)?.[0];
   let media=null;if(alias){const r=await fetch(base+alias.slice(1),{cache:'reload'});media={url:alias,status:r.status,hit:r.headers.get('x-sp-resource-cache')};await r.arrayBuffer()}
   const variantPath=path.includes('%5B')?decodeURI(path):path.includes('/CN_')?path.replace('/CN_','/cn_'):null;
   let variant=null;if(variantPath){const r=await fetch(base+variantPath.slice(1),{cache:'reload'});variant={path:variantPath,status:r.status,hit:r.headers.get('x-sp-resource-cache')};await r.arrayBuffer()}
   samples.push({path,bytes:item.bytes,hit:again.headers.get('x-sp-resource-cache'),hashedHit:immutable.headers.get('x-sp-resource-cache'),media,variant});
  }
  return {controller:navigator.serviceWorker.controller?.scriptURL,ready,pinnedAliases:aliases.filter(([,v])=>v.startsWith('/_build/')).length,aliases:aliases.length,samples};
 },{base});
 if(process.env.SP_POLICY_CANDIDATE&&report.cache.samples.some(s=>s.variant&&s.variant.hit!=='HIT'))throw Error('Candidate still bypasses imported content');
}catch(error){report.error=error.stack;process.exitCode=1}
finally{await browser.close();proxy?.closeAllConnections();proxy?.close();await fs.mkdir('.cache',{recursive:true});await fs.writeFile('.cache/8443-local-cache-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
