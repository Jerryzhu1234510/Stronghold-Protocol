import test from 'node:test';
import assert from 'node:assert/strict';
import { FxZones } from '../../public/js/render/fx/zones.js';
import { FX_KINDS } from '../../public/js/render/fx/kinds.js';

class Sprite {
  anchor = { set() {} }; position = { set() {} }; scale = { set() {} };
  destroy() { this.destroyed = true; }
}
class Graphics extends Sprite {
  points = [];
  clear() { this.points = []; }
  lineStyle() {}
  moveTo(x, y) { this.points.push([x, y]); }
  lineTo(x, y) { this.points.push([x, y]); }
}
function fixture() {
  const fx = Object.create(FxZones.prototype);
  Object.assign(fx, { P: { Sprite, Graphics, BLEND_MODES: { ADD: 1 } }, tex: {}, zones: [], _p: {}, _q: {},
    _onGround() {}, ctx: { cam: () => ({ project(x, y, z, out) { return Object.assign(out, { x: x * 50, y: -y * 30, s: 50 }); } }) } });
  return fx;
}

test('Clementia vortex draws three moving arms, updates by key and destroys all objects on expiration', () => {
  const fx = fixture(), spec = FX_KINDS.clemntVortex;
  assert.equal(spec.a, 'zone'); assert.equal(spec.tex, 'vortex'); assert.equal(spec.pt, true);
  fx.zone(5, 4, 0, spec.r, spec.c, spec.dur / 2, spec.tex, false, 'capsule');
  const zone = fx.zones[0]; fx._updateZones(.3);
  assert.equal(zone.swirl.points.length, 87); assert.ok(zone.swirl.alpha > 0);
  const first = structuredClone(zone.swirl.points); fx._updateZones(.1);
  assert.notDeepEqual(zone.swirl.points, first, 'vortex is animated');
  fx.zone(6, 4, 0, 1.5, spec.c, .5, spec.tex, false, 'capsule');
  assert.equal(fx.zones.length, 1); assert.equal(zone.x, 6);
  fx._updateZones(.6); assert.equal(fx.zones.length, 0);
  assert.ok(zone.disc.destroyed && zone.edge.destroyed && zone.swirl.destroyed);
});

test('existing soft zones do not allocate or draw vortex graphics', () => {
  const fx = fixture(); fx.zone(2, 3, 0, 1, 0xffffff, 2);
  const zone = fx.zones[0]; fx._updateZones(.2);
  assert.equal(zone.swirl, null); assert.ok(zone.disc.alpha > 0 && zone.edge.alpha > 0);
});
