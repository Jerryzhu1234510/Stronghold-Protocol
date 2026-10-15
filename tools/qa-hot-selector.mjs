import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const out = 'D:/Codex/2026-10-10/a/outputs/r27-deploy/selector-regression.json';
const html = readFileSync(new URL('../public/server-lobby.html', import.meta.url));
const newer = { ok: true, onlinePlayers: 3, roomsOnline: 2, matchesOnline: 1, waitingRooms: 1 };
const older = { ok: true, onlinePlayers: 12, roomsOnline: 7, matchesOnline: 6, waitingRooms: 1 };
const friendEndpoint = 'https://weishuxieyiwangye.cn:8443/lobby/status.json';
const friend = { state: 'online', online: 114, rooms: 58, matches: 54, waiting: 5 };
let mode = 'merged';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  let body = newer;
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  if (path === '/healthz' && mode === 'own-down') { res.writeHead(503); res.end(); return; }
  if (path === '/__hot/status') {
    if (mode === 'direct') { res.writeHead(404); res.end(); return; }
    body = { versions: [{ id: 'old-1', healthy: mode !== 'retired' }, { id: 'new-2', healthy: true }, { id: 'dead-0', healthy: false }] };
  } else if (path === '/_build/old-1/healthz') body = older;
  else if (path === '/_build/dead-0/healthz') throw new Error('dead release must not be queried');
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const report = { passed: false, cases: [] };
try {
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url() === friendEndpoint) {
      const body = mode === 'malformed-friend' ? '{' : JSON.stringify({ nodes: {
        ...(mode === 'missing-friend' ? {} : { '8443': mode === 'partial-friend' ? { ...friend, partial: true } : friend }),
        icu: { state: 'online', online: 9999, rooms: 9999, matches: 9999, waiting: 9999 }
      } });
      return request.respond({ status: mode === 'friend-down' ? 503 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    }
    return request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const check = async (scenario, expected) => {
    await page.waitForFunction(expected => document.querySelector('#online-icu').textContent === String(expected[0]) && !document.querySelector('#refresh-status').disabled, {}, expected);
    const actual = await page.evaluate(() => ['online','rooms','matches','waiting'].map(key => Number(document.querySelector('#' + key + '-icu').textContent)));
    assert.deepEqual(actual, expected);
    report.cases.push({ scenario, actual });
  };
  await check('both healthy releases', [15,9,7,2]);
  const checkFriend = async (expected, state = '在线') => {
    const actual = await page.evaluate(() => ['online','rooms','matches','waiting'].map(key => document.querySelector('#' + key + '-8443').textContent));
    assert.deepEqual(actual, expected.map(String));
    assert.equal(await page.$eval('#state-8443', el => el.textContent), state);
    assert.equal(await page.$eval('[data-enter="8443"]', el => el.href), 'https://weishuxieyiwangye.cn:8443/');
  };
  await checkFriend([114,58,54,5]);
  assert.equal(await page.$eval('#total-online', el => el.textContent), '129');
  await new Promise(resolve => setTimeout(resolve, 5100));
  mode = 'retired'; await page.click('#refresh-status'); await check('retired release excluded', [3,2,1,1]);
  await new Promise(resolve => setTimeout(resolve, 5100));
  mode = 'direct';
  const fallback = page.waitForResponse(response => response.url() === origin + '/__hot/status' && response.status() === 404);
  await page.click('#refresh-status'); await fallback; await check('direct server fallback', [3,2,1,1]);
  for (const scenario of ['friend-down', 'missing-friend', 'malformed-friend', 'partial-friend', 'own-down']) {
    mode = scenario;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#refresh-status').disabled);
    if (scenario === 'own-down') {
      assert.equal(await page.$eval('#online-icu', el => el.textContent), '—');
      await checkFriend([114,58,54,5]);
    } else {
      await check(scenario, [15,9,7,2]);
      await checkFriend(scenario === 'partial-friend' ? [114,58,54,5] : ['—','—','—','—'], scenario === 'partial-friend' ? '在线' : '状态未知');
      if (scenario === 'partial-friend') assert.match(await page.$eval('#info-8443', el => el.textContent), /部分版本/);
    }
    report.cases.push({ scenario, isolated: true });
  }
  report.passed = true;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  writeFileSync(out, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
