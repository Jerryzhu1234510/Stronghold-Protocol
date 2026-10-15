import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healingPoint } from '../../public/js/render/fx/healing.js';
import { FxNumbers } from '../../public/js/render/fx/numbers.js';
import { FxSystem } from '../../public/js/render/fx/system.js';
import { SpineActor } from '../../public/js/render/spine.js';

test('healing visuals reject invalid projections and bound near-plane glow sizes on phone/desktop',()=>{
  for(const point of [{x:0,y:0,s:NaN},{x:Infinity,y:2,s:1},{x:1,y:2,s:-1}])assert.equal(healingPoint(point),null);
  for(const screen of [{width:844,height:390},{width:1920,height:1080}]){
    const p=healingPoint({x:200,y:200,s:1e8},screen);
    assert.ok(p.s<=160); assert.equal(p.x,200);
  }
});
test('a catch-up burst adds one healing glow per target interval and field cleanup drops the throttle',()=>{
  const particles=[];
  const fx={time:0,quality:'low',ctx:{settings:{damageNumbers:false},screenSize:()=>({width:844,height:390})},
    _chest:()=>({x:100,y:100,s:1e8}),particle:(...args)=>particles.push(args)};
  for(let i=0;i<100;i++)FxNumbers.prototype.heal.call(fx,{id:1},100);
  assert.equal(particles.length,2);
  assert.ok(particles.every(p=>p[3].s0<1));
  fx.time=.11;FxNumbers.prototype.heal.call(fx,{id:1},100);assert.equal(particles.length,4);
  // clear() must free all visual pools when changing the watched field.
  const clear=FxSystem.prototype.clear.toString();
  assert.match(clear,/_healAt\?\.clear\(\)/);
  assert.match(clear,/this\.tintT = 0; this\.tintSprite\.alpha = 0/);
});

test('abnormally scaled healing never sends the unsafe projection into the number layout',()=>{
  let numbers=0;
  const fx={time:0,quality:'low',ctx:{settings:{damageNumbers:true},screenSize:()=>({width:844,height:390})},
    _chest:()=>({x:100,y:100,s:1e8}),particle:()=>{},number:()=>numbers++};
  FxNumbers.prototype.heal.call(fx,{id:1},100);
  assert.equal(numbers,0);
  fx._chest=()=>({x:100,y:100,s:60});fx.time=.2;
  FxNumbers.prototype.heal.call(fx,{id:1},100);assert.equal(numbers,1);
});

test('a replaced Spine clip graphic is hidden even when the clipping setting did not change',()=>{
  const graphic={renderable:true},slot={currentGraphics:graphic,clippingContainer:{mask:graphic}};
  const actor=Object.assign(Object.create(SpineActor.prototype),{clipped:true,clipOn:false,_clipHidden:new Set(),spine:{skeleton:{slots:[slot]}}});
  actor.setClipping(false);assert.equal(slot.clippingContainer.mask,null);assert.equal(graphic.renderable,false);
  const replacement={renderable:true};slot.currentGraphics=replacement;slot.clippingContainer.mask=replacement;
  actor.setClipping(false);assert.equal(slot.clippingContainer.mask,null);assert.equal(replacement.renderable,false);
  actor.setClipping(true);assert.equal(slot.clippingContainer.mask,replacement);assert.equal(replacement.renderable,false);
});

test('healing burst throttling preserves every normal projected amount for the existing number aggregator',()=>{
  let total=0,particles=0;
  const fx={time:0,quality:'low',ctx:{settings:{damageNumbers:true}},
    _chest:()=>({x:100,y:100,s:60}),particle:()=>particles++,number:(_view,amount)=>total+=amount};
  for(let i=0;i<100;i++)FxNumbers.prototype.heal.call(fx,{id:1},3);
  assert.equal(total,300);assert.equal(particles,2);
});
