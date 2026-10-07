// The presence readout (在线人数) next to the release version: the pure formatting of `public/js/ui/presence.js`, the
// wiring the two screens and the store need, and the wiring of the `presence` frame (shared/protocol.js) end to end —
// the frame itself is driven against a real server by test/presence.test.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { presenceFacts, presenceLabel, fetchPresence, PRESENCE_POLL_MS, PRESENCE_FETCH_TIMEOUT_MS } from '../../public/js/ui/presence.js';
import { initialState } from '../../public/js/store.js';
import { C2S, S2C } from '../../shared/protocol.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('presence readout (在线人数)', () => {
  test('presenceFacts keeps whole, non-negative numbers and reports the rest as unknown', () => {
    assert.deepEqual(presenceFacts({ online: 3, inRoom: 1 }), { online: 3, inRoom: 1 });
    assert.deepEqual(presenceFacts({ online: 0, inRoom: 0 }), { online: 0, inRoom: 0 }, 'zero is a known number');
    assert.deepEqual(presenceFacts({ online: 2.7, inRoom: -1 }), { online: 2, inRoom: null }, 'floored, negative → unknown');
    assert.deepEqual(presenceFacts({ online: '4', inRoom: NaN }), { online: null, inRoom: null }, 'only numbers count');
    assert.deepEqual(presenceFacts(null), { online: null, inRoom: null }, 'no frame yet');
    assert.deepEqual(presenceFacts(undefined), { online: null, inRoom: null });
    assert.deepEqual(presenceFacts({}), { online: null, inRoom: null });
  });

  test('presenceLabel names both counters and shows — while a number is unknown', () => {
    assert.equal(presenceLabel({ online: 3, inRoom: 1 }), '在线 3 人 · 房间内 1 人');
    assert.equal(presenceLabel({ online: 0, inRoom: 0 }), '在线 0 人 · 房间内 0 人');
    assert.equal(presenceLabel(null), '在线 — 人 · 房间内 — 人');
    assert.equal(presenceLabel({ online: 5 }), '在线 5 人 · 房间内 — 人', 'a half-known frame still shows what it has');
  });

  test('the frame is part of the protocol and the client subscribes to it', () => {
    assert.ok(S2C.includes('presence'), 'S2C lists presence');
    assert.equal(C2S.presence, undefined, 'presence is server → client only');
    assert.match(read('public/js/main.js'), /net\.on\('presence', \(msg\) => store\.set\(\{ presence: presenceFacts\(msg\) \}\)\)/, 'main.js stores the frame');
    assert.match(read('public/js/main.js'), /import \{ presenceFacts \} from '\.\/ui\/presence\.js'/, 'main.js imports the helper');
  });

  test('the store carries a presence slice that starts unknown', () => {
    assert.deepEqual(initialState.presence, { online: null, inRoom: null });
  });

  test('both screens render the readout from the store', () => {
    const title = read('public/js/screens/title.js');
    const lobby = read('public/js/screens/lobby.js');
    for (const [name, src] of [['title', title], ['lobby', lobby]]) {
      assert.match(src, /import \{ presenceLabel(?:, fetchPresence, PRESENCE_POLL_MS)? \} from '\.\.\/ui\/presence\.js'/, `${name}: imports the helper`);
      assert.match(src, /useStore\(\(s\) => s\.presence, shallowEqual\)/, `${name}: reads the presence slice`);
      assert.match(src, /presenceLabel\(presence\)/, `${name}: renders the stored numbers`);
      assert.match(src, /class="presence num"/, `${name}: renders the readout`);
    }
    assert.match(title, /data-testid="title-presence"/);
    assert.match(lobby, /data-testid="lobby-presence"/);
    // the release version stays where test/version.test.js expects it, next to the counters
    assert.match(title, /v\$\{APP_VERSION\}/);
  });

  test('the title screen polls /healthz (it has no session for the pushed frame)', () => {
    const title = read('public/js/screens/title.js');
    assert.match(title, /await fetchPresence\(\)/, 'title.js fetches the counters');
    assert.match(title, /setInterval\(\(\) => \{ void tick\(\); \}, PRESENCE_POLL_MS\)/, 'and keeps them fresh while the screen is up');
    assert.match(read('server/index.js'), /\.\.\.lobby\.presence\(\)/, '/healthz serves the same counters');
    assert.ok(PRESENCE_POLL_MS >= 5000 && PRESENCE_POLL_MS <= 60_000, `a sane poll interval (${PRESENCE_POLL_MS} ms)`);
  });

  test('fetchPresence reads /healthz and answers unknown for anything that is not a good answer', async () => {
    const okFetch = async (url) => {
      assert.equal(url, '/healthz');
      return { ok: true, json: async () => ({ ok: true, app: '0.1.4', online: 4, inRoom: 2 }) };
    };
    assert.deepEqual(await fetchPresence(okFetch), { online: 4, inRoom: 2 });
    // a healthz without the counters (an older server) is unknown, not zero
    assert.deepEqual(await fetchPresence(async () => ({ ok: true, json: async () => ({ ok: true, sessions: 3 }) })), { online: null, inRoom: null });
    assert.equal(await fetchPresence(async () => ({ ok: false, status: 404, json: async () => ({}) })), null, '404 → unknown');
    assert.equal(await fetchPresence(async () => { throw new Error('offline'); }), null, 'a dead server → unknown');
    assert.equal(await fetchPresence(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })), null, 'broken JSON → unknown');
    // a hanging answer is abandoned (its own timeout), so the next poll is not queued behind it
    const hang = () => new Promise(() => {});
    const fast = (fn, ms) => { const id = setTimeout(fn, ms); return id; };
    assert.equal(await fetchPresence(hang, { timeoutMs: 10, setTimeout: fast, clearTimeout: clearTimeout }), null, 'a slow server → unknown');
    assert.ok(PRESENCE_FETCH_TIMEOUT_MS >= 1000, 'the production timeout leaves room for a slow start');
  });

  test('the readout has a style shared by both screens', () => {
    assert.match(read('public/css/components.css'), /\.presence \{/, 'components.css styles .presence');
  });
});
