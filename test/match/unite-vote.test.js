import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { uniteSurvivors } from '../../server/match/unite.js';
import { HeadlessJob } from '../../server/match/fields.js';
import { Battle } from '../../server/sim/Battle.js';

function setup(clientCombat = false, options = {}) {
  const h = makeMatch({ humans: 4, fake: true, instant: false, clientCombat, clients: false,
    script: b => b.kind === 'normal' ? { duration: 1, leaks: { p_0: 3 } } : { duration: 60, survivors: { p_0: 2 } }, ...options }).start();
  h.toPrep(1);
  if (clientCombat) {
    // Reach unite through the real phase setup while keeping the test independent of browser authority reports.
    h.m.clientCombat = false;
    h.drive(() => h.m.phase === PHASE.UNITE);
    const plan = h.m.unitePlan;
    h.m.runner.stop();
    h.m.clientCombat = true;
    h.m._startUniteClient(plan);
  } else h.drive(() => h.m.phase === PHASE.UNITE);
  return h;
}
const propose = m => m.handle('p_0', { t: 'g.uniteSkip' });
const ballot = (m, pid, agree = true) => m.handle(pid, { t: 'g.uniteVote', voteId: m.uniteSkip.vote.id, agree });

for (const cc of [false, true]) test(`majority skip ends unite once and bills remaining monsters by original source (${cc ? 'client' : 'streaming'})`, () => {
  const h = setup(cc), m = h.m;
  assert.deepEqual(propose(m), { ok: true });
  assert.equal(m.uniteSkip.vote.required, 3);
  assert.deepEqual(ballot(m, 'p_1'), { ok: true });
  assert.equal(m.uniteSkip.vote.status, 'pending');
  assert.deepEqual(ballot(m, 'p_2'), { ok: true });
  assert.equal(m.uniteSkip.vote.status, 'passed');
  if (cc) h.run(() => m.fields[0].done);
  const f = m.fields[0];
  const res = cc ? f.result : f.battle.result();
  assert.equal(res.reason, 'timeout');
  assert.equal(uniteSurvivors(m.unitePlan, res).get('p_0'), 2);
  assert.ok(ballot(m, 'p_3').error, 'stale ballots cannot settle twice');
  assert.ok(propose(m).error);
  const lp = h.ps('p_0').lp;
  h.run(() => m.phase !== PHASE.UNITE);
  assert.equal(h.ps('p_0').lp, lp - 2);
  assert.equal(m.errorCount, 0);
  assert.deepEqual(h.sched.errors, []);
  m.dispose();
});

test('timeout, ties, duplicate votes and changed electorate cannot force a skip', () => {
  const h = setup(), m = h.m;
  propose(m);
  assert.ok(ballot(m, 'p_0').error);
  ballot(m, 'p_1', false);
  m.onDisconnect('p_2');
  assert.ok(ballot(m, 'p_2').error);
  assert.equal(m.uniteSkip.vote.required, 3);
  h.sched.advance(10000);
  assert.equal(m.uniteSkip.vote.status, 'expired');
  assert.equal(m.fields[0].live, true);
  assert.ok(propose(m).error);
  m.dispose();
});

test('spectators, AI, eliminated and disconnected players do not vote', () => {
  const h = setup(false, { humans: 4, bots: 1, spectators: ['s_test'] }), m = h.m;
  h.ps('p_3').alive = false;
  m.onDisconnect('p_2');
  for (const pid of ['ai_0', 's_test', 'p_3', 'p_2']) assert.ok(m.handle(pid, { t: 'g.uniteSkip' }).error);
  propose(m);
  assert.deepEqual(m.uniteSkip.vote.eligible, ['p_0', 'p_1']);
  ballot(m, 'p_1');
  assert.equal(m.uniteSkip.vote.status, 'passed');
  m.dispose();
});

test('client skip replays only to the skip clock; future kills and late reports cannot erase its LP bill', () => {
  const h = setup(true), m = h.m, f = m.fields[0];
  let limit = null;
  const orig = m._specBattle.bind(m);
  m._specBattle = spec => { const b = orig(spec); const step = b.step.bind(b); b.step = () => { step(); if (b.time > 2) b.plan.survivors = {}; }; return b; };
  const run = HeadlessJob.prototype.run;
  HeadlessJob.prototype.run = function (...args) { limit = this.cap; return run.apply(this, args); };
  try {
    propose(m); ballot(m, 'p_1'); ballot(m, 'p_2');
    assert.deepEqual(m.handle('p_1', { t: 'b.result', battleId: f.battleId, result: { reason: 'cleared', perPlayer: {} } }), { ok: true });
    h.run(() => f.done);
    assert.ok(limit < 60, 'zero/near-zero clock must not fast-forward the whole battle');
    assert.equal(uniteSurvivors(m.unitePlan, f.result).get('p_0'), 2);
  } finally { HeadlessJob.prototype.run = run; m.dispose(); }
});

test('skip protocol rejects malformed ballots', () => {
  assert.equal(validateC2S({ t: 'g.uniteSkip' }), null);
  assert.equal(validateC2S({ t: 'g.uniteVote', voteId: 'unite-1', agree: true }), null);
  assert.ok(validateC2S({ t: 'g.uniteVote', voteId: 'unite-1', agree: 'true' }));
});

test('real client-combat replay matches timeout at the frozen clock, including pending re-entries', () => {
  const h = setup(true), m = h.m, f = m.fields[0];
  m.BattleClass = Battle;
  h.sched.advance(2500);
  const reference = m._specBattle(f.spec);
  const elapsed = m._fieldElapsed(f);
  const ticks = Math.floor((elapsed + 1e-8) / reference.dt);
  for (let i = 0; i < ticks && !reference.finished; i++) reference.step();
  reference.forceEnd('timeout');
  const expected = reference.result();
  propose(m); ballot(m, 'p_1'); ballot(m, 'p_2');
  h.run(() => f.done);
  assert.equal(f.result.time, expected.time);
  assert.deepEqual(uniteSurvivors(m.unitePlan, f.result), uniteSurvivors(m.unitePlan, expected));
  assert.deepEqual(f.result.unspawned, expected.unspawned);
  assert.equal(m.errorCount, 0);
  m.dispose();
});

test('an unwinnable ballot rejects immediately; natural battle completion wins pending-vote races', () => {
  const h = setup(), m = h.m;
  propose(m); ballot(m, 'p_1', false); ballot(m, 'p_2', false);
  assert.equal(m.uniteSkip.vote.status, 'rejected');
  assert.equal(m.fields[0].live, true);
  m.dispose();
  const h2 = setup(), m2 = h2.m;
  propose(m2);
  m2.runner.forceAll('timeout');
  assert.ok(ballot(m2, 'p_1').error);
  h2.run(() => m2.phase !== PHASE.UNITE);
  assert.notEqual(m2.uniteSkip.vote.status, 'passed');
  assert.equal(m2.errorCount, 0);
  m2.dispose();
});
