import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveLoad } from '../../public/js/render/adaptiveLoad.js';

test('intentional 30 FPS remains healthy, while sustained frames below its target still shed load', () => {
  const load = createAdaptiveLoad();
  for (let i = 0; i < 600; i++) load.sample(1 / 30, true, false, 30);
  assert.equal(load.level, 0);
  for (let i = 0; i < 100; i++) load.sample(1 / 10, true, false, 30);
  assert.equal(load.level, 3);
  for (let i = 0; i < 1800; i++) load.sample(1 / 30, true, false, 30);
  assert.equal(load.level, 0);
});

test('persistent 2 FPS combat frames still reach maximum visual load shedding', () => {
  const load = createAdaptiveLoad();
  for (let i = 0; i < 20; i++) load.sample(0.5, true);
  assert.equal(load.level, 3);
  assert.ok(load.frameMs > 250, 'slow frames must also be visible in the FPS statistic');
  for (let i = 0; i < 800; i++) load.sample(1 / 60, true);
  assert.ok(load.level > 0, 'a short good spell must not immediately oscillate back to full load');
  for (let i = 0; i < 1800; i++) load.sample(1 / 60, true);
  assert.equal(load.level, 0, 'sustained recovery restores full detail');
});

test('one tab-resume spike, hidden frames and invalid samples do not trigger load shedding', () => {
  const load = createAdaptiveLoad();
  for (let i = 0; i < 100; i++) load.sample(2, true, true);
  assert.equal(load.level, 0);
  load.sample(30, true);
  for (let i = 0; i < 180; i++) load.sample(1 / 60, true);
  assert.equal(load.level, 0);
  const before = load.frameMs;
  for (const dt of [NaN, Infinity, -1, 0]) load.sample(dt, true);
  assert.equal(load.frameMs, before);
});

test('quiet preparation never degrades just because the browser has a low frame rate', () => {
  const load = createAdaptiveLoad();
  for (let i = 0; i < 40; i++) load.sample(0.5, false);
  assert.equal(load.level, 0);
});
