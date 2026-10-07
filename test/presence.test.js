// Presence counters (在线人数 / 房间内人数) — a remake addition (DESIGN §8.1). Boots a real server in-process on a random
// port and drives WebSocket clients: the frame a fresh session gets right after `welcome`, the push when another player
// connects / enters a room / leaves it / drops, the change guard, and `presenceTickMs: 0` (the hello frame only).
//
// The tick is overridden per server so a test never waits for the production interval.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

/** Run `fn` against a FRESH server (the session registry is per server) and close the clients it opened. */
async function withServer(over, fn) {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, presenceTickMs: 30, ...over });
  const ctx = { wsUrl: `ws://127.0.0.1:${srv.port}/ws`, httpUrl: `http://127.0.0.1:${srv.port}`, opened: [] };
  const player = async (name) => {
    const c = await TestClient.connect(ctx.wsUrl);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.token = w.token;
    ctx.opened.push(c);
    return c;
  };
  try {
    return await fn(player, ctx);
  } finally {
    await Promise.all(ctx.opened.map((c) => c.terminate().catch(() => {})));
    await srv.close();
  }
}

describe('presence counters (在线人数)', () => {
  test('a fresh session is answered at once; online / in-room changes are pushed', async () => {
    await withServer({}, async (player, ctx) => {
      const a = await player('A');
      const first = await a.waitFor('presence');
      assert.ok(first.online >= 1, `online ${first.online}`);
      assert.equal(first.inRoom, 0, 'nobody is in a room yet');

      const b = await player('B');
      const two = await a.waitFor('presence', (m) => m.online >= 2);
      assert.equal(two.online, 2, 'the second session is counted');
      assert.equal(two.inRoom, 0);

      await b.request({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY' });
      const inRoom = await a.waitFor('presence', (m) => m.inRoom >= 1);
      assert.equal(inRoom.inRoom, 1, 'the room holds one human');
      assert.equal(inRoom.online, 2, 'entering a room does not change the online count');

      // quiet: the same numbers are never re-sent
      await a.expectNone('presence', () => true, 120);

      // leaving the room takes the in-room count back down (the host was its last human, so it closes)
      await b.request({ t: 'room.leave' });
      const left = await a.waitFor('presence', (m) => m.inRoom === 0);
      assert.equal(left.online, 2, 'the session is still online');

      // a dropped socket stops counting as online (its session stays resumable for the reconnect window)
      await b.terminate();
      const dropped = await a.waitFor('presence', (m) => m.online <= 1);
      assert.equal(dropped.online, 1);
      assert.equal(dropped.inRoom, 0);

      // the same counters are on /healthz: a page without a session (the title screen) reads them from there
      const health = await (await fetch(`${ctx.httpUrl}/healthz`)).json();
      assert.equal(health.online, dropped.online, 'healthz.online matches the frame');
      assert.equal(health.inRoom, dropped.inRoom, 'healthz.inRoom matches the frame');
    });
  });

  test('a page that has not entered yet still counts as online (a socket without a session)', async () => {
    await withServer({}, async (player, ctx) => {
      const lurker = await TestClient.connect(ctx.wsUrl); // connected, never said hello: the title screen
      ctx.opened.push(lurker);
      const a = await player('A');
      const first = await a.waitFor('presence');
      assert.equal(first.online, 2, 'the hello-less visitor counts with the player');
      const health = await (await fetch(`${ctx.httpUrl}/healthz`)).json();
      assert.equal(health.online, 2, 'the same count on /healthz');
      assert.equal(health.sessions, 1, 'only the player who said hello has a session');
      await lurker.terminate();
      const after = await a.waitFor('presence', (m) => m.online <= 1);
      assert.equal(after.online, 1, 'the visitor closing the page is reflected');
    });
  });

  test('a spectator counts as in-room without being a player', async () => {
    await withServer({}, async (player) => {
      const host = await player('HOST');
      await host.waitFor('presence');
      await host.request({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY' });
      const created = await host.waitFor('presence', (m) => m.inRoom >= 1);
      const code = (await host.waitFor('room.state')).code;
      assert.ok(created.inRoom >= 1);

      const watcher = await player('WATCH');
      await watcher.waitFor('presence');
      await watcher.request({ t: 'room.spectate', code });
      const seen = await host.waitFor('presence', (m) => m.inRoom >= 2);
      assert.equal(seen.inRoom, 2, 'the spectator seat is counted with the players');
    });
  });

  test('presenceTickMs 0 sends the hello frame only', async () => {
    await withServer({ presenceTickMs: 0 }, async (player) => {
      const a = await player('A');
      assert.ok((await a.waitFor('presence')).online >= 1, 'the hello frame still arrives');
      const b = await player('B');
      await b.waitFor('presence');
      await a.expectNone('presence', () => true, 100); // no clock ⇒ no updates
    });
  });
});
