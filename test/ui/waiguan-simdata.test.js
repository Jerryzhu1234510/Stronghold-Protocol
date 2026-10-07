// 外援单位的战斗渲染（DESIGN §21.2 / §9）：浏览器的战斗模拟加载的是自己那份 /data/*.json 冻结副本，而 甄选 记录不在
// chess.json 里 —— 于是模拟从 spec 构造外援单位时查不到记录，**静默丢掉那个单位**，玩家在战斗里看不到自己的外援
// （休整期正常，因为那条路走服务端算好的元数据 + data.js 的 甄选 overlay）。这条测试复现并锁定该修复。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { data, setChessOverlay } from '../../public/js/data.js';
import { waiguanPickChess } from '../../public/js/ui/loadoutModel.js';
import { loadBrowserSim } from '../../public/js/battle/runner.js';
import { buildBattleSpec } from '../../server/sim/spec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WAIGUAN = JSON.parse(readFileSync(path.join(ROOT, 'data/waiguan.json'), 'utf8'));
const STAGES = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
const CAND = WAIGUAN.candidates[2];
const A5 = CAND.chessIds[5];
const NORMAL = 'chess_char_1_01_a';
const PICKS = { diy5a: CAND.charId };

/** `loadBrowserSim` with the data files read from disk (its own `fetchFn` hook). */
function browserSim() {
  const fetchFn = async (url) => {
    const m = /([^/]+)\.json$/.exec(String(url));
    if (!m) return null;
    try {
      const text = readFileSync(path.join(ROOT, 'data', `${m[1]}.json`), 'utf8');
      return { ok: true, json: async () => JSON.parse(text) };
    } catch { return null; }
  };
  return loadBrowserSim({ base: pathToFileURL(path.join(ROOT, 'server/sim/')).href, dataBase: '/data/', fetchFn });
}

test('外援: without the overlay the browser sim has no record for the pick (the unit was dropped)', async () => {
  setChessOverlay(null);
  const { ds } = await browserSim();
  assert.equal(ds.rawChess(A5), null, `the sim data has no ${A5}`);
  assert.ok(ds.rawChess(NORMAL), 'a shop operator IS there (the control)');
});

test('外援: the overlay travels into the browser sim, so the unit is built and fights', async () => {
  setChessOverlay(waiguanPickChess(WAIGUAN, PICKS));
  try {
    assert.equal(data.lookup('chess', A5)?.name, CAND.name, 'the store resolves the pick');
    const { spec, ds } = await browserSim();
    assert.equal(ds.rawChess(A5)?.charId, CAND.charId, 'the sim can resolve the pick too');
    // a battle with the pick AND a shop operator on the field: both units must exist
    const stageId = Object.keys(STAGES).find((id) => STAGES[id] && typeof STAGES[id] === 'object');
    assert.ok(stageId, 'a stage to run');
    const specObj = buildBattleSpec({
      battleId: 'waiguan-simdata', fieldId: 'n:p', kind: 'normal', seed: 3, round: 1, stageId, timeLimit: 60,
      players: [{
        playerId: 'p', seat: 0, side: 'L', colOffset: 0,
        units: [
          { uid: 1, kind: 'chess', chessId: A5, row: 12, col: 4, dir: 'RIGHT', items: [], skillIndex: 0 },
          { uid: 2, kind: 'chess', chessId: NORMAL, row: 12, col: 5, dir: 'RIGHT', items: [], skillIndex: 0 },
        ],
      }],
      spawns: [], routes: [], flags: { layerGainsEnabled: true },
    });
    const battle = spec.createBattleFromSpec(specObj, ds, {});
    for (let i = 0; i < 3; i++) battle.step();
    const snap = battle.snapshot();
    const ids = snap?.units instanceof Map ? [...snap.units.keys()]
      : Array.isArray(snap?.units) ? snap.units.map((u) => (Array.isArray(u) ? u[0] : u?.id)) : [];
    assert.ok(ids.includes(2), `the shop operator is on the field (${JSON.stringify(ids)})`);
    assert.ok(ids.includes(1), `and so is the 外援 (${JSON.stringify(ids)})`);
  } finally {
    setChessOverlay(null);
  }
});
