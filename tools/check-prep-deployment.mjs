// Run only against an isolated staging server; this creates a disposable two-human match.
import assert from 'node:assert/strict';
import { TestClient } from '../test/helpers/wsClient.js';
import { getData } from '../server/data.js';
const port = Number(process.argv[2] || 14519);
assert.ok(Number.isInteger(port) && port > 0 && port !== 14517, 'Do not run this check against the live gateway');
const clients = [];
const player = async token => {
  const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`); clients.push(c);
  const w = await c.hello('加时验收', token); c.id = w.playerId; c.token = w.token; return c;
};
const ok = async (c, msg) => { const reply = await c.request(msg); assert.equal(reply.t, 'ok', `${msg.t}: ${JSON.stringify(reply)}`); };
try {
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.json());
  assert.equal(health.matches, 0, 'Staging server must start empty');
  const a = await player(), b = await player();
  await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await a.waitFor('room.state');
  await ok(b, { t: 'room.join', code: room.code });
  await ok(b, { t: 'room.ready', ready: true });
  await ok(a, { t: 'room.start' });
  await ok(a, { t: 'g.infoReady' }); await ok(b, { t: 'g.infoReady' });
  const pending = new Map([[a.id, a], [b.id, b]]);
  while (pending.size) {
    const pub = await a.waitFor('m.public', p => p.phase === 'BAND_DRAFT' && pending.has(p.draft?.turn), 10000);
    const taken = new Set(Object.values(pub.draft.picks));
    const band = Object.values(getData().bands).find(x => (!x.modeTypeList || x.modeTypeList.includes('MULTI')) && !taken.has(x.bandId));
    await ok(pending.get(pub.draft.turn), { t: 'g.band', bandId: band.bandId }); pending.delete(pub.draft.turn);
  }
  const prep = await a.waitFor('m.public', p => p.phase === 'PREP', 10000);
  await ok(a, { t: 'g.emote', id: 'autochess_battle_happy' });
  await a.waitFor('m.emote', p => p.playerId === a.id && p.id === 'autochess_battle_happy');
  await b.waitFor('m.emote', p => p.playerId === a.id && p.id === 'autochess_battle_happy');
  assert.equal(prep.deadline > Date.now(), true);
  await ok(a, { t: 'g.prepExtend', seconds: 30 });
  const ballot = await b.waitFor('m.public', p => p.prepExtension?.vote?.status === 'pending');
  assert.equal(ballot.prepExtension.vote.required, 2);
  assert.equal(ballot.deadline, prep.deadline);
  await b.terminate();
  const resumed = await player(b.token);
  assert.equal(resumed.id, b.id);
  await resumed.waitFor('m.public', p => p.prepExtension?.vote?.id === ballot.prepExtension.vote.id);
  await ok(resumed, { t: 'g.prepVote', voteId: ballot.prepExtension.vote.id, agree: true });
  const passed = await a.waitFor('m.public', p => p.prepExtension?.vote?.status === 'passed');
  assert.equal(passed.deadline, prep.deadline + 30000);
  await ok(a, { t: 'g.readyReminder' });
  await resumed.waitFor('m.public', p => p.prepExtension?.reminder?.playerId === a.id);
  assert.equal((await resumed.request({ t: 'g.readyReminder' })).code, 'RATE');
  await ok(a, { t: 'g.ready', ready: true }); await ok(resumed, { t: 'g.ready', ready: true });
  await a.waitFor('b.start', b => b.authoritative, 3000);
  console.log(JSON.stringify({ ok: true, build: health.build, version: health.app,
    checks: ['two-human match', 'server vote quorum', 'reconnect restores vote', '30 real seconds added', 'reminder cooldown', 'all-ready immediately starts combat'] }));
} finally { await Promise.all(clients.map(c => c.terminate().catch(() => {}))); }
