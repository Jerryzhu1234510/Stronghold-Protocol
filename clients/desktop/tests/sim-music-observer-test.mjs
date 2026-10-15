import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const require=createRequire(import.meta.url),{parse}=require(path.join(root,'node_modules/acorn'));
const {instrument,transformResponse}=require('../sim-music-observer.cjs');
let checks=0;function ok(test,message){assert.ok(test,message);checks++;}function eq(a,b,message){assert.equal(a,b,message);checks++;}
const source=await fs.readFile(path.join(root,'server/sim/battle/status.js'),'utf8');
const changed=instrument(source,'/sim/battle/status.js');
ok(changed!==source,'known status source instrumented');
const ast=parse(changed,{ecmaVersion:'latest',sourceType:'module'});
const cls=ast.body.find(n=>n.type==='ExportNamedDeclaration').declaration;
const method=cls.body.body.find(n=>n.key.name==='applyStatus');
const methodText=changed.slice(method.start,method.end);
const calls=[],wind=new WeakMap();
const bridge={
  freeze(battle,target,source){calls.push({id:target.id,source,wind:wind.get(battle)});},
  enterWind(battle,pid){const token={battle,previous:wind.get(battle)};wind.set(battle,pid);return token;},
  exitWind(token){if(token.previous===undefined)wind.delete(token.battle);else wind.set(token.battle,token.previous);},
};
const context={__SPDesktopMusicBridge:bridge,STATUS:{cold:{flags:{cold:true}},freeze:{flags:{freeze:true},immune:'frozen'}},RESIST_STATUSES:new Set(['cold','freeze']),COLD_FREEZE_DURATION:5,evadesGround:()=>false};
const Observed=vm.runInNewContext('(class {'+methodText+'})',context);
function target(id=10,immune=false){return {id,alive:true,side:'enemy',def:{immune:new Set(immune?['frozen']:[])},s:{flags:{},massLevel:1},buffs:[],findBuff(key){return this.buffs.find(b=>b.key===key);}};}
function battle(){const b=new Observed();b._hooks={};b.resistOf=()=>0;b._unblock=()=>{};b.addBuff=(u,rec)=>{let old=u.findBuff(rec.key);if(old){old.timeLeft=Math.max(old.timeLeft,rec.duration);return old;}const fresh={...rec,timeLeft:rec.duration};u.buffs.push(fresh);Object.assign(u.s.flags,rec.flags);return fresh;};b.removeBuff=(u,key)=>{u.buffs=u.buffs.filter(v=>v.key!==key);delete u.s.flags[key];return 1;};return b;}
let b=battle(),t=target(),op={id:1,ownerId:'me',kind:'op',side:'ally'};
eq(b.applyStatus(t,'freeze',{duration:2,source:op}),true,'original true return unchanged');eq(calls.length,1,'new real freeze observed');eq(calls[0].source,op,'exact operator source retained');
eq(b.applyStatus(t,'freeze',{duration:3,source:op}),true,'refresh return unchanged');eq(calls.length,1,'already frozen is not a new freeze');
t=target(11,true);eq(b.applyStatus(t,'freeze',{duration:2,source:op}),false,'immune return unchanged');eq(calls.length,1,'immune never triggers');
t=target(12);eq(b.applyStatus(t,'cold',{duration:3,source:op}),true,'first cold succeeds');eq(calls.length,1,'first cold is not a freeze');
eq(b.applyStatus(t,'cold',{duration:3,source:op}),true,'second cold succeeds');eq(calls.length,2,'cold pair observes actual recursive freeze once');eq(calls[1].source,op,'cold-pair source exact');
const before=calls.length;context.__SPDesktopMusicBridge={freeze(){throw Error('observer error');}};
eq(b.applyStatus(target(13),'freeze',{duration:2,source:op}),true,'throwing observer cannot alter game result');eq(calls.length,before,'throw remains isolated');context.__SPDesktopMusicBridge=bridge;
b._hooks.beforeStatus=true;b.emit=()=>{throw Error('original simulation failure');};assert.throws(()=>b.applyStatus(target(14),'freeze',{duration:2,source:op}),/original simulation failure/);checks++;b._hooks.beforeStatus=false;
const devices=await fs.readFile(path.join(root,'server/sim/content/devices.js'),'utf8'),observedDevices=instrument(devices,'/sim/content/devices.js');
ok(devices!==observedDevices,'known devices source instrumented');
const deviceAst=parse(observedDevices,{ecmaVersion:'latest',sourceType:'module'}),func=deviceAst.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='startColdWind').declaration;
const getWind=vm.runInNewContext('('+observedDevices.slice(func.start,func.end)+')',{__SPDesktopMusicBridge:bridge,num:(v,d)=>Number.isFinite(Number(v))?Number(v):d});
for(const pid of ['me','other',null]){
  const windBattle=battle(),enemy=target(20);enemy.buffs.push({key:'cold',timeLeft:5});windBattle.enemies=[enemy];windBattle.rect={r0:0,r1:6,c0:0,c1:10};let tick;
  windBattle.after=(_seconds,fn)=>{tick=fn;return {cancel(){}};};windBattle.every=()=>({cancel(){}});windBattle.fx=()=>{};
  const prior=calls.length;getWind(windBattle,{playerId:pid,interval:1,duration:5});tick();
  eq(calls.length,prior+1,'gust really freezes cold target');eq(calls.at(-1).wind,pid,'exact wind owner retained');eq(calls.at(-1).source,null,'wind has null operator source');eq(wind.has(windBattle),false,'wind scope cleared in finally');
}
// An original gust failure still unwinds its provenance without swallowing the game exception.
const failBattle=battle();failBattle.enemies=[];failBattle.rect={r0:0,r1:6,c0:0,c1:10};let failTick;failBattle.after=(_s,fn)=>{failTick=fn;return {cancel(){}};};failBattle.every=()=>({cancel(){}});failBattle.fx=()=>{throw Error('original gust failure');};getWind(failBattle,{playerId:'me',interval:1,duration:5});assert.throws(()=>failTick(),/original gust failure/);checks++;eq(wind.has(failBattle),false,'throwing gust still clears scope');
const bundle=await fs.readFile(path.join(root,'public/js/browser/sim.js'),'utf8'),observedBundle=instrument(bundle,'/_build/fd4dbe120420-2/js/browser/sim.js');
ok(bundle!==observedBundle,'known generated browser bundle instrumented');parse(observedBundle,{ecmaVersion:'latest',sourceType:'module'});checks++;
eq(instrument(source+'\n','/sim/battle/status.js'),source+'\n','unknown hash left unchanged');eq(instrument(source,'/sim/battle/not-status.js'),source,'other paths untouched');eq(instrument(changed,'/sim/battle/status.js'),changed,'never instrument twice');
const url='https://weishuxieyiwangye.cn:8443/_build/test-1/sim/battle/status.js';
let response=new Response(source,{headers:{'content-type':'text/javascript; charset=utf-8','content-length':'123','etag':'old','content-security-policy':"default-src 'none'",'x-content-type-options':'nosniff'}});
const result=await transformResponse(new Request(url),response);ok(result!==response,'known request transformed');eq(await result.text(),changed,'response has exact instrumented source');eq(result.headers.get('etag'),null,'old ETag removed');eq(result.headers.get('content-length'),null,'old length removed');eq(result.headers.get('content-type'),'text/javascript; charset=utf-8','MIME retained');eq(result.headers.get('content-security-policy'),"default-src 'none'",'security headers retained');eq(response.bodyUsed,false,'original response remains intact');
for(const [request,status]of [[new Request(url,{method:'HEAD'}),200],[new Request(url.replace('weishuxieyiwangye.cn:8443','weishuxieyi.icu')),200],[new Request(url),404],[new Request(url.replace('/sim/battle/status.js','/sim/battle/other.js')),200]]){response=new Response(source,{status});eq(await transformResponse(request,response),response,'unsupported request unchanged');}
console.log(JSON.stringify({ok:true,checks,actualSources:['bundled browser sim','fallback applyStatus','fallback gust'],semantics:'new real freeze only; exact synchronous wind provenance; return/throw preserved; no RNG or sim state writes'}));
