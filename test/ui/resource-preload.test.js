import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startResourcePreload } from '../../public/js/resources/preload.js';

test('preloading waits for safe phases, backs off failures and cancels without overlapping downloads', async () => {
  let allowed = false, calls = 0, queued, delay, cancelled = false;
  const stop = startResourcePreload({ enabled: true, supported: () => true, random: () => 0,
    canDownload: () => allowed,
    schedule: (fn, ms) => { queued = fn; delay = ms; return 1; },
    cancel: () => { cancelled = true; },
    action: async name => { assert.equal(name, 'warm'); calls++; return { enabled: true, preload: { state: calls === 1 ? 'retry' : 'complete' } }; },
  });
  assert.equal(delay, 5000);
  await queued(); assert.equal(calls, 0);
  allowed = true; await queued(); assert.equal(calls, 1); assert.equal(delay, 30000);
  await queued(); assert.equal(calls, 2); assert.equal(delay, 60000);
  stop(); assert.equal(cancelled, true); await queued(); assert.equal(calls, 2);
});

test('unsupported browsers do not start download timers', () => {
  let scheduled = false;
  startResourcePreload({ supported: () => false, schedule: () => { scheduled = true; } })();
  assert.equal(scheduled, false);
});

test('automatic bulk preloading is off by default even on a supported connected browser', () => {
  let scheduled = false;
  startResourcePreload({ supported: () => true, schedule: () => { scheduled = true; } })();
  assert.equal(scheduled, false);
});

test('8443 never schedules manual or automatic bulk downloads, including native clients',()=>{
 const saved=globalThis.__SP_LOCAL_RESOURCES_REQUIRED;globalThis.__SP_LOCAL_RESOURCES_REQUIRED=true;
 try {for(const manual of [true,false]){
  let schedules=0,actions=0;
  startResourcePreload({enabled:true,manual,supported:()=>true,schedule:()=>schedules++,action:async()=>{actions++}})();
  assert.equal(schedules,0);assert.equal(actions,0);
 }}finally{if(saved===undefined)delete globalThis.__SP_LOCAL_RESOURCES_REQUIRED;else globalThis.__SP_LOCAL_RESOURCES_REQUIRED=saved;}
});

test('manual preload starts immediately, reports real progress, and stops after completion', async () => {
  let queued, delay, calls = 0, schedules = 0;
  const seen = [];
  const stop = startResourcePreload({ enabled: true, manual: true, supported: () => true,
    schedule: (fn, ms) => { queued = fn; delay = ms; schedules++; return schedules; }, cancel: () => {},
    action: async (name, extra) => {
      assert.equal(name, 'warm'); assert.deepEqual(extra, { manual: true }); calls++;
      return { enabled: true, preload: { state: calls === 1 ? 'loading' : 'complete', downloadedBytes: 65536 } };
    }, onStatus: value => seen.push(value.preload.state) });
  assert.equal(delay, 0);
  await queued(); assert.equal(delay, 0, 'manual downloads have no artificial bandwidth delay');
  await queued(); assert.equal(schedules, 2);
  assert.deepEqual(seen, ['loading', 'complete']);
  stop(); await queued(); assert.equal(calls, 2);
});

test('lobby downloads allow sixteen continuous slots without pacing large files', async () => {
  let queued, delay, requests = 0;
  const stop = startResourcePreload({ enabled: true, manual: true, concurrency: 999, supported: () => true,
    schedule: (fn, ms) => { queued = fn; delay = ms; return 1; }, cancel: () => {},
    action: async (name, extra) => {
      assert.equal(name, 'warm'); assert.equal(extra.manual, true); assert.equal(extra.concurrency, 16);
      assert.equal(typeof extra.warmId, 'string'); requests++;
      return { enabled: true, preload: { state: 'loading', downloadedBytes: 8 * 1048576 } };
    } });
  await queued(); assert.equal(delay, 0); assert.equal(requests, 1);
  stop(); await queued(); assert.equal(requests, 1);
});

test('pausing an in-flight parallel preload sends its stop ticket and ignores the eventual reply', async () => {
  let queued, finish, reports = 0;
  const calls = [];
  const stop = startResourcePreload({ enabled: true, manual: true, concurrency: 16, supported: () => true,
    schedule: fn => { queued = fn; return 1; }, cancel: () => {}, onStatus: () => reports++,
    action: (name, extra) => {
      calls.push({ name, extra });
      if (name === 'warm.stop') return Promise.resolve({ enabled: true, preload: { state: 'paused' } });
      return new Promise(resolve => { finish = resolve; });
    } });
  const pending = queued(); stop(); stop();
  assert.deepEqual(calls.map(c => c.name), ['warm', 'warm.stop']);
  assert.equal(calls[1].extra.warmId, calls[0].extra.warmId);
  finish({ enabled: true, preload: { state: 'loading' } }); await pending;
  assert.equal(reports, 0);
});

test('a stopped preload cannot report or reschedule an in-flight response', async () => {
  let queued, finish, reports = 0, schedules = 0;
  const stop = startResourcePreload({ enabled: true, manual: true, supported: () => true,
    schedule: fn => { queued = fn; schedules++; return 1; }, cancel: () => {},
    action: () => new Promise(resolve => { finish = resolve; }), onStatus: () => reports++ });
  const pending = queued(); stop(); finish({ enabled: true, preload: { state: 'loading' } }); await pending;
  assert.equal(reports, 0); assert.equal(schedules, 1);
});
