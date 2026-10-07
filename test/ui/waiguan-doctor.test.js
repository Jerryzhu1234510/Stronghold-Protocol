// 外援自检 (public/js/ui/waiguanDoctor.js): 把技能条目与「实际会出场的记录」对上，并把装上另一阶这类错误标成警告。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { waiguanDoctor } from '../../public/js/ui/waiguanDoctor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WAIGUAN = JSON.parse(readFileSync(path.join(ROOT, 'data/waiguan.json'), 'utf8'));
const CAND = WAIGUAN.candidates[2];
const A5 = CAND.chessIds[5];
const A6 = CAND.chessIds[6];
const report = (o) => waiguanDoctor({ waiguan: WAIGUAN, ...o });

test('doctor: an entry on the tier the pick fills is reported as equipped', () => {
  const r = report({ picks: { diy5a: CAND.charId }, entries: { [A5]: { skill: 1 } } });
  assert.deepEqual(r.warnings, []);
  assert.ok(r.lines.some((l) => l.includes(`选人：五阶 · 一（diy5a） = ${CAND.name}`)), JSON.stringify(r.lines));
  assert.ok(r.lines.some((l) => l.includes('技能 已装') && l.includes('S2')), JSON.stringify(r.lines));
});

test('doctor: an entry on the OTHER tier is flagged as never taking effect (the trap)', () => {
  const r = report({ picks: { diy5a: CAND.charId }, entries: { [A6]: { skill: 1 } } });
  assert.equal(r.warnings.length, 2, JSON.stringify(r.warnings)); // no entry for the pick + the misplaced one
  const trap = r.warnings.find((w) => w.includes('不会生效'));
  assert.ok(trap, JSON.stringify(r.warnings));
  assert.match(trap, /6 阶记录/);
  assert.match(trap, /五阶 · 一/);
  assert.match(r.warnings[0], /默认技能/, 'and the pick itself says it will use the default');
});

test('doctor: with the picked tier equipped, the other tier is only a note — not a warning', () => {
  const r = report({ picks: { diy5a: CAND.charId }, entries: { [A5]: { skill: 1 }, [A6]: { skill: 2 } } });
  assert.deepEqual(r.warnings, [], `no warning when the picked tier is set (${JSON.stringify(r.warnings)})`);
  assert.ok(r.lines.some((l) => l.includes('可忽略')), JSON.stringify(r.lines));
});

test('doctor: in a match it reports the SERVER value per pick, before any piece is owned', () => {
  const priv = { board: [], hand: [], loadout: { [A5]: { skill: 1, module: null } } };
  const r = report({ picks: { diy5a: CAND.charId }, entries: { [A5]: { skill: 1 } }, priv });
  const line = r.lines.find((l) => l.startsWith('局内（服务端）：'));
  assert.ok(line, JSON.stringify(r.lines));
  assert.match(line, new RegExp(CAND.name));
  assert.match(line, /S2/, 'index 1 shows as S2');
  const bare = report({ picks: { diy5a: CAND.charId }, entries: {}, priv: { board: [], hand: [], loadout: {} } });
  assert.match(bare.lines.find((l) => l.startsWith('局内（服务端）：')) || '', /S1（默认）/);
});

test('doctor: a pick without an entry says so, and does not invent a warning', () => {
  const r = report({ picks: { diy6a: CAND.charId }, entries: {} });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /默认技能/);
  assert.equal(r.lines.length, 2, JSON.stringify(r.lines));
});

test('doctor: an entry for an operator that was never picked is flagged', () => {
  const other = WAIGUAN.candidates[3];
  const r = report({ picks: { diy5a: CAND.charId }, entries: { [A5]: { skill: 0 }, [other.chessIds[5]]: { skill: 1 } } });
  assert.equal(r.warnings.length, 1, JSON.stringify(r.warnings));
  assert.match(r.warnings[0], /不属于你本局选的外援/);
});

test('doctor: in a match it reports what each owned 外援 piece actually fights with', () => {
  const priv = { board: [{ uid: 1, kind: 'chess', id: A5 }], hand: [], loadout: { [A5]: { skill: 1, module: null } } };
  const r = report({ picks: { diy5a: CAND.charId }, entries: { [A5]: { skill: 1 } }, priv });
  const line = r.lines.find((l) => l.startsWith('局内：'));
  assert.ok(line, JSON.stringify(r.lines));
  assert.match(line, new RegExp(CAND.name));
  assert.match(line, /5 阶/);
  assert.match(line, /S2/, 'the equipped index 1 shows as S2');
  // a piece the loadout does not mention yet falls back to the default
  const bare = report({ picks: { diy5a: CAND.charId }, entries: {}, priv: { board: [{ uid: 1, kind: 'chess', id: A5 }], hand: [], loadout: {} } });
  assert.match(bare.lines.find((l) => l.startsWith('局内：')) || '', /S1（默认）/);
});
