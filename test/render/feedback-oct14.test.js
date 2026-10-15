import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../public/js/render/projection.js';
import { visibleEffectPoint } from '../../public/js/render/fx/visibility.js';
import { healingPoint } from '../../public/js/render/fx/healing.js';
import { FxRings } from '../../public/js/render/fx/rings.js';
import { FxProjectiles } from '../../public/js/render/fx/projectiles.js';
import { trioSceneChunks } from '../../public/js/render/board3d/trioScene.js';
import { isMobileCamera } from '../../public/js/ui/fieldHost.js';

test('near-plane healing in the third field is culled, not enlarged into the watched first field', () => {
  const cam = new Camera({ tx: 14, ty: 11, tilt: 30, dist: 4, scale: 70, cx: 420, cy: 195 });
  const behind = cam.project(14, 3, 1), normal = cam.project(14, 11, 1);
  assert.equal(behind.depth, .05);
  assert.equal(healingPoint(behind), null);
  assert.equal(visibleEffectPoint(behind, { width: 844, height: 390 }), false);
  assert.equal(visibleEffectPoint(normal, { width: 844, height: 390 }), true);
});

test('a hidden ring stays alive and becomes renderable again after returning to its field', () => {
  let visible = false;
  const sp = { position: { set() {} }, scale: { set() {} }, renderable: true };
  const fx = { ctx: { cam: () => ({ project: (_x, _y, _z, out) => Object.assign(out, visible
    ? { x: 100, y: 100, s: 50, depth: 6 } : { x: 100, y: 100, s: 10000, depth: .05 }) }), screenSize: () => ({ width: 844, height: 390 }) },
  rings: [{ sp, x: 14, y: 3, z: 0, r0: .2, r1: 1.5, t: 0, dur: 2 }], ringFree: [], _p: {}, _q: {} };
  FxRings.prototype._updateRings.call(fx, .1);
  assert.equal(sp.renderable, false); assert.equal(fx.rings.length, 1);
  visible = true; FxRings.prototype._updateRings.call(fx, .1);
  assert.equal(sp.renderable, true);
});

test('a healing orb behind the camera keeps its lifetime without drawing its halo or trail', () => {
  const pr = { t: 0, dur: 1, arc: 0, spec: { look: 'orb', hit: 'heal' }, tgt: null, trail: {}, halo: {}, core: {}, shadow: {} };
  const fx = { ctx: { screenSize: () => ({ width: 844, height: 390 }) }, _p: {}, _q: {},
    _shotPoint: (_pr, _k, _cam, out) => Object.assign(out, { x: 420, y: 195, s: 10000, depth: .05 }) };
  assert.equal(FxProjectiles.prototype._stepShot.call(fx, pr, .1, {}, false), true);
  assert.ok(['trail', 'halo', 'core', 'shadow'].every(key => pr[key].renderable === false));
});

test('third terrain translates a normal tile and UVs instead of retaining the boss tile underneath', () => {
  const quad = (x, y, z, group) => ({ material: 'M', lightmap: 0, group,
    position: new Float32Array([x, y, z, x + 1, y, z, x + 1, y + 1, z, x, y + 1, z]),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), uv1: new Float32Array(8),
    normal: new Int8Array([0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0]),
    color: new Uint8Array(16).fill(255), index: new Uint16Array([0, 1, 2, 0, 2, 3]), bounds: [x, y, z, x + 1, y + 1, z] });
  const source = quad(3, 9, .4, 'normal'), boss = quad(11, 2, 1, 'boss');
  const pack = { chunks: [source, boss] }, before = source.position.slice();
  const result = trioSceneChunks(pack);
  assert.equal(result.length, 2);
  assert.equal(trioSceneChunks(pack), result, 'remap only once per resource pack');
  assert.equal(result[0], source);
  assert.deepEqual(source.position, before, 'do not mutate normal / boss scenes');
  assert.deepEqual(result[1].bounds.filter((_, i) => i !== 2 && i !== 5), [11, 2, 12, 3]);
  assert.ok(Math.abs(result[1].bounds[2] - .4) < 1e-6);
  assert.equal(result[1].group, ''); assert.equal(result[1].uv[2], 1);
  assert.ok(result[1].normal.every(n => Number.isFinite(n)));
});

test('large touch-only client viewports use the mobile camera, desktop and hybrid pointers stay unchanged', () => {
  const root = (...classes) => ({ classList: { contains: c => classes.includes(c) } });
  assert.equal(isMobileCamera({ width: 1920, height: 864 }, root('sp-coarse')), true);
  assert.equal(isMobileCamera({ width: 1920, height: 864 }, root()), false);
  assert.equal(isMobileCamera({ width: 1920, height: 864 }, root('sp-coarse', 'sp-hover')), false);
  assert.equal(isMobileCamera({ width: 844, height: 390 }, root()), true);
});
