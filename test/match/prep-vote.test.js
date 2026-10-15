import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE, ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { prepVoteView, prepVoteBadge } from '../../public/js/ui/prepVote.js';

const setup = (options = {}) => makeMatch({ humans: 4, fake: true, instant: false, ...options }).start().toPrep(1);
const propose = (m, seconds = 60, pid = 'p_0') => m.handle(pid, { t: 'g.prepExtend', seconds });
const vote = (m, pid, agree = true, voteId = m.prepExtension.vote.id) => m.handle(pid, { t: 'g.prepVote', voteId, agree });
const readyAll = m => { for (const ps of m.alivePlayers()) { ps.resolveTemp(); ps.setReady(true); } };

for (const humans of [2, 3, 4, 5, 6, 7, 8]) for (const seconds of [30, 60]) {
  test(`${humans} humans, +${seconds}: strict majority extends the remaining prep exactly once`, () => {
    const h = setup({ humans, capacity: humans }), m = h.m;
    const initial = m.deadline;
    h.sched.advance(1000);
    assert.deepEqual(propose(m, seconds), { ok: true });
    const required = Math.floor(humans / 2) + 1;
    assert.equal(m.prepExtension.vote.required, required);
    assert.equal(m.deadline, initial, 'proposal does not freeze or reset the original clock');
    for (let i = 1; i < required - 1; i++) assert.deepEqual(vote(m, `p_${i}`), { ok: true });
    assert.equal(m.prepExtension.vote.status, 'pending');
    assert.deepEqual(vote(m, `p_${required - 1}`), { ok: true });
    assert.equal(m.prepExtension.vote.status, 'passed');
    assert.equal(m.deadline, initial + seconds * 1000);
    assert.equal(m.prepExtension.addedSeconds, seconds);
    assert.ok(propose(m, 30, 'p_1').error);
    assert.ok(vote(m, 'p_0').error);
    h.sched.advance(initial - h.sched.now() + 1);
    assert.equal(m.phase, PHASE.PREP, 'original timer was cancelled');
    h.run(() => m.phase !== PHASE.PREP);
    assert.deepEqual(h.sched.errors, []);
    assert.equal(m.errorCount, 0);
    m.dispose();
  });
}

test('a 2–2 tie is rejected early; a failed proposal cannot be repeatedly relaunched', () => {
  const h = setup(), m = h.m, initial = m.deadline;
  propose(m);
  vote(m, 'p_1', true);
  vote(m, 'p_2', false);
  vote(m, 'p_3', false);
  assert.equal(m.prepExtension.vote.status, 'rejected');
  assert.equal(m.deadline, initial);
  assert.ok(propose(m, 30, 'p_2').error);
  m.dispose();
});

test('timeout defaults unanswered ballots to rejection without delaying prep', () => {
  const h = setup(), m = h.m, initial = m.deadline;
  propose(m);
  const id = m.prepExtension.vote.id;
  h.sched.advance(10000);
  assert.equal(m.prepExtension.vote.status, 'pending', 'players have time to notice the ballot');
  h.sched.advance(20000);
  assert.equal(m.prepExtension.vote.status, 'expired');
  assert.equal(m.deadline, initial);
  assert.deepEqual(m.prepExtension.vote.votes, { p_0: true, p_1: false, p_2: false, p_3: false });
  assert.ok(vote(m, 'p_1', true, id).error);
  assert.equal(m.phase, PHASE.PREP);
  m.dispose();
});

test('bots, spectators, dead and offline seats cannot vote or inflate the electorate', () => {
  const h = setup({ humans: 5, bots: 2, capacity: 8, spectators: ['s_test'] }), m = h.m;
  h.ps('p_3').alive = false;
  m.onDisconnect('p_4');
  assert.ok(propose(m, 60, 'ai_0').error);
  assert.ok(propose(m, 60, 's_test').error);
  assert.ok(propose(m, 60, 'p_3').error);
  assert.ok(propose(m, 60, 'p_4').error);
  propose(m);
  assert.deepEqual(m.prepExtension.vote.eligible, ['p_0', 'p_1', 'p_2']);
  m.onReconnect('p_4');
  assert.ok(vote(m, 'p_4').error, 'joining later does not change the electorate');
  assert.deepEqual(vote(m, 'p_1'), { ok: true });
  assert.equal(m.prepExtension.vote.status, 'passed');
  assert.equal(h.lastTo('s_test', 'm.private'), null);
  m.dispose();
});

test('disconnect does not lower the quorum; reconnect restores vote state and permits one ballot', () => {
  const h = setup(), m = h.m;
  propose(m);
  const id = m.prepExtension.vote.id;
  m.onDisconnect('p_1');
  assert.ok(vote(m, 'p_1').error);
  vote(m, 'p_2');
  assert.equal(m.prepExtension.vote.status, 'pending');
  assert.equal(m.prepExtension.vote.required, 3);
  m.onReconnect('p_1');
  assert.equal(h.lastTo('p_1', 'm.public').prepExtension.vote.id, id);
  assert.deepEqual(vote(m, 'p_1'), { ok: true });
  assert.ok(vote(m, 'p_1', false).error);
  assert.equal(m.prepExtension.vote.status, 'passed');
  m.dispose();
});

for (const passed of [false, true]) test(`all-ready starts combat immediately while vote is ${passed ? 'passed' : 'pending'}`, () => {
  const h = setup(), m = h.m;
  propose(m);
  if (passed) { vote(m, 'p_1'); vote(m, 'p_2'); }
  readyAll(m);
  h.sched.advance(0);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.equal(m.prepExtension.vote.status, passed ? 'passed' : 'expired');
  assert.ok(vote(m, 'p_3').error);
  assert.equal(m.publicView().prepExtension, undefined);
  m.dispose();
});

test('a ready initiator must unready first; voting does not change any ready flag', () => {
  const h = setup(), m = h.m;
  h.ps('p_0').resolveTemp(); h.ps('p_0').setReady(true);
  assert.ok(propose(m).error);
  h.ps('p_0').setReady(false);
  propose(m);
  h.ps('p_1').resolveTemp(); h.ps('p_1').setReady(true);
  vote(m, 'p_1');
  assert.equal(h.ps('p_1').ready, true);
  assert.equal(h.ps('p_0').ready, false);
  m.dispose();
});

test('vote closes at prep deadline; a delayed packet never resurrects a timed-out prep', () => {
  const h = setup(), m = h.m;
  h.sched.advance(m.deadline - h.sched.now() - 500);
  propose(m);
  assert.equal(m.prepExtension.vote.deadline, m.deadline);
  const initial = m.deadline;
  // A delayed event loop: deadline timer is due but has not executed yet.
  h.sched.t = initial;
  assert.ok(vote(m, 'p_1').error);
  assert.equal(m.prepExtension.vote.status, 'expired');
  assert.equal(m.deadline, initial);
  assert.ok(propose(m).error);
  h.sched.advance(0);
  assert.notEqual(m.phase, PHASE.PREP);
  m.dispose();
});

test('timer scale applies once; new rounds reset usage and reject stale ballots', () => {
  const h = setup({ timerScale: .1 }), m = h.m;
  const initial = m.deadline;
  propose(m, 30); const id = m.prepExtension.vote.id;
  vote(m, 'p_1'); vote(m, 'p_2');
  assert.equal(m.deadline, initial + 3000);
  m.round = 2; m.enterPrep();
  assert.equal(m.prepExtension.used, false);
  assert.equal(m.prepExtension.addedSeconds, 0);
  assert.equal(m.prepExtension.vote, null);
  propose(m);
  assert.notEqual(m.prepExtension.vote.id, id);
  assert.ok(vote(m, 'p_1', true, id).error);
  h.sched.advance(3000);
  assert.equal(m.prepExtension.vote.status, 'expired');
  m.dispose();
});

test('untimed solo/single-human prep needs no extension; reminders are throttled and do not ready teammates', () => {
  for (const opts of [{ mode: 'solo', humans: 1 }, { humans: 1, bots: 3 }]) {
    const h = setup(opts), m = h.m;
    assert.equal(m.deadline, 0);
    assert.equal(m.prepExtension.enabled, false);
    assert.ok(propose(m).error);
    m.dispose();
  }
  const h = setup(), m = h.m;
  const ready = m.order.map(p => p.ready);
  assert.deepEqual(m.handle('p_0', { t: 'g.readyReminder' }), { ok: true });
  assert.equal(m.handle('p_1', { t: 'g.readyReminder' }).error, ERR.RATE);
  assert.deepEqual(m.order.map(p => p.ready), ready);
  h.sched.advance(5000);
  assert.equal(m.prepExtension.reminder, null);
  assert.deepEqual(m.handle('p_1', { t: 'g.readyReminder' }), { ok: true });
  m.dispose();
  h.sched.advance(10000);
  assert.deepEqual(h.sched.errors, []);
});

test('public snapshots are independent and frontend gates old matches / spectators / stale ballots', () => {
  const h = setup(), m = h.m;
  propose(m);
  const pub = m.publicView(), now = h.sched.now();
  const view = prepVoteView(pub, 'p_1', { alive: true, ready: true }, now);
  assert.equal(view.canVote, true);
  assert.equal(view.canStart, false);
  assert.equal(prepVoteView(pub, 's_test', null, now).allowed, false);
  assert.equal(prepVoteView({ ...pub, prepExtension: undefined }, 'p_1', {}, now).ext, undefined);
  assert.equal(prepVoteView(pub, 'p_1', {}, pub.prepExtension.vote.deadline).canVote, false);
  assert.equal(prepVoteBadge(pub, 'p_0').text, '发起 ✓');
  assert.equal(prepVoteBadge(pub, 'p_1').text, '待投票');
  assert.equal(prepVoteBadge({ ...pub, phase: PHASE.COMBAT }, 'p_0'), null);
  pub.prepExtension.vote.votes.p_1 = true;
  pub.prepExtension.vote.eligible.length = 0;
  assert.deepEqual(m.prepExtension.vote.votes, { p_0: true });
  assert.equal(m.prepExtension.vote.eligible.length, 4);
  m.dispose();
});

test('protocol limits tiers, vote id length and boolean ballots', () => {
  for (const seconds of [30, 60]) assert.equal(validateC2S({ t: 'g.prepExtend', seconds }), null);
  for (const seconds of [0, 90, 60000, '30']) assert.ok(validateC2S({ t: 'g.prepExtend', seconds }));
  assert.equal(validateC2S({ t: 'g.prepVote', voteId: 'prep-1-1', agree: true }), null);
  assert.ok(validateC2S({ t: 'g.prepVote', voteId: 'x'.repeat(41), agree: true }));
  assert.ok(validateC2S({ t: 'g.prepVote', voteId: 'prep-1-1', agree: 'yes' }));
  assert.equal(validateC2S({ t: 'g.readyReminder' }), null);
});
