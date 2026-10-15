import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..'),require=createRequire(import.meta.url);
const {instrument,transformResponse}=require('../unit-motion-observer.cjs'),{installUnitMotion}=require('../unit-motion.cjs');
const {parse}=require(path.join(root,'node_modules/acorn'));
let checks=0;const eq=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};const ok=(a,msg)=>{assert.ok(a,msg);checks++;};
const renderPath=path.join(root,'public/js/render/units.js'),source=await fs.readFile(renderPath,'utf8'),observed=instrument(source,'/js/render/units.js');ok(observed!==source);parse(observed,{ecmaVersion:'latest',sourceType:'module'});checks++;
const rewritten=observed.replace(/from\s+(['"])([^'"]+)\1/g,(_all,_q,specifier)=>'from '+JSON.stringify(new URL(specifier,pathToFileURL(renderPath)).href));
const {installFakePixi,fakeViewCtx}=await import(pathToFileURL(path.join(root,'test/render/fakepixi.js')));
const {presetCamera}=await import(pathToFileURL(path.join(root,'public/js/render/projection.js')));
const fake=installFakePixi(),priorStore=globalThis.__SP__;
let state={connection:{status:'online'},me:{playerId:'me'},room:{inMatch:true,seats:[{playerId:'me'}]},match:{public:{phase:'COMBAT',players:[{playerId:'me'}]}}};const subs=new Set();globalThis.__SP__={store:{get:()=>state,subscribe(fn){subs.add(fn);return()=>subs.delete(fn);}}};
const api=installUnitMotion({motion:{target:'own',bounceHeight:0.2,bounceHz:1,spinRps:0.5}}),views=[];
try{
 const {UnitView}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
 const cam=presetCamera('prep',{width:1280,height:720});
 const assets=spine=>({picture:()=>null,image:async()=>null,spineEntry:()=>spine?{skel:'/x',atlas:'/a',textures:['/p'],anims:{idle:'Idle'},animations:{Idle:1}}:null,spine:{acquire:async()=>({animations:[{name:'Idle'}]}),release(){}}});
 for(const spine of [false,true]){
  const ctx=fakeViewCtx(fake.P,{assets:assets(spine),cam:()=>cam});
  const v=new UnitView(ctx,{id:spine?2:1,ownerId:'me',kind:'op',side:'ally',defId:'test_a',spine:'test_a',avatar:'test_a',tier:3,x:5,y:10,maxHp:500,dir:'LEFT'});views.push(v);
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));v.body.scale.set(-2,3);v.update(1/60,cam,0.5);
  ok(v.body.y<0,'real model body lifted');ok(v.body.rotation>1,'real model body rotates');eq(v.x,5,'world x unchanged');eq(v.y,10,'world y unchanged');eq(v.hp,500,'HP unchanged');eq(v.dir,'LEFT','facing unchanged');
  eq(v.body.parent,v.root,'body remains independent subnode');ok(v.shadow.parent!==v.body&&v.hud.parent!==v.body,'shadow and HUD are siblings');if(spine)ok(v.spineReady,'actual Spine main path exercised');else ok(!!v.fallback,'avatar fallback path exercised');
  api.configure({motion:{target:'own',bounceHeight:.3,bounceHz:1,spinRps:1,flipX:true,flipY:true}});v.update(1/60,cam,.5);eq(v.body.scale.x,2,'actual source body X flip relative to negative baseline');eq(v.body.scale.y,-3,'actual source body Y flip');ok(v.body.y<0&&v.body.rotation>3,'flip jump and turn combine');eq(v.dir,'LEFT','actual flip leaves facing');
  const x=v.root.position.x,y=v.root.position.y;api.configure({motion:null});eq(v.body.y,0,'disable restores real body');eq(v.body.rotation,0,'disable restores real rotation');eq(v.body.scale.x,-2,'disable restores actual negative scale X');eq(v.body.scale.y,3,'disable restores actual scale Y');eq(v.root.position.x,x,'disable leaves root x');eq(v.root.position.y,y,'disable leaves root y');api.configure({motion:{target:'own',bounceHeight:0.2,bounceHz:1,spinRps:0.5,flipX:true}});v.update(1/60,cam,0.5);v.destroy();eq(api.status.views,0,'actual destroy releases registration');eq(v.body.scale.x,-2,'destroy restores actual negative scale');
 }
 const fallback=await fs.readFile(path.join(root,'public/js/ui/fallbackField.js'),'utf8'),changed=instrument(fallback,'/_build/test/js/ui/fallbackField.js');ok(fallback!==changed);const ast=parse(changed,{ecmaVersion:'latest',sourceType:'module'});checks++;
 const nodes=[];
 // Explicit traversal avoids depending on a browser renderer; execute the actual transformed component functions.
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&['Piece','BattleUnit'].includes(n.id?.name))nodes.push(n);for(const value of Object.values(n)){if(Array.isArray(value)){for(const c of value)visit(c);}else if(value&&typeof value==='object')visit(value);}}visit(ast);eq(nodes.length,2,'two exact DOM-art components');
 const infos=[],callbacks=[];const bridge={ref(...args){infos.push(args);const cb=api.ref(...args);callbacks.push(cb);return cb;}};
 const context={__SPDesktopUnitMotion:bridge,html:(strings,...values)=>({strings,values}),TierChip(){},cx:(...values)=>values.filter(Boolean).join(' '),pieceArt:()=>null,pieceName:()=> 'operator',lookup:()=>({tier:3}),unitArt:()=>null,m:()=>null,hasFlag:()=>false,UF:{SKILL:1,STUNNED:2,FROZEN:4,SLEEP:8,FLYING:16},st:{drag:null,editable:false,held:new Map(),dirs:new Map(),rect:{c0:2,r1:12},field:{fieldId:'n:me'},units:new Map([[10,{id:10,kind:'op',side:'ally',ownerId:'me',name:'test'}]]),snapUnits:new Map([[10,[10,5,10,100,100,0,0,0,0]]])}};
 for(const node of nodes){const fn=vm.runInNewContext('('+changed.slice(node.start,node.end)+')',context);if(node.id.name==='Piece')fn({p:{uid:7,kind:'chess',id:'test_a',tier:3},x:1,y:2,L:{tile:100},area:'board'});else fn({id:10,L:{tile:100}});}
 eq(infos.length,2,'actual functions call local art refs');eq(infos[0][0].kind,'op','prep chess normalized only at visual bridge');eq(infos[1][0].ownerId,'me','battle unit exact owner retained');
 const elements=callbacks.map(cb=>{const element={style:{scale:'-1 2'},animations:[],animate(frames,options){const item={frames,options,cancel(){this.cancelled=true;}};this.animations.push(item);return item;}};cb(element);return element;});ok(elements.every(el=>el.animations.length===2),'actual ref outputs animate only art elements');ok(elements.every(el=>el.style.scale==='1 2'),'actual ref routes flip into art scale');
 api.dropDomView({contains:el=>elements.includes(el)});ok(elements.every(el=>el.animations.every(a=>a.cancelled)),'fallback destroy restores art animations');ok(elements.every(el=>el.style.scale==='-1 2'),'fallback destroy restores original art scale');
 eq(instrument(source+'\n','/js/render/units.js'),source+'\n','unknown source hash untouched');eq(instrument(source,'/js/render/other.js'),source,'unrelated source untouched');
 const request=new Request('https://weishuxieyiwangye.cn:8443/_build/test/js/render/units.js'),response=new Response(source,{headers:{'content-type':'text/javascript','etag':'old','content-length':'123','content-security-policy':"default-src 'none'"}}),result=await transformResponse(request,response);
 eq(await result.text(),observed,'response contains exact observer source');eq(result.headers.get('etag'),null,'old ETag removed');eq(result.headers.get('content-length'),null,'old length removed');eq(result.headers.get('content-type'),'text/javascript','MIME retained');eq(result.headers.get('content-security-policy'),"default-src 'none'",'CSP retained');
 const peer=new Request('https://weishuxieyi.icu/js/render/units.js');eq(await transformResponse(peer,response),response,'other server untouched');
 // The fixed gateway freezes imports into a build namespace. Regenerate that known variant from canonical AST,
 // then require exact preservation of every frozen import while using the variant's own insertion offsets.
 for(const [url,file,snapshot]of [['/js/render/units.js','public/js/render/units.js','live-units.js'],['/js/ui/fallbackField.js','public/js/ui/fallbackField.js','live-fallbackField.js']]){
  const original=await fs.readFile(path.join(root,file),'utf8'),tree=parse(original,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
  for(const node of tree.body)if(node.source?.type==='Literal'&&['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type))edits.push({start:node.source.start+1,end:node.source.end-1,text:'/_build/local026-test-1'+new URL(node.source.value,'https://weishuxieyiwangye.cn'+url).pathname});
  let frozen=original;for(const edit of edits.sort((a,b)=>b.start-a.start))frozen=frozen.slice(0,edit.start)+edit.text+frozen.slice(edit.end);
  let live;try{live=await fs.readFile(path.join(root,'test-output',snapshot),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(live!==undefined)eq(frozen,live,'reconstructed source exactly matches downloaded production snapshot');
  const output=instrument(frozen,'/_build/local026-test-1'+url);ok(output!==frozen,'known production hash instrumented');
  const frozenImports=parse(frozen,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.source).map(n=>n.source.value);
  const preservedImports=parse(output,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.source).map(n=>n.source.value);
  assert.deepEqual(preservedImports,frozenImports,'frozen imports retained exactly');checks++;
  const production=await transformResponse(new Request('https://weishuxieyiwangye.cn:8443/_build/local026-test-1'+url),new Response(frozen,{headers:{'content-type':'text/javascript'}}));
  eq(await production.text(),output,'production-namespaced response uses exact variant transform');eq(instrument(frozen+'\n',url),frozen+'\n','unknown production bytes untouched');
 }
 console.log(JSON.stringify({ok:true,checks,actualPaths:['UnitView Spine','UnitView avatar fallback','fallback Piece','fallback BattleUnit'],semantics:'visual-only transforms; stable world/HP/facing/picking-root; lifecycle restore; hash-pinned local responses'}));
}finally{for(const v of views)if(!v.destroyed)v.destroy();api.dispose();globalThis.__SP__=priorStore;fake.restore();}
