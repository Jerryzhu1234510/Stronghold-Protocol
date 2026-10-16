import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { KITS } from '../server/sim/content/kits/index.js';
import { createBattleFromSpec, resultDigest } from '../server/sim/spec.js';
import { DataSource } from '../server/sim/simdata.js';
import { PHASE } from '../shared/constants.js';
import { DATA, makeMatch } from './match/harness.js';

const built = new URL('../public/js/browser/sim.js', import.meta.url);
test('compiled compatibility entries parse at their ES2022 build target', { skip: !existsSync(built) }, () => {
  for (const name of ['training', 'compat', 'sim']) {
    const source = readFileSync(new URL(`../public/js/browser/${name}.js`, import.meta.url), 'utf8');
    parse(source, { ecmaVersion: 2022, sourceType: name === 'sim' ? 'module' : 'script' });
  }
});

test('compiled simulation keeps every original kit and produces identical battle results', { skip: !existsSync(built) }, async () => {
  const compiled = await import(built.href);
  assert.deepEqual(Object.keys(compiled.KITS), Object.keys(KITS));
  compiled.simdata.setSimData(DATA);
  compiled.support.setGameData(null);
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 2, seed: 9101, captureFrames: false, clientCombat: true });
  const specs = [];
  h.onSend.push((pid, msg) => { if (msg.t === 'b.start' && msg.authoritative) specs.push(msg.spec); });
  try {
    h.autoHumans(); h.m.start();
    h.run(() => h.ended != null || (h.m.round >= 4 && h.m.phase === PHASE.PREP), { maxSteps: 5e6 });
    assert.ok(specs.length >= 4);
    for (const spec of specs) {
      const original = createBattleFromSpec(spec, new DataSource(DATA, null), { recordEvents: false, quiet: true }).runToEnd(4000);
      const bundled = compiled.spec.createBattleFromSpec(spec, new compiled.simdata.DataSource(DATA, null), { recordEvents: false, quiet: true }).runToEnd(4000);
      assert.equal(compiled.spec.resultDigest(bundled).hash, resultDigest(original).hash, `${spec.fieldId} round ${spec.round}`);
    }
  } finally { h.m.dispose(); }
});
