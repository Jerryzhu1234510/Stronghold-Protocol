import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{installUnitMotion,motionBootstrap}=require('../unit-motion.cjs');
let state={connection:{status:'online'},me:{playerId:'me'},room:{code:'ROOM',inMatch:true,seats:[{playerId:'me'}],spectators:[]},match:{public:{phase:'COMBAT',players:[{playerId:'me'}]}}};
const listeners=new Set(),store={get:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
const context={__SP__:{store},setTimeout,clearTimeout,performance:{now:()=>250},addEventListener(){},removeEventListener(){}};
const create=vm.runInNewContext('('+installUnitMotion.toString()+')',context);
let checks=0;const eq=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};const near=(a,b,msg)=>{assert.ok(Math.abs(a-b)<1e-8,msg);checks++;};
const unit=(ownerId='me',kind='op',side='ally')=>({info:{id:1,ownerId,kind,side},body:{y:3,rotation:0.3,scale:{x:1,y:1}},root:{x:5,y:10,rotation:0},screen:{s:100},x:4,y:10,z:0,dir:'LEFT',hp:100,alive:true});
let api=create({motion:{target:'own',bounceHeight:0.2,bounceHz:1,spinRps:0.5}}),u=unit();
const before=JSON.stringify({x:u.x,y:u.y,z:u.z,dir:u.dir,hp:u.hp,root:u.root});
api.step3d(u,1/60,null,0.5);near(u.body.y,-17,'bounce uses tile height');near(u.body.rotation,0.3+Math.PI/2,'spin uses revolutions per second');
eq(JSON.stringify({x:u.x,y:u.y,z:u.z,dir:u.dir,hp:u.hp,root:u.root}),before,'simulation coordinates, facing, HP and root untouched');
api.step3d(u,1/60,null,0.5);near(u.body.y,-17,'no cumulative displacement');
for(const other of [unit('other'),unit('me','token'),unit('me','op','enemy')]){api.step3d(other,1/60,null,0.5);eq(other.body.y,3,'own/type/side filtering');}
u.alive=false;api.step3d(u,1/60,null,0.5);near(u.body.y,3,'dead visual restored');u.alive=true;
api.configure({motion:{target:'allies',bounceHeight:0,spinRps:-1,bounceHz:1}});let other=unit('other');api.step3d(other,1/60,null,0.25);near(other.body.rotation,0.3-Math.PI/2,'allies and negative spin');near(other.body.y,3,'zero bounce permits spin only');
const prep=unit(undefined);delete prep.info.ownerId;prep.info.id='p:7';prep.prep=true;api.step3d(prep,1/60,null,0.25);near(prep.body.rotation,0.3-Math.PI/2,'own prep pieces supported without guessing battle ownership');
const unknown=unit(undefined);delete unknown.info.ownerId;api.step3d(unknown,1/60,null,0.25);near(unknown.body.rotation,0.3,'unknown ownership skipped');
const animations=[];const element={style:{transformOrigin:'left bottom'},animate(frames,options){const result={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(result);return result;}};
api.configure({motion:{target:'own',bounceHeight:0.2,bounceHz:1,spinRps:0.5}});
const ref=api.ref({id:10,kind:'op',side:'ally',ownerId:'me'},100,{fieldId:'n:me'});ref(element);eq(animations.length,2,'2D art has independent bounce/spin');eq(animations[0].frames[1].translate,'0px -20px','2D uses the same tile-height unit');eq(element.style.transformOrigin,'50% 100%','rotation is around the art feet');
eq(api.ref({id:10,kind:'op',side:'ally',ownerId:'me'},100,{fieldId:'n:me'}),ref,'stable ref per unit');eq(animations.length,2,'rerender does not allocate fresh animations');
const publish=patch=>{state={...state,...patch};for(const listener of listeners)listener(state);};
api.step3d(u,1/60,null,0.5);publish({room:{...state.room,inMatch:false}});near(u.body.y,3,'leaving restores body immediately');eq(animations.every(a=>a.cancelled),true,'leaving cancels DOM animations');eq(element.style.transformOrigin,'left bottom','original art style restored');
publish({room:{...state.room,inMatch:true}});eq(animations.length,4,'re-entering can restore visual animation');
publish({match:{public:{phase:'RESULT',players:[{playerId:'me'}]}}});eq(animations.every(a=>a.cancelled),true,'RESULT stops motion');
publish({match:{public:{phase:'PREP',players:[{playerId:'me'}]}},room:{...state.room,spectators:[{playerId:'me'}]}});api.step3d(u,1/60,null,0.5);near(u.body.y,3,'spectator seat has no own motion');
publish({room:{...state.room,spectators:[]}});api.configure({motion:{bounceHeight:1,target:'own'}});api.step3d(u,1/60,null,0.5);near(u.body.y,3,'invalid options disabled');
api.configure({motion:{bounceHeight:0.2,bounceHz:1,spinRps:0}});api.step3d(u,1/60,null,0.5);near(u.body.y,-17,'bounce-only supported');near(u.body.rotation,0.3,'zero spin retains original');
api.configure({motion:null});near(u.body.y,3,'disabled restores original');ref(null);eq(api.status.elements,0,'ref removal releases element');
api.configure({motion:{}});api.step3d(u,1/60,null,0.5);api.drop3d(u);near(u.body.y,3,'destroy callback restores before destroying');eq(api.status.views>=0,true,'view tracking valid');
publish({match:{public:{phase:'COMBAT',players:[{playerId:'me'}]}}});
for(const [flipX,flipY,x,y]of [[true,false,-1,1],[false,true,1,-1],[true,true,-1,-1]]){
 const v=unit();api.configure({motion:{bounceHeight:0,spinRps:0,flipX,flipY}});api.step3d(v,1/60,null,0.5);eq(v.body.scale.x,x,'flip-only X uses visual scale');eq(v.body.scale.y,y,'flip-only Y uses visual scale');eq(v.body.y,3,'flip-only never moves model');eq(v.body.rotation,0.3,'flip-only never rotates model');api.drop3d(v);eq(v.body.scale.x,1,'destroy restores scale X');eq(v.body.scale.y,1,'destroy restores scale Y');
}
const negative=unit();negative.body.scale={x:-2,y:3};api.configure({motion:{target:'own',bounceHeight:.3,bounceHz:1,spinRps:1,flipX:true,flipY:true}});api.step3d(negative,1/60,null,.5);eq(negative.body.scale.x,2,'negative baseline multiplied for X flip');eq(negative.body.scale.y,-3,'baseline multiplied for Y flip');near(negative.body.y,-27,'flip and jump compose');near(negative.body.rotation,.3+Math.PI,'flip and full-turn jump compose');eq(negative.dir,'LEFT','flip does not rewrite facing');
publish({match:{public:{phase:'RESULT',players:[{playerId:'me'}]}}});eq(negative.body.scale.x,-2,'RESULT restores negative baseline X');eq(negative.body.scale.y,3,'RESULT restores baseline Y');publish({match:{public:{phase:'COMBAT',players:[{playerId:'me'}]}}});api.step3d(negative,1/60,null,.5);api.configure({motion:null});eq(negative.body.scale.x,-2,'disable restores negative X');eq(negative.body.scale.y,3,'disable restores Y');
api.configure({motion:{target:'own',bounceHeight:0,spinRps:0,flipX:true}});for(const v of [unit('other'),unit('me','token'),unit('me','op','enemy')]){api.step3d(v,1/60,null,.5);eq(v.body.scale.x,1,'flip own/type/side exclusion');}
const peerFlip=unit('other');api.configure({motion:{target:'allies',bounceHeight:0,spinRps:0,flipY:true}});api.step3d(peerFlip,1/60,null,.5);eq(peerFlip.body.scale.y,-1,'flip applies to selected allies');api.drop3d(peerFlip);
const flipElement={style:{scale:'-2 3',transformOrigin:'20% 40%'},animations:[],animate(frames,options){const a={frames,options,cancel(){this.cancelled=true;}};this.animations.push(a);return a;}};
api.configure({motion:{bounceHeight:0,spinRps:0,flipX:true,flipY:true}});const flipRef=api.ref({id:11,ownerId:'me',kind:'op',side:'ally'},100,{fieldId:'n:me'});flipRef(flipElement);eq(flipElement.style.scale,'2 -3','2D flip multiplies negative baseline');eq(flipElement.animations.length,0,'flip-only needs no WebAnimations');
api.configure({motion:{bounceHeight:.3,bounceHz:1,spinRps:1,flipX:true}});eq(flipElement.style.scale,'2 3','combined motion retains independent flip');eq(flipElement.animations.length,2,'flip composes with bounce and rotation');eq(flipElement.animations[0].frames[1].translate,'0px -30px','combined jump height');api.configure({motion:null});eq(flipElement.style.scale,'-2 3','2D disable restores scale');eq(flipElement.style.transformOrigin,'20% 40%','2D disable restores origin');flipRef(null);
api.configure({motion:{bounceHeight:0,spinRps:0,flipX:false,flipY:false}});api.step3d(u,1/60,null,.5);eq(u.body.scale.x,1,'all-zero all-false config inactive');api.configure({motion:{bounceHeight:0,spinRps:0,flipX:'yes'}});api.step3d(u,1/60,null,.5);eq(u.body.scale.x,1,'nonboolean flip rejected');
api.dispose();eq(context.__SPDesktopUnitMotion,undefined,'dispose removes bridge');eq(listeners.size,0,'dispose unsubscribes store');
assert.doesNotThrow(()=>vm.runInNewContext(motionBootstrap({motion:null}),context));checks++;context.__SPDesktopUnitMotion.dispose();
console.log(JSON.stringify({ok:true,checks,semantics:'visual body only; own/allies filters; no coordinates/HP/facing writes; stable 2D refs; no per-frame DOM queries; full restoration'}));
