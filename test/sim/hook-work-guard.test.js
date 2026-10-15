import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { MAX_HOOK_DEPTH, MAX_HOOK_WORK } from '../../server/sim/constants.js';

test('branching recursion stops the whole chain on depth overflow, rather than exploring every sibling', () => {
  const { b } = makeBattle({ content: 'none' });
  let calls = 0;
  b.on('loop', () => { calls++; b.emit('loop', {}); b.emit('loop', {}); });
  b.emit('loop', {});
  assert.ok(calls <= MAX_HOOK_DEPTH);
  assert.equal(b.errorCount, 1);
  assert.equal(b._emitDepth, 0);
  let next = 0;
  b.on('healthy', () => next++);
  b.emit('healthy', {});
  assert.equal(next, 1, 'the next independent chain still runs');
});

test('shallow fan-out shares a finite work budget across emit and safe callbacks', () => {
  const { b } = makeBattle({ content: 'none' });
  let calls = 0;
  b.on('leaf', () => calls++);
  b._safe(() => {
    for (let i = 0; i < MAX_HOOK_WORK * 2; i++) b.emit('leaf', {});
  }, 'fanout');
  assert.equal(calls, MAX_HOOK_WORK - 1);
  assert.equal(b.errorCount, 1);
  assert.equal(b.errors[0].label, 'hookBudget:leaf');
  assert.equal(b._emitDepth, 0);
  b.emit('leaf', {});
  assert.equal(calls, MAX_HOOK_WORK);
});
