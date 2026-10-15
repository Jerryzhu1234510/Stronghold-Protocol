import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileCamera } from '../../public/js/ui/fieldHost.js';
import { presetCamera } from '../../public/js/render/projection.js';

const touchRoot = { classList: { contains: name => name === 'sp-coarse' } };

test('tablet landscape keeps every bench pad in view, including both boss halves', () => {
  for (const [width, height] of [[1024, 768], [1194, 834], [1366, 1024]]) {
    const size = { width, height }, rem = Math.max(40, Math.min(width / 19.2, height / 10.8));
    const mobile = isMobileCamera(size, touchRoot);
    assert.equal(mobile, false, 'tablet must not use the enlarged phone camera');
    for (const kind of ['prep', 'bossPrep']) for (const side of ['L', 'R']) {
      const hud = { top: rem * 2.16, bottom: rem * 2.64 + 3 };
      const camera = presetCamera(kind, size, { side, mobile, hud });
      for (let c = 0; c < 10; c++) for (const dx of [-.5, .5]) for (const dy of [-.5, .5]) {
        const x = kind === 'bossPrep' && side === 'R' ? 20 - c : c;
        const p = camera.project(x + dx, (kind === 'bossPrep' ? 0 : 7) + dy, .16);
        assert.ok(p.x >= 0 && p.x <= width, `${width}x${height} ${kind}/${side}: pad ${c} clipped`);
        assert.ok(p.y >= hud.top - .5 && p.y <= height - hud.bottom + .5, 'bench stays above shop');
      }
    }
  }
  assert.equal(isMobileCamera({ width: 844, height: 390 }, touchRoot), true, 'phone keeps its existing framing');
  assert.equal(isMobileCamera({ width: 1440, height: 900 }), false, 'desktop keeps its existing framing');
});
