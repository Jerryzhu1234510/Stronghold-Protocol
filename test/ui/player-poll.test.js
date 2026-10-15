import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEMENTIA_POLL, validPollChoice, previewPollResults } from '../../shared/playerPoll.js';
import { PlayerPollEntry, PlayerPollModal, readPreviewPollChoice } from '../../public/js/ui/playerPoll.js';
import { snapshotComponent } from '../helpers/componentSnapshot.js';

test('Clementia poll offers the three proposals and the literal requested fourth choice', () => {
  assert.equal(CLEMENTIA_POLL.title, '克莱门莎调整');
  assert.deepEqual(CLEMENTIA_POLL.options.map(o => o.title), ['四本', '五本', '六本', '不该']);
  assert.deepEqual(CLEMENTIA_POLL.options[1].bonds, ['阿戈尔', '迅捷', '不屈']);
  assert.ok(CLEMENTIA_POLL.options[1].description.includes('精锐时每击杀2个敌人'));
  assert.ok(CLEMENTIA_POLL.options[2].description.includes('1%'));
  assert.ok(CLEMENTIA_POLL.options[2].description.includes('2%'));
  for (const value of [null, undefined, '', 'other', {}, 1]) assert.equal(validPollChoice(value), false);
});

test('preview counts start empty and count only one committed choice', () => {
  assert.equal(previewPollResults(null).total, 0);
  assert.ok(previewPollResults(null).options.every(o => o.votes === 0 && o.percent === 0));
  for (const option of CLEMENTIA_POLL.options) {
    assert.equal(validPollChoice(option.id), true);
    const result = previewPollResults(option.id);
    assert.equal(result.total, 1);
    assert.equal(result.options.reduce((sum, o) => sum + o.votes, 0), 1);
    assert.deepEqual(result.options.find(o => o.id === option.id), { id: option.id, votes: 1, percent: 100 });
  }
});

test('poll entry is explicitly labelled and the modal uses four native single-choice controls', () => {
  const entry = JSON.stringify(snapshotComponent(PlayerPollEntry)({}));
  assert.ok(entry.includes('投票'));
  assert.ok(entry.includes('danger'));
  const modal = JSON.stringify(snapshotComponent(PlayerPollModal)({ open: true, onClose() {} }));
  assert.ok(modal.includes('本地预览'));
  assert.ok(modal.includes('提交投票'));
  assert.equal((modal.match(/"type":"radio"/g) || []).length, 4);
  assert.ok(modal.includes('trapFocus'));
  assert.equal(readPreviewPollChoice(), null);
});
