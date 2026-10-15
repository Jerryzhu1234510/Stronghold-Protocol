import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { announcementPhase, announcementLifetime, parseAnnouncementCommand } from '../shared/announcement.js';
import { createAnnouncements } from '../server/announcements.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';

test('three complete right-to-left passes have five minutes of silence AFTER each pass', () => {
  const start = 100;
  const p = ms => announcementPhase(start, start + ms);
  assert.equal(p(0).phase, 'scroll');
  assert.equal(p(29_999).pass, 1);
  assert.equal(p(30_000).phase, 'gap');
  assert.equal(p(329_999).phase, 'gap');
  assert.deepEqual(p(330_000), { phase: 'scroll', pass: 2, offsetMs: 0, waitMs: 30_000 });
  assert.equal(p(360_000).phase, 'gap');
  assert.equal(p(659_999).phase, 'gap');
  assert.equal(p(660_000).pass, 3);
  assert.equal(p(689_999).phase, 'scroll');
  assert.equal(p(690_000).phase, 'done');
  assert.equal(announcementLifetime(), 690_000);
});

test('terminal text remains manual plain text; commands have no player API', () => {
  assert.deepEqual(parseAnnouncementCommand('announce 即将更新，请先结束对局'), { action: 'publish', text: '即将更新，请先结束对局' });
  assert.deepEqual(parseAnnouncementCommand('公告 <img src=x onerror=alert(1)>'), { action: 'publish', text: '<img src=x onerror=alert(1)>' });
  assert.equal(parseAnnouncementCommand('/announce clear').action, 'clear');
  assert.equal(parseAnnouncementCommand('announce status').action, 'status');
  assert.equal(parseAnnouncementCommand('announce help').action, 'help');
  assert.equal(parseAnnouncementCommand('announce ' + '文'.repeat(301)).action, 'error');
  assert.equal(parseAnnouncementCommand('rm -rf something'), null);
  assert.ok(validateC2S({ t: 'server.announcement', text: 'spoof' }));
});

test('publishing replaces the previous notice and expiry clears it without repeating network traffic', () => {
  let clock = 1000, next, cancelled = 0;
  const frames = [], logs = [];
  const session = { connected: true, ws: { readyState: 1, bufferedAmount: 0, send: data => frames.push(JSON.parse(data)) } };
  const a = createAnnouncements({ registry: { all: () => [session] }, now: () => clock, log: { info: s => logs.push(s) }, timers: {
    setTimeout(fn, ms) { next = { fn, ms }; return { unref() {} }; }, clearTimeout() { cancelled++; },
  } });
  a.command('announce 文字由我输入');
  assert.equal(frames[0].announcement.text, '文字由我输入');
  assert.equal(next.ms, 690_000);
  const firstId = frames[0].announcement.id;
  clock += 50;
  a.command('announce 第二条');
  assert.notEqual(frames[1].announcement.id, firstId);
  assert.equal(frames.length, 2, 'animation loops have no extra server messages');
  a.command('announce status');
  assert.ok(logs.at(-1).includes('第1遍'));
  clock += 690_000; next.fn();
  assert.equal(frames.at(-1).announcement, null);
  assert.ok(cancelled > 0);
  a.close();
});

test('real console stdin broadcasts to lobby and game clients, supports late joins and clear', async () => {
  const input = new PassThrough();
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, consoleInput: input });
  const clients = [];
  try {
    const connect = async name => {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
      await c.hello(name); await c.waitFor('server.announcement'); return c;
    };
    const a = await connect('大厅玩家'), b = await connect('房间玩家');
    await b.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    input.write('announce 即将更新，请先结束对局\n');
    const x = await a.waitFor('server.announcement'), y = await b.waitFor('server.announcement');
    assert.equal(x.announcement.id, y.announcement.id);
    assert.equal(x.announcement.text, '即将更新，请先结束对局');
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    await c.hello('后加入');
    assert.equal((await c.waitFor('server.announcement')).announcement.id, x.announcement.id);
    input.write('announce clear\n');
    for (const client of clients) assert.equal((await client.waitFor('server.announcement')).announcement, null);
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); input.destroy(); }
});
