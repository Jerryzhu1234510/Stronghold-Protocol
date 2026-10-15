import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchHistory, HISTORY_KEY, HISTORY_LIMIT } from '../../public/js/ui/matchHistory.js';

const result = id => ({ resultId: id, victory: true, seed: 23, roundsPassed: 14, players: [{ playerId: 'p1', name: 'Player', stats: { kills: 42 }, lineup: [{ id: 'chess1' }] }] });
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
};
test('history persists full settlement, dedupes reconnects, isolates mutable payloads, bounded latest-first', () => {
  const storage = memory(), history = createMatchHistory(storage);
  const input = result('one');
  assert.equal(history.save(input, { capacity: 4, gameMode: 'clone', lastRound: 15 }, 'p1', 100), true);
  input.players[0].stats.kills = 99;
  assert.equal(history.list()[0].result.players[0].stats.kills, 42);
  assert.equal(history.save(result('one'), {}, 'p1', 200), false);
  for (let i = 0; i < 30; i++) history.save(result('r' + i), {}, 'p1', 300 + i);
  assert.equal(history.list().length, HISTORY_LIMIT);
  const restored = createMatchHistory(storage);
  assert.equal(restored.list()[0].id, 'r29');
  assert.equal(restored.list()[0].result.players[0].lineup[0].id, 'chess1');
  restored.clear(); assert.equal(createMatchHistory(storage).list().length, 0);
});
test('history handles corrupt storage, disabled/quota-full storage and malformed frames without affecting settlement', () => {
  for (const storage of [null, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } }, { getItem: () => '{broken', setItem() { throw Error('quota'); } }]) {
    const history = createMatchHistory(storage);
    assert.equal(history.save(result('one')), true);
    assert.equal(history.list().length, 1);
    for (const bad of [null, {}, { players: [] }, { players: [null] }, { players: Array(9).fill({}) }, { players: [{}], text: 'x'.repeat(300000) }])
      assert.equal(history.save(bad), false);
  }
});
test('history legacy result replay dedupe, notifications and context excludes session secrets', () => {
  const storage = memory(), history = createMatchHistory(storage);
  let calls = 0; const off = history.subscribe(() => calls++);
  const frame = result('legacy'); delete frame.resultId;
  assert.equal(history.save(frame, { token: 'secret', capacity: 8, gameMode: 'clone' }, 'p1'), true);
  assert.equal(history.save(frame), false);
  assert.equal(calls, 1); off();
  assert.ok(!storage.getItem(HISTORY_KEY).includes('secret'));
  assert.equal(createMatchHistory(storage).list()[0].public.gameMode, 'clone');
});
