// Local CPU benchmark with production waves, HP and full paired lineups. Never connects to a live server.
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { DATA, makeMatch, give, legalTileFor } from '../test/match/harness.js';
import { createBattleFromSpec } from '../server/sim/spec.js';

const lineup = ['chess_char_5_17_b', 'chess_char_5_11_b', 'chess_char_5_03_b', 'chess_char_6_14_b',
  'chess_char_6_20_b', 'chess_char_5_12_b', 'chess_char_6_13_b', 'chess_char_4_09_b'];
const rows = [];
for (const capacity of [4, 5, 6, 7, 8]) {
  for (const [bossId, boss] of Object.entries(DATA.bosses)) {
    const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', clientCombat: true, clients: false, captureFrames: false }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      m.round = boss.hidden ? m.gd.hiddenRound : m.gd.bossRound;
      m.bossId = bossId; m.hiddenBossId = bossId; m.teamLp = 400;
      m._planBossWaves();
      for (const ps of m.order) {
        for (const id of lineup) {
          const tile = legalTileFor(m, ps, id);
          if (!tile) throw new Error(`no legal tile: ${bossId} ${id}`);
          give(m, ps, id, 'board', tile).dir = 'RIGHT';
        }
      }
      m.startFinalAssault(boss.hidden);
      const b = createBattleFromSpec(m.fields[0].spec, m.ds, { logger: { error() {}, warn() {} } });
      const costs = []; let peakUnits = 0, peakEnemies = 0;
      while (!b.finished && b.tickCount < 9000) {
        const before = performance.now();
        b.step();
        // Include snapshots and event draining as the visible client does at normal 2× playback.
        b.snapshot(); b.drainEvents();
        costs.push(performance.now() - before);
        peakUnits = Math.max(peakUnits, b.units.length);
        peakEnemies = Math.max(peakEnemies, b.enemies.length);
      }
      const sorted = costs.slice().sort((a, b) => a - b);
      const blockMax = n => {
        let sum = 0, max = 0;
        for (let i = 0; i < costs.length; i++) { sum += costs[i]; if (i >= n) sum -= costs[i - n]; if (i >= n - 1) max = Math.max(max, sum); }
        return +max.toFixed(3);
      };
      const row = { capacity, bossId, fields: m.fields.length, operators: b.players.reduce((n, p) => n + p.units.length, 0),
        ticks: costs.length, gameSeconds: +b.time.toFixed(2), peakUnits, peakEnemies,
        avgTickMs: +(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4),
        p95TickMs: +sorted[Math.floor(sorted.length * .95)].toFixed(4),
        maxTickMs: +sorted.at(-1).toFixed(3), burst240Ms: blockMax(240), burst600Ms: blockMax(600) };
      rows.push(row);
      console.log(JSON.stringify(row));
    } finally { h.m.dispose(); }
  }
}
await writeFile(process.argv[2] || 'boss-perf.json', JSON.stringify({ at: new Date().toISOString(),
  scope: 'Local Node CPU only, paired field with 16 elite operators, production ABYSS HP, up to 300 game seconds. Not browser FPS, network, server concurrency or real phone performance.', rows }, null, 2));
