import { TestClient } from '../test/helpers/wsClient.js';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/player-poll-deploy';
const notice = JSON.parse(await readFile(`${out}/poll-announcement.json`, 'utf8'));
const report = { clients: [] };
try {
  for (const generation of notice.generations) {
    const client = await TestClient.connect(`wss://weishuxieyi.icu/_build/${generation}/ws`,
      { timeout: 15000, wsOptions: { origin: 'https://weishuxieyi.icu' } });
    try {
      await client.hello('投票公告验收');
      const frame = await client.waitFor('server.announcement', () => true, 10000);
      assert.equal(frame.announcement?.text, notice.text);
      report.clients.push({ generation, announcement: frame.announcement });
    } finally { await client.close(); }
  }
  report.pass = true;
  console.log(JSON.stringify({ pass: true, generations: report.clients.length, deadline: '2026-10-10 22:00 Asia/Shanghai' }));
} catch (error) { report.error = error.stack; throw error; }
finally { await writeFile(`${out}/announcement-verification.json`, JSON.stringify(report, null, 2)); }
