import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),require=createRequire(import.meta.url);
const {parse}=require(path.join(root,'node_modules/acorn'));
const sha=text=>createHash('sha256').update(text).digest('hex');
const oldPlan=JSON.parse(await fs.readFile(path.join(here,'compat-025-unit-motion-plan.json'),'utf8'));
const {pinText}=await import(new URL('../../server/hot/gateway.mjs',import.meta.url));
const frozenBuild='SP_BUILD_TEMPLATE';
const frozenImports=(text,url)=>pinText(text,'text/javascript',url,frozenBuild);
function walk(node,ancestors,visit){if(!node||typeof node!=='object')return;if(typeof node.type==='string')visit(node,ancestors);const next=typeof node.type==='string'?[...ancestors,node]:ancestors;for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object')walk(child,next,visit);}else if(value&&typeof value==='object')walk(value,next,visit);}}
const files={};
for(const [url,file]of [['/js/render/units.js','public/js/render/units.js'],['/js/ui/fallbackField.js','public/js/ui/fallbackField.js']]){
  const canonical=await fs.readFile(path.join(root,file),'utf8'),frozen=frozenImports(canonical,url);
  files[url]={variants:oldPlan.files[url].variants.map(v=>({...v,variant:v.variant==='canonical'?'0.2.5-canonical':v.variant}))};
  for(const [variant,text]of [['canonical',canonical],[frozenBuild,frozen]]){
  const ast=parse(text,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
  if(url.includes('/render/')){
    let update=0,destroy=0;
    walk(ast,[],(node,ancestors)=>{
      if(node.type!=='MethodDefinition'||!ancestors.some(a=>a.type==='ClassDeclaration'&&a.id?.name==='UnitView'))return;
      if(node.key.name==='update'){
        update++;const fn=node.value,params=fn.params.map(p=>p.name);assert.deepEqual(params,['dt','cam','t']);
        edits.push({offset:fn.body.start+1,text:'try{'},{offset:fn.body.end-1,text:'}finally{try{globalThis.__SPDesktopUnitMotion?.step3d?.(this,dt,cam,t);}catch{}}'});
      }else if(node.key.name==='destroy'){destroy++;edits.push({offset:node.value.body.start+1,text:'try{globalThis.__SPDesktopUnitMotion?.drop3d?.(this);}catch{}'});}
    });
    assert.equal(update,1);assert.equal(destroy,1);
  }else{
    for(const [name,anchor,expression]of [
      ['Piece','<div class="ff-piece__art"',"{kind:p.kind==='chess'?'op':p.kind,side:'ally',id:'p:'+p.uid},L.tile,{prep:true,area}"],
      ['BattleUnit','<div class="ff-unit__art"',"info,L.tile,{prep:!!st.field?.prep,fieldId:st.field?.fieldId,dead}"],
    ]){
      let found=0;
      walk(ast,[],node=>{
        if(node.type!=='FunctionDeclaration'||node.id?.name!==name)return;
        const section=text.slice(node.start,node.end),at=section.indexOf(anchor);assert.ok(at>=0&&section.indexOf(anchor,at+1)<0);found++;
        edits.push({offset:node.start+at+anchor.length,text:' ref=${(() => {try{return globalThis.__SPDesktopUnitMotion?.ref?.('+expression+');}catch{return undefined;}})()}'});
      });assert.equal(found,1);
    }
    let destroy=0;walk(ast,[],(node,ancestors)=>{if(node.type==='Property'&&node.method&&node.key.name==='destroy'&&ancestors.some(a=>a.type==='FunctionDeclaration'&&a.id?.name==='createFallbackView')){destroy++;edits.push({offset:node.value.body.start+1,text:'try{globalThis.__SPDesktopUnitMotion?.dropDomView?.(root);}catch{}'});}});assert.equal(destroy,1);
  }
  edits.sort((a,b)=>b.offset-a.offset);let out=text;for(const edit of edits)out=out.slice(0,edit.offset)+edit.text+out.slice(edit.offset);
  parse(out,{ecmaVersion:'latest',sourceType:'module'});
  files[url].variants.push({variant,sha256:sha(text),bytes:Buffer.byteLength(text),edits,transformedSha256:sha(out)});
  }
}
const result=JSON.stringify({format:2,origin:'https://weishuxieyiwangye.cn:8443',files},null,2)+'\n';
await fs.writeFile(path.join(here,'unit-motion-observer-plan.json'),result);console.log(JSON.stringify({ok:true,bytes:Buffer.byteLength(result),paths:Object.keys(files)}));
