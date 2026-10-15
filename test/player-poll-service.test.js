import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerPollStore, startPlayerPollService } from '../server/playerPollService.js';
import { CLEMENTIA_POLL } from '../shared/playerPoll.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stronghold-player-poll-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'votes.json');
}
test('votes persist across restart, replace previous choice and never persist raw identity', async t => {
  const file = await fixture(t), store = new PlayerPollStore(file), key = randomUUID();
  await store.load();
  assert.equal(store.snapshot().total, 0);
  await store.vote(key, 'tier5');
  await store.vote(key, 'tier5');
  await store.vote(key, 'unchanged');
  assert.equal(store.snapshot(key).total, 1);
  assert.equal(store.snapshot(key).choice, 'unchanged');
  assert.equal(store.snapshot().choice, null);
  const restarted = new PlayerPollStore(file);
  await restarted.load();
  assert.deepEqual(restarted.snapshot(key), store.snapshot(key));
  assert.ok(!(await readFile(file, 'utf8')).includes(key));
});
test('concurrent submissions are serialized with no lost votes', async t => {
  const store = new PlayerPollStore(await fixture(t));
  await store.load();
  await Promise.all(Array.from({ length: 20 }, () => store.vote(randomUUID(), 'tier6')));
  assert.equal(store.snapshot().total, 20);
  assert.equal(store.snapshot().options.find(o => o.id === 'tier6').percent, 100);
});
test('invalid votes and persistence errors cannot change the acknowledged tally', async t => {
  const store = new PlayerPollStore(await fixture(t));
  await store.load();
  const key = randomUUID();
  await assert.rejects(store.vote('not-a-key', 'tier5'));
  await assert.rejects(store.vote(key, 'invalid'));
  store.persist = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(store.vote(key, 'tier5'), /disk unavailable/);
  assert.equal(store.snapshot().total, 0);
});
test('corrupt saved data is rejected rather than silently resetting a live poll', async t => {
  const file = await fixture(t);
  await writeFile(file, '{');
  await assert.rejects(new PlayerPollStore(file).load());
  await writeFile(file, JSON.stringify({ pollId: 'wrong', votes: {} }));
  await assert.rejects(new PlayerPollStore(file).load());
});
test('HTTP validates origin, choice, size, identity, method and returns shared counts', async t => {
  const service = await startPlayerPollService({ file: await fixture(t), port: 0, log: { error() {} } });
  t.after(() => service.close());
  const url = service.url + '/api/player-poll', key = randomUUID();
  const request = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const message = { pollId: CLEMENTIA_POLL.id, voterKey: key, action: 'vote', choice: 'tier5' };
  assert.equal((await request(message, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await request({ ...message, choice: 'unknown' })).status, 400);
  assert.equal((await request({ ...message, voterKey: 'spoof' })).status, 400);
  assert.equal((await request({ ...message, pollId: 'other' })).status, 400);
  assert.equal((await request({ ...message, padding: 'a'.repeat(3000) })).status, 413);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
  assert.equal((await request(message)).status, 200);
  const shared = await (await fetch(url)).json();
  assert.equal(shared.total, 1);
  assert.equal(shared.choice, null);
  const personal = await (await request({ ...message, action: 'read' })).json();
  assert.equal(personal.choice, 'tier5');
  assert.equal(personal.total, 1);
  assert.equal((await fetch(service.url + '/healthz')).status, 200);
});
test('rapid vote changes are rate limited without adding ballots', async t => {
  const service = await startPlayerPollService({ file: await fixture(t), port: 0, log: { error() {} } });
  t.after(() => service.close());
  const key = randomUUID();
  for (let index = 0; index < 21; index++) {
    const res = await fetch(service.url + '/api/player-poll', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId: CLEMENTIA_POLL.id, voterKey: key, action: 'vote', choice: 'tier5' }) });
    assert.equal(res.status, index < 20 ? 200 : 429);
  }
  assert.equal(service.store.snapshot().total, 1);
});
