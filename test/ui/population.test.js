import { test } from 'node:test';
import assert from 'node:assert/strict';
import { populationCounts, fetchPopulation, PopulationStrip } from '../../public/js/ui/population.js';
import { snapshotComponent } from '../helpers/componentSnapshot.js';

const health = (online, humans, inGame, spectators = 0) => ({ ok: true,
  onlinePlayers: online, onlineHumans: humans, onlineInMatches: inGame, onlineSpectators: spectators });

test('population splits connected humans into four disjoint categories across healthy releases', () => {
  const result = populationCounts([health(4, 2, 0), health(13, 3, 1), health(378, 320, 286, 5)]);
  assert.deepEqual(result, { online: 395, inGame: 287, lobby: 65, waiting: 38, spectators: 5 });
  assert.equal(result.online, result.inGame + result.lobby + result.waiting + result.spectators);
  assert.deepEqual(populationCounts([health(0, 0, 0)]), { online: 0, inGame: 0, lobby: 0, waiting: 0, spectators: 0 });
});

test('invalid and incomplete health reports do not become a misleading zero count', () => {
  for (const reports of [[], [{}], [health(-1, 0, 0)], [health(1, 2, 0)], [health(1, 1, 2)]]) {
    assert.throws(() => populationCounts(reports));
  }
});

test('hot population excludes retired workers and still includes a live draining worker', async () => {
  const calls = [], signal = new AbortController().signal;
  const fetcher = async (url, init) => {
    calls.push(url);
    assert.equal(init.signal, signal);
    assert.equal(init.cache, 'no-store');
    return { ok: true, json: async () => url === '/__hot/status'
      ? { versions: [{ id: 'old-1', healthy: true, draining: true }, { id: 'dead-2', healthy: false }, { id: 'new-3', healthy: true }] }
      : url.includes('old-1') ? health(4, 2, 0) : health(10, 8, 6, 1) };
  };
  assert.deepEqual(await fetchPopulation({ generation: 'new-3', fetcher, signal }),
    { online: 14, inGame: 6, lobby: 3, waiting: 4, spectators: 1 });
  assert.deepEqual(calls, ['/__hot/status', '/_build/old-1/healthz', '/_build/new-3/healthz']);
});

test('a local unversioned server uses its own health report; failed requests reject', async () => {
  assert.equal((await fetchPopulation({ generation: null, fetcher: async url => {
    assert.equal(url, '/healthz');
    return { ok: true, json: async () => health(9, 6, 4, 1) };
  } })).online, 9);
  await assert.rejects(fetchPopulation({ generation: 'new-3', fetcher: async () => ({ ok: false }) }));
});

test('population UI separates totals and details and removes the matchmaking label', () => {
  const tree = snapshotComponent(PopulationStrip)({});
  const text = JSON.stringify(tree);
  for (const label of ['在线', '对局中', '大厅', '待开局', '观战']) assert.ok(text.includes(label));
  assert.ok(!text.includes('匹配中'));
  assert.ok(text.includes('population-strip__summary'));
  assert.ok(text.includes('population-strip__details'));
});
