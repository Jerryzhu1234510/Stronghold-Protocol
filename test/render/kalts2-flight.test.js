import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entrancePoseOffsetY, KALTS2_START_MAX_RISE } from '../../public/js/render/flightPose.js';

const info = { spine: 'char_1052_kalts2' };
const make = (current = 'Start', y = 634.58, name = 'Front_A') => ({
  current, entry: { anims: { deploy: 'Start' } },
  spine: { skeleton: { findBone: key => key === name ? { y, data: { y: -50 } } : null }, state: { tracks: [] } },
});
test('only the excess entrance rise is removed; the model still rises 0.35 tiles', () => {
  const modelScale = 1 / 320, screenScale = 100 * modelScale;
  const offset = entrancePoseOffsetY(info, make(), screenScale, modelScale);
  assert.ok(offset > 170);
  assert.ok(Math.abs((634.58 + 50) * modelScale - offset / 100 - KALTS2_START_MAX_RISE) < 1e-8);
});
test('back model uses the same bounded entrance translation', () => {
  assert.equal(entrancePoseOffsetY(info, make('Start', 634.58, 'Back_A'), 0.3, 1 / 320),
    entrancePoseOffsetY(info, make(), 0.3, 1 / 320));
});
test('a mixing entrance stays bounded until it has faded out', () => {
  const actor = make('Idle', 300);
  actor.spine.state.tracks = [{ animation: { name: 'Idle' }, mixingFrom: { animation: { name: 'Start' } } }];
  assert.ok(entrancePoseOffsetY(info, actor, 0.3, 1 / 320) > 0);
});
test('idle, attacks, other flyers, absent bones and invalid coordinates remain unchanged', () => {
  assert.equal(entrancePoseOffsetY(info, make('Idle'), 0.3, 1 / 320), 0);
  assert.equal(entrancePoseOffsetY(info, make('Start', -40.17), 0.3, 1 / 320), 0);
  assert.equal(entrancePoseOffsetY({ spine: 'char_1012_skadi2' }, make(), 0.3, 1 / 320), 0);
  assert.equal(entrancePoseOffsetY(info, make('Start', NaN), 0.3, 1 / 320), 0);
  assert.equal(entrancePoseOffsetY(info, make('Start', 634.58, 'missing'), 0.3, 1 / 320), 0);
  assert.equal(entrancePoseOffsetY(info, make(), 0, 1 / 320), 0);
});
