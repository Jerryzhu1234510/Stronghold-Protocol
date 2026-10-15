import test from 'node:test';
import assert from 'node:assert/strict';
import { totalTrophiesOf, formatAccountTrophies, watchAccountTrophies } from '../../public/js/ui/accountTrophyState.js';

test('cumulative trophies use the account total, retain half cups and hide anonymous cached profiles', () => {
  assert.equal(totalTrophiesOf({ totalTrophies: 1234.5, trophies: 7, name: '3' }), 1234.5);
  assert.equal(formatAccountTrophies(1234.5), '1,234.5');
  assert.equal(formatAccountTrophies(0), '0');
  assert.equal(totalTrophiesOf({ totalTrophies: 30 }, false), null);
  assert.equal(totalTrophiesOf(null, true), null);
  for (const totalTrophies of [undefined, null, -1, NaN, Infinity, '12']) assert.equal(totalTrophiesOf({ totalTrophies }), 0);
});

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const target = new EventTarget(), document = new EventTarget(), values = [];
  document.visibilityState = 'visible';
  let token = 'account-a', profile = { totalTrophies: 12 }, calls = 0, resolve = null;
  const stop = watchAccountTrophies(v => values.push(v), { target, document, readToken: () => token, readProfile: () => profile,
    refresh: () => { calls++; return new Promise(r => { resolve = r; }); } });
  return { target, document, values, stop, setToken: v => { token = v; }, setProfile: v => { profile = v; },
    get calls() { return calls; }, finish: () => resolve?.() };
}

test('entry and focus refresh server totals; account events only repaint and do not request recursively', async () => {
  const f = fixture();
  assert.deepEqual(f.values, [12]);
  await flush(); assert.equal(f.calls, 1);
  f.setProfile({ totalTrophies: 20.5 }); f.target.dispatchEvent(new Event('sp:account-change'));
  await flush(); assert.equal(f.values.at(-1), 20.5); assert.equal(f.calls, 1);
  f.finish(); await flush(); f.target.dispatchEvent(new Event('focus')); await flush(); assert.equal(f.calls, 2);
  f.stop(); f.finish();
});

test('sign-out hides immediately; another tab can switch accounts without exposing stale totals', async () => {
  const f = fixture(); await flush();
  f.setToken(null); f.target.dispatchEvent(new Event('sp:account-change')); assert.equal(f.values.at(-1), null);
  f.finish(); await flush(); assert.equal(f.values.at(-1), null);
  f.setToken('account-b'); f.setProfile({ totalTrophies: 0 });
  const event = new Event('storage'); Object.defineProperty(event, 'key', { value: 'sp.account' });
  f.target.dispatchEvent(event); await flush(); assert.equal(f.values.at(-1), 0); assert.equal(f.calls, 2);
  f.stop(); f.finish();
});

test('hidden pages do not refresh and unmounted components release listeners and pending callbacks', async () => {
  const f = fixture(); await flush(); f.finish(); await flush();
  f.document.visibilityState = 'hidden'; f.target.dispatchEvent(new Event('focus')); await flush(); assert.equal(f.calls, 1);
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(f.calls, 2);
  const n = f.values.length; f.stop(); f.finish(); await flush();
  f.target.dispatchEvent(new Event('focus')); f.target.dispatchEvent(new Event('sp:account-change')); await flush();
  assert.equal(f.values.length, n); assert.equal(f.calls, 2);
});
