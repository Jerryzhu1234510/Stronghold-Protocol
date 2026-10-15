// Build reproducible recordings from actual match-produced unite specifications.
// Usage: node tools/review-unite-feedback.mjs <public/dev/recordings directory>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PHASE } from '../shared/constants.js';
import { createBattleFromSpec } from '../server/sim/spec.js';
import { DataSource } from '../server/sim/simdata.js';
import { DATA, makeMatch, give, chessOfTier, legalTileFor } from '../test/match/harness.js';

const out = path.resolve(process.argv[2] || 'public/dev/recordings');
fs.mkdirSync(out, { recursive: true });
const indexPath = path.join(out, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
for (const humans of [4]) {
  const h = makeMatch({ mode: 'coop', humans, capacity: 8, seed: 5010 + humans, fake: true, clientCombat: true,
    script: b => b.kind === 'normal' ? { leaks: { p_0: 12 } } : {} }).start();
  const m = h.m;
  h.toPrep(1);
  h.setStage('act1autochess_m01');
  for (let i = 1; i < humans; i++) {
    const ps = h.ps(`p_${i}`);
    const used = new Set();
    for (const id of chessOfTier(1).filter(id => m.pool.has(id)).slice(0, 5)) {
      const at = legalTileFor(m, ps, id, used);
      if (!at) continue;
      used.add(`${at[0]},${at[1]}`);
      give(m, ps, id, 'board', at);
    }
  }
  h.drive(() => m.phase === PHASE.UNITE);
  const spec = m.fields[0].spec;
  const b = createBattleFromSpec(spec, new DataSource(DATA, null), { recordEvents: true });
  const frames = [{ snap: b.snapshot(), ev: b.drainEvents() }];
  const field = b.fieldMeta();
  const owners = new Set();
  const enemyColumns = new Set();
  for (let ticks = 0; !b.finished && b.time < 60; ticks++) {
    b.step();
    for (const u of b.allyUnits) if (u.ownerId) owners.add(u.ownerId);
    for (const e of b.enemies) if (e.alive) enemyColumns.add(Math.round(e.x));
    if (ticks % 3 === 0) frames.push({ snap: b.snapshot(), ev: b.drainEvents() });
  }
  frames.push({ snap: b.snapshot(), ev: b.drainEvents() });
  assert.equal(owners.size, humans - 1);
  assert.equal(b.errorCount || 0, 0);
  assert.ok(frames.some(f => f.snap.units.length >= (humans - 1) * 5));
  const name = `review-trio-portals`;
  const rec = { version: 1, name, title: `联防反馈检查 · ${humans - 1} 位援助玩家`, kind: 'unite',
    stageId: spec.stageId, field, spec, duration: b.time, frames, result: b.result() };
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rec));
  const item = { name, title: rec.title, file: `${name}.json`, kind: 'unite', stageId: spec.stageId, duration: b.time };
  const prev = index.findIndex(x => x.name === name);
  if (prev < 0) index.push(item); else index[prev] = item;
  console.log(JSON.stringify({ name, stage: spec.stageId, players: [...owners], units: b.allyUnits.length,
    enemyColumns: [...enemyColumns].sort((a, z) => a - z), errors: b.errorCount || 0 }));
  m.dispose();
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
