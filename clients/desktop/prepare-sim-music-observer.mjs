import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const require=createRequire(import.meta.url);
const {parse}=require(path.join(root,'node_modules/acorn'));
const sha=text=>createHash('sha256').update(text).digest('hex');
const files=[
  {url:'/js/browser/sim.js',file:'public/js/browser/sim.js',freeze:true,wind:true},
  {url:'/sim/battle/status.js',file:'server/sim/battle/status.js',freeze:true},
  {url:'/sim/content/devices.js',file:'server/sim/content/devices.js',wind:true},
];
function walk(node,ancestors,visit){
  if(!node||typeof node!=='object')return;
  if(typeof node.type==='string')visit(node,ancestors);
  const next=typeof node.type==='string'?[...ancestors,node]:ancestors;
  for(const [key,value]of Object.entries(node)){
    if(key==='start'||key==='end')continue;
    if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object')walk(child,next,visit);}
    else if(value&&typeof value==='object')walk(value,next,visit);
  }
}
const keyName=n=>n?.name??n?.value;
const paramName=n=>n?.type==='Identifier'?n.name:n?.type==='AssignmentPattern'&&n.left?.type==='Identifier'?n.left.name:null;
const oldPlan=JSON.parse(await fs.readFile(path.join(here,'compat-025-sim-music-plan.json'),'utf8'));
const {pinText}=await import(new URL('../../server/hot/gateway.mjs',import.meta.url));
const plans={};
for(const spec of files){
  const canonical=await fs.readFile(path.join(root,spec.file),'utf8');
  for(const [variant,text]of [['canonical',canonical],['SP_BUILD_TEMPLATE',pinText(canonical,'text/javascript',spec.url,'SP_BUILD_TEMPLATE')]]){
  assert.ok(!text.includes('__spDesktopFreezeKnown')&&!text.includes('__spDesktopWindToken'));
  const ast=parse(text,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
  let freezeCount=0,windCount=0;
  walk(ast,[],(node,ancestors)=>{
    if(spec.freeze&&node.type==='MethodDefinition'&&keyName(node.key)==='applyStatus'){
      freezeCount++;
      const fn=node.value,[target,key,opts]=fn.params.map(paramName);
      assert.ok(target&&key&&opts,'applyStatus parameters must be simple identifiers');
      const before=`;let __spDesktopFreezeKnown=false,__spDesktopFreezeBefore=false;try{if(${key}==='freeze'&&${target}&&typeof ${target}.findBuff==='function'){__spDesktopFreezeBefore=!!${target}.findBuff('freeze');__spDesktopFreezeKnown=true;}}catch{}try{`;
      const after=`}finally{try{if(__spDesktopFreezeKnown&&!__spDesktopFreezeBefore&&${key}==='freeze'&&${target}?.findBuff('freeze'))globalThis.__SPDesktopMusicBridge?.freeze?.(this,${target},${opts}?.source);}catch{}}`;
      edits.push({offset:fn.body.start+1,text:before},{offset:fn.body.end-1,text:after});
    }
    if(spec.wind&&node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&keyName(node.callee.property)==='fx'&&node.arguments[0]?.value==='coldWind'){
      const object=node.arguments[1];
      const prop=object?.type==='ObjectExpression'&&object.properties.find(p=>p.type==='Property'&&keyName(p.key)==='playerId');
      if(!prop)return;
      const arrow=[...ancestors].reverse().find(p=>p.type==='ArrowFunctionExpression');
      assert.ok(arrow?.body?.type==='BlockStatement','coldWind must be inside a block-bodied gust arrow');
      windCount++;
      const battle=text.slice(node.callee.object.start,node.callee.object.end),pid=text.slice(prop.value.start,prop.value.end);
      assert.match(battle,/^[A-Za-z_$][\w$]*$/);assert.match(pid,/^[A-Za-z_$][\w$]*$/);
      edits.push({offset:arrow.body.start+1,text:`;let __spDesktopWindToken;try{__spDesktopWindToken=globalThis.__SPDesktopMusicBridge?.enterWind?.(${battle},${pid});}catch{}try{`},
        {offset:arrow.body.end-1,text:`}finally{try{globalThis.__SPDesktopMusicBridge?.exitWind?.(__spDesktopWindToken);}catch{}}`});
    }
  });
  assert.equal(freezeCount,spec.freeze?1:0,spec.file+' freeze method count');
  assert.equal(windCount,spec.wind?1:0,spec.file+' wind scope count');
  edits.sort((a,b)=>b.offset-a.offset);
  assert.equal(new Set(edits.map(e=>e.offset)).size,edits.length,'edits must not overlap');
  let output=text;for(const edit of edits)output=output.slice(0,edit.offset)+edit.text+output.slice(edit.offset);
  parse(output,{ecmaVersion:'latest',sourceType:'module'});
  const entry={variant,sha256:sha(text),bytes:Buffer.byteLength(text),edits,transformedSha256:sha(output),freezeMethods:freezeCount,windScopes:windCount};
  if(variant==='canonical')plans[spec.url]={...entry,variants:[{...oldPlan.files[spec.url],variant:'0.2.5-canonical'}]};else plans[spec.url].variants.push(entry);
  }
}
// Keep previously delivered 0.2.6 observers while adding this release's exact hashes.
for(const previousFile of ['compat-026-sim-music-observer-plan.json','compat-107-r01-sim-music-plan.json','compat-107-r02-sim-music-plan.json']){
const previous=JSON.parse(await fs.readFile(path.join(here,previousFile),'utf8'));
for(const [url,plan] of Object.entries(plans)){
  const older=previous.files[url];
  for(const entry of [older,...(older?.variants||[])].filter(Boolean)){
    if(entry.sha256===plan.sha256||plan.variants.some(v=>v.sha256===entry.sha256))continue;
    const {variants,...variant}=entry; plan.variants.push({...variant,variant:'0.2.6-previous-'+(variant.variant||'canonical')});
  }
}
}
const body=JSON.stringify({format:1,origin:'https://weishuxieyiwangye.cn:8443',files:plans},null,2)+'\n';
await fs.writeFile(path.join(here,'sim-music-observer-plan.json'),body);
console.log(JSON.stringify({ok:true,planBytes:Buffer.byteLength(body),files:Object.fromEntries(Object.entries(plans).map(([key,value])=>[key,{sha256:value.sha256,edits:value.edits.length,freezeMethods:value.freezeMethods,windScopes:value.windScopes}]))}));
