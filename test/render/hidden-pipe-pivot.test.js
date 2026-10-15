import test from 'node:test';
import assert from 'node:assert/strict';
import { enemyModelPivotX } from '../../public/js/render/enemyPose.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const rec = { hitArea: { w: 4.95, h: 2.95, dx: 1, dy: 1 } };
const info = { id: 'pipe', kind: 'enemy', side: 'enemy', defId: 'enemy_9021_acduml_2', boss: true, x: 9, y: 3, maxHp: 100 };

test('only hidden pipe uses its fixed collider centre as the visual mirror pivot', () => {
  assert.equal(enemyModelPivotX(info, rec), 1);
  for (const defId of ['enemy_9021_acduml', 'enemy_2016_csphtm', 'enemy_9013_acstmk']) {
    assert.equal(enemyModelPivotX({ ...info, defId }, rec), 0);
  }
  assert.equal(enemyModelPivotX({ ...info, side: 'ally' }, rec), 0);
  for (const dx of [undefined, NaN, Infinity, 999]) assert.equal(enemyModelPivotX(info, { hitArea: { dx } }), 0);
});

test('logical spawn stays (9,3); body mirroring, HUD and shadow stay on the same fixed centre', async () => {
  const fake = installFakePixi();
  try {
    const { UnitView } = await import('../../public/js/render/units.js');
    for (const side of ['L', 'R']) {
      const cam = presetCamera('bossPrep', { width: 1440, height: 900, side });
      const ctx = fakeViewCtx(fake.P, { lookupDef: () => rec, cam: () => cam });
      const v = new UnitView(ctx, info);
      v.setWorld(9, 3, 0);
      // Pose rendering is covered by the real-model browser QA; isolate the placement calculation here.
      v.actor = { spine: {}, entry: {}, current: 'Idle', poseHeld: () => false };
      v.spineReady = true;
      v._drawDirect = () => {};
      v._cull = () => false;
      for (const facing of [-1, 1, -1]) {
        v.visFacing = facing;
        v.update(1 / 60, cam, 1);
        assert.deepEqual([v.x, v.y], [9, 3]);
        const centre = cam.project(10, 3, 0);
        const origin = cam.project(facing === -1 ? 11 : 9, 3, 0);
        assert.ok(Math.abs(v.root.x - centre.x) < 1e-6);
        assert.ok(Math.abs(v.root.x + v.body.x - origin.x) < 1e-6);
        assert.ok(Math.abs(v.root.y + v.body.y - origin.y) < 1e-6);
        assert.ok(Math.abs(v.shadow.x - centre.x) < 1e-6);
      }
      v.actor = null; v.destroy();
    }
  } finally { fake.restore(); }
});
