import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { Match } from '../../server/match/Match.js';
import { getData } from '../../server/data.js';
import { TestClient } from '../helpers/wsClient.js';
import { FakeBattle } from './fakeBattle.js';

class VoteMatch extends Match {
  constructor(opts) { super({ ...opts, timerScale: .2, BattleClass: FakeBattle, clientCombat: true }); }
}

test('four real sockets: proposal → reconnect → majority → extended public clock → all-ready combat', async () => {
  const errors = [], clients = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', MatchClass: VoteMatch, seedFn: () => 69,
    log: { info() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) } });
  const player = async token => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    const w = await c.hello('vote-test', token); c.id = w.playerId; c.token = w.token; return c;
  };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok', msg.t);
  try {
    const seats = [];
    for (let i = 0; i < 4; i++) seats.push(await player());
    const host = seats[0];
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 4 });
    const room = await host.waitFor('room.state');
    for (const c of seats.slice(1)) { await ok(c, { t: 'room.join', code: room.code }); await ok(c, { t: 'room.ready', ready: true }); }
    await ok(host, { t: 'room.start' });
    for (const c of seats) await ok(c, { t: 'g.infoReady' });
    const pending = new Map(seats.map(c => [c.id, c]));
    while (pending.size) {
      const pub = await host.waitFor('m.public', p => p.phase === 'BAND_DRAFT' && pending.has(p.draft?.turn), 10000);
      const taken = new Set(Object.values(pub.draft.picks));
      const band = Object.values(getData().bands).find(b => (!b.modeTypeList || b.modeTypeList.includes('MULTI')) && !taken.has(b.bandId));
      await ok(pending.get(pub.draft.turn), { t: 'g.band', bandId: band.bandId });
      pending.delete(pub.draft.turn);
    }
    const prep = await host.waitFor('m.public', p => p.phase === 'PREP', 10000);
    await ok(host, { t: 'g.prepExtend', seconds: 60 });
    const ballot = await seats[1].waitFor('m.public', p => p.prepExtension?.vote?.status === 'pending');
    assert.equal(ballot.deadline, prep.deadline);
    assert.equal(ballot.prepExtension.vote.required, 3);
    const id = ballot.prepExtension.vote.id;
    const dropped = seats[2]; await dropped.terminate();
    seats[2] = await player(dropped.token);
    assert.equal(seats[2].id, dropped.id);
    const restored = await seats[2].waitFor('m.public', p => p.prepExtension?.vote?.id === id);
    assert.equal(restored.prepExtension.vote.votes[host.id], true);
    await ok(seats[1], { t: 'g.prepVote', voteId: id, agree: true });
    await ok(seats[2], { t: 'g.prepVote', voteId: id, agree: true });
    const passed = await host.waitFor('m.public', p => p.prepExtension?.vote?.status === 'passed');
    assert.equal(passed.deadline, prep.deadline + 12000);
    assert.equal(passed.prepExtension.addedSeconds, 60);
    await ok(host, { t: 'g.readyReminder' });
    const reminder = await seats[3].waitFor('m.public', p => p.prepExtension?.reminder?.playerId === host.id);
    assert.equal(reminder.players.some(p => p.ready), false);
    for (const c of seats) await ok(c, { t: 'g.ready', ready: true });
    await host.waitFor('b.start', b => b.authoritative, 3000);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(clients.map(c => c.terminate().catch(() => {})));
    await srv.close();
  }
});
