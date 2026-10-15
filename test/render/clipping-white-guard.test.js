import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpineActor } from '../../public/js/render/spine.js';

test('animation-created and released clipping polygons never become visible white geometry', () => {
  const graphics={renderable:true},slot={};
  const a=Object.create(SpineActor.prototype);
  Object.assign(a,{clipped:true,clipOn:false,clock:0,mode:'base',frozen:false,_clipHidden:new Set(),
    spine:{skeleton:{slots:[slot]},update(){
      // A clipping slot first appears partway through a skill after the quality setting disabled clipping.
      slot.currentGraphics=graphics;slot.clippingContainer={mask:graphics};graphics.renderable=true;
    }},
  });
  a.update(1/60);
  assert.equal(slot.clippingContainer.mask,null);
  assert.equal(graphics.renderable,false);
  graphics.renderable=true; // Pixi releases a mask during an attachment/container transition.
  a.setClipping(false);
  assert.equal(graphics.renderable,false,'the same quality mode still repairs a released mask');
  a.setClipping(true);
  assert.equal(slot.clippingContainer.mask,graphics);
  assert.equal(graphics.renderable,false,'an active mask never draws its fill as scene content');
});
