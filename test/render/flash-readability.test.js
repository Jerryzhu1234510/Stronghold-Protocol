import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxZones } from '../../public/js/render/fx/zones.js';

function shell() {
  const fx = Object.create(FxZones.prototype);
  Object.assign(fx, { time: 0, rich: false, _g: {}, particles: [], rings: [],
    ctx: { cam: () => ({ project: () => ({ x: 400, y: 300, s: 100 }) }) },
    particle: (tex, x, y, options) => fx.particles.push({ tex, ...options }),
    ring: (...args) => fx.rings.push(args), burst() {}, smoke() {}, tintSprite: {},
  });
  return fx;
}

test('multi-target boss impacts share one burst but retain its real radius and subsequent impacts', () => {
  const fx = shell();
  for (let i = 0; i < 50; i++) fx.explosion(5, 10, 0, 8, 0xffffff);
  assert.equal(fx.particles.length, 2, 'one glow and white core for a simultaneous impact');
  assert.equal(fx.rings[1][4], 8, 'the damage range cue still spans the real radius');
  assert.ok(fx.particles.every(p => p.s0 * 128 < 200 && p.a0 <= 0.4));
  fx.explosion(6, 10, 0, 8, 0xffffff);
  assert.equal(fx.particles.length, 4, 'a separate impact remains visible');
  fx.time = 0.11;
  fx.explosion(5, 10, 0, 8, 0xffffff);
  assert.equal(fx.particles.length, 6, 'the next attack remains visible');
});

test('global boss cues retain their telegraph duration with bounded screen wash', () => {
  const fx = shell();
  fx.flashScreen(0xffffff, 1, 4);
  assert.equal(fx.tintDur, 4);
  assert.ok(fx.tintA * 0.35 <= 0.09, 'the peak additive wash cannot obscure the whole board');
  fx.flashScreen(0xffffff, -1, 0);
  assert.equal(fx.tintA, 0);
  assert.ok(fx.tintDur > 0);
});
