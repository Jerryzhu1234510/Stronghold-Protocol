import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway as startAccountGateway, pinText } from '../server/hot/gateway.mjs';
import { TestClient } from './helpers/wsClient.js';
import { getData } from '../server/data.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fixture;
const accountFixtures=[];
async function startGateway(options){
  const parent=path.resolve(root,'../test-output');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'account-hot-test-'));accountFixtures.push(directory);
  return startAccountGateway({...options,accountFile:path.join(directory,'accounts.json'),allowCreateAccounts:true});
}
before(async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  fixture = await mkdtemp(path.join(root, '.cache/hot-test-'));
  for (const dir of ['server', 'shared', 'data']) await cp(path.join(root, dir), path.join(fixture, dir), { recursive: true });
  await cp(path.join(root,'tools/assets'),path.join(fixture,'tools/assets'),{recursive:true});
  await mkdir(path.join(fixture, 'public/js'), { recursive: true });
  await writeFile(path.join(fixture, 'public/index.html'), '<html><head></head><body>NEW RELEASE<script type="module" src="/js/probe.js"></script></body></html>');
  for (const entry of ['game.html', 'versus.html', 'training.html']) await cp(path.join(fixture, 'public/index.html'), path.join(fixture, 'public', entry));
  await writeFile(path.join(fixture, 'public/js/probe.js'), "import { MAX_SEATS } from '../../shared/constants.js'; export const generation='new';");
  await cp(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
  for(const name of ['MANIFEST.json','HOT-RELEASE.json'])await cp(path.join(root,name),path.join(fixture,name));
});
after(async () => { for(const directory of accountFixtures){if(path.dirname(directory)!==path.resolve(root,'../test-output')||!path.basename(directory).startsWith('account-hot-test-'))throw Error('Unsafe fixture cleanup');await rm(directory,{recursive:true,force:true});} if (fixture?.startsWith(path.join(root, '.cache/hot-test-'))) await rm(fixture, { recursive: true, force: true }); });

test('module imports, CSS URLs, manifests and HTML stay in their own generation', () => {
  assert.match(pinText("import x from '../../../shared/a.js'; import('/sim/a.js'); const base='/sim/';", 'text/javascript', '/js/screens/a.js', 'old'), /from '\/_build\/old\/shared\/a.js'/);
  assert.match(pinText('a{background:url(/assets/a.png)}', 'text/css', '/css/a.css', 'old'), /\/_build\/old\/assets\/a.png/);
  assert.equal(JSON.parse(pinText('{"avatar":"/assets/a.png"}', 'application/json', '/data/assets.json', 'old')).avatar, '/_build/old/assets/a.png');
  assert.match(pinText('<head></head><script src="/js/a.js"></script>', 'text/html', '/', 'old'), /window.__SP_GENERATION="old"/);
});

test('served path parser keeps canonical roots so hashed model files can find CDN directory shards', async () => {
  const source = await readFile(path.join(root, 'shared/assetPaths.js'), 'utf8');
  const served = pinText(source, 'text/javascript', '/shared/assetPaths.js', 'new-release');
  const parser = await import('data:text/javascript;base64,' + Buffer.from(served).toString('base64'));
  assert.deepEqual(parser.HASHED_ROOTS, ['/assets/', '/fonts/', '/media/']);
  for (const root of parser.HASHED_ROOTS) {
    assert.deepEqual(parser.splitHashedPath(root + '~0123456789abcdef/model.skel'), { hash: '0123456789abcdef', path: root + 'model.skel' });
  }
});

test('rewritten scripts have one immutable cache header on both first and cached responses', async () => {
  const gateway = await startGateway({ releaseRoot: fixture, port: 0, log: { info() {} } });
  const url = `http://127.0.0.1:${gateway.port}/_build/${gateway.active.id}/js/probe.js`;
  try {
    for (const encoding of ['gzip', 'identity', 'gzip']) {
      const response = await new Promise((resolve, reject) => {
        http.get(url, { headers: { 'accept-encoding': encoding } }, res => {
          const chunks = []; res.on('data', x => chunks.push(x));
          res.on('end', () => resolve({ raw: res.rawHeaders, headers: res.headers, bytes: Buffer.concat(chunks).length }));
        }).on('error', reject);
      });
      assert.equal(response.raw.filter((x, i) => i % 2 === 0 && x.toLowerCase() === 'cache-control').length, 1);
      assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.equal(response.raw.filter((x, i) => i % 2 === 0 && x.toLowerCase() === 'vary').length, 1);
      assert.equal(Number(response.headers['content-length']), response.bytes);
    }
  } finally { await gateway.close(); }
});

test('entry documents really navigate into worker scope and retain queries without redirecting pinned pages or APIs', async () => {
  const gateway = await startGateway({ releaseRoot: fixture, port: 0, log: { info() {} } });
  const origin = `http://127.0.0.1:${gateway.port}`;
  try {
    for (const entry of ['/', '/index.html', '/game.html', '/versus.html', '/training.html']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + entry + '?embedded=1&room=ABCD', { method, redirect: 'manual' });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const target = `/_build/${gateway.active.id}${entry}?embedded=1&room=ABCD`;
        assert.equal(response.headers.get('location'), target);
        const pinned = await fetch(origin + target, { method, redirect: 'manual' });
        assert.equal(pinned.status, 200);
        assert.equal(pinned.headers.get('location'), null);
        await pinned.arrayBuffer();
      }
    }
    const health = await fetch(origin + '/healthz', { redirect: 'manual' });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('location'), null);
    await health.arrayBuffer();
  } finally { await gateway.close(); }
});

test('pinned game tables reuse HTTP cache validators without caching live APIs or unversioned data', async () => {
  const gateway = await startGateway({ releaseRoot: fixture, port: 0, log: { info() {} } });
  const origin = `http://127.0.0.1:${gateway.port}`;
  const pinned = origin + `/_build/${gateway.active.id}`;
  try {
    const first = await fetch(pinned + '/data/chess.json');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const etag = first.headers.get('etag');
    assert.ok(etag);
    await first.arrayBuffer();
    for (const method of ['GET', 'HEAD']) {
      const cached = await fetch(pinned + '/data/chess.json', { method, headers: { 'if-none-match': etag } });
      assert.equal(cached.status, 304, `${method} must not retransmit a 1.7 MB table`);
      assert.equal((await cached.arrayBuffer()).byteLength, 0);
      assert.equal(cached.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    }
    const dev = await fetch(origin + '/data/chess.json', { method: 'HEAD', redirect: 'manual' });
    assert.equal(dev.status, 302);
    assert.equal(dev.headers.get('cache-control'), 'no-store');
    assert.equal(dev.headers.get('location'), `/_build/${gateway.active.id}/data/chess.json`);
    const health = await fetch(pinned + '/healthz');
    assert.equal(health.headers.get('cache-control'), 'no-store');
    await health.arrayBuffer();
  } finally { await gateway.close(); }
});

test('a running match survives activation, reconnects to its old worker, then finishes; new clients use the new worker', async () => {
  const gateway = await startGateway({ releaseRoot: root, port: 0, workerEnv: { SP_HOT_TEST_STUB: '1' }, log: { info() {} } });
  const clients = [];
  const origin = `http://127.0.0.1:${gateway.port}`;
  async function player(id, name, token) {
    const c = await TestClient.connect(`ws://127.0.0.1:${gateway.port}/_build/${id}/ws`); clients.push(c);
    const w = await c.hello(name, token); c.id = w.playerId; c.token = w.token; return c;
  }
  try {
    const old = gateway.active.id;
    const a = await player(old, 'old-host');
    assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const room = await a.waitFor('room.state');
    const b = await player(old, 'old-guest');
    assert.equal((await b.request({ t: 'room.join', code: room.code })).t, 'ok');
    assert.equal((await b.request({ t: 'room.ready', ready: true })).t, 'ok');
    assert.equal((await a.request({ t: 'room.start' })).t, 'ok');
    await a.waitFor('m.public');
    assert.equal((await a.request({ t: 'g.infoReady' })).t, 'ok');
    const next = await gateway.activate(fixture);
    assert.notEqual(next.id, old);
    assert.equal(a.isOpen, true, 'existing websocket is not replaced');
    assert.equal((await fetch(origin + `/_build/${old}/healthz`).then(r => r.json())).matches, 1);
    await assert.rejects(gateway.retire(old), /仍有对局/);
    await b.terminate();
    const resumed = await player(old, 'old-guest', b.token);
    assert.equal(resumed.id, b.id, 'old identity and room restored after deploy');
    assert.equal((await resumed.request({ t: 'g.infoReady' })).t, 'ok');
    await a.waitFor('m.result');
    assert.equal((await a.request({ t: 'room.start' })).t, 'error', 'draining version cannot start another round');
    const fresh = await player(next.id, 'new-client');
    assert.equal((await fresh.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
    assert.equal((await fresh.request({ t: 'room.start' })).t, 'ok');
    const latest = await fetch(origin + '/__hot/status').then(r => r.json());
    assert.equal(latest.build, next.id);
    const oldPage = await fetch(origin + `/_build/${old}/`).then(r => r.text());
    const newPage = await fetch(origin + '/').then(r => r.text());
    assert.match(oldPage, new RegExp(`/_build/${old}/__generation.js`));
    assert.match(newPage, /NEW RELEASE/);
    const module = await fetch(origin + `/_build/${next.id}/js/probe.js`).then(r => r.text());
    assert.match(module, /from '\.\.\/\.\.\/shared\/constants.js'/, 'v0.3 modules retain verified bytes');
    const prior = gateway.active.id;
    await assert.rejects(gateway.activate(path.join(fixture, 'missing')));
    await assert.rejects(gateway.activate(fixture), /独立目录/);
    assert.equal(gateway.active.id, prior, 'failed activation leaves active version unchanged');
  } finally { await Promise.all(clients.map(c => c.terminate().catch(() => {}))); await gateway.close(); }
});

test('production Match accepts gameplay after activation without restarting its room', async () => {
  const gateway = await startGateway({ releaseRoot: root, port: 0, log: { info() {} } });
  let c;
  try {
    const old = gateway.active.id;
    c = await TestClient.connect(`ws://127.0.0.1:${gateway.port}/_build/${old}/ws`);
    await c.hello('real-match');
    assert.equal((await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
    assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
    await c.waitFor('m.public', m => m.phase === 'INFO_CHECK');
    await gateway.activate(fixture);
    assert.equal((await c.request({ t: 'g.infoReady' })).t, 'ok');
    assert.equal(c.isOpen, true);
    const health = await fetch(`http://127.0.0.1:${gateway.port}/_build/${old}/healthz`).then(r => r.json());
    assert.equal(health.matches, 1);
    assert.ok(health.uptimeSec >= 0);
  } finally { await c?.terminate().catch(() => {}); await gateway.close(); }
});

test('a pending prep vote survives hot activation and reconnection to the old worker', async () => {
  const gateway = await startGateway({ releaseRoot: root, port: 0, log: { info() {} } });
  const clients = [];
  const old = gateway.active.id;
  async function player(id, token) {
    const c = await TestClient.connect(`ws://127.0.0.1:${gateway.port}/_build/${id}/ws`); clients.push(c);
    const w = await c.hello('hotvote', token); c.id = w.playerId; c.token = w.token; return c;
  }
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok', msg.t);
  try {
    const a = await player(old), b = await player(old);
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const room = await a.waitFor('room.state');
    await ok(b, { t: 'room.join', code: room.code });
    await ok(b, { t: 'room.ready', ready: true });
    await ok(a, { t: 'room.start' });
    await ok(a, { t: 'g.infoReady' }); await ok(b, { t: 'g.infoReady' });
    const pending = new Map([[a.id, a], [b.id, b]]);
    while (pending.size) {
      const pub = await a.waitFor('m.public', p => p.phase === 'BAND_DRAFT' && pending.has(p.draft?.turn), 10000);
      const taken = new Set(Object.values(pub.draft.picks));
      const band = Object.values(getData().bands).find(x => (!x.modeTypeList || x.modeTypeList.includes('MULTI')) && !taken.has(x.bandId));
      await ok(pending.get(pub.draft.turn), { t: 'g.band', bandId: band.bandId }); pending.delete(pub.draft.turn);
    }
    const prep = await a.waitFor('m.public', p => p.phase === 'PREP', 10000);
    await ok(a, { t: 'g.prepExtend', seconds: 30 });
    const ballot = await b.waitFor('m.public', p => p.prepExtension?.vote?.status === 'pending');
    const oldPid = gateway.releases.get(old).child.pid;
    const next = await gateway.activate(fixture);
    assert.equal(gateway.releases.get(old).child.pid, oldPid);
    assert.equal(gateway.releases.get(old).draining, true);
    assert.equal(a.isOpen, true);
    await b.terminate();
    const resumed = await player(old, b.token);
    assert.equal(resumed.id, b.id);
    await resumed.waitFor('m.public', p => p.prepExtension?.vote?.id === ballot.prepExtension.vote.id);
    await ok(resumed, { t: 'g.prepVote', voteId: ballot.prepExtension.vote.id, agree: true });
    const passed = await a.waitFor('m.public', p => p.prepExtension?.vote?.status === 'passed');
    assert.equal(passed.deadline, prep.deadline + 30000);
    const fresh = await player(next.id);
    await ok(fresh, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal((await fetch(`http://127.0.0.1:${gateway.port}/_build/${old}/healthz`).then(r => r.json())).matches, 1);
    await ok(a, { t: 'g.ready', ready: true }); await ok(resumed, { t: 'g.ready', ready: true });
    await a.waitFor('b.start', b => b.authoritative, 3000);
  } finally { await Promise.all(clients.map(c => c.terminate().catch(() => {}))); await gateway.close(); }
});

test('two battle isolates retain room affinity across hot activation and start real combat', async () => {
  const gateway = await startGateway({ releaseRoot: root, port: 0, workerEnv: { SP_MATCH_WORKERS: '2' }, log: { info() {} } });
  const clients = [], old = gateway.active.id;
  const origin = `http://127.0.0.1:${gateway.port}`;
  const health = id => fetch(origin + `/_build/${id}/healthz`).then(r => r.json());
  async function player(id, token) {
    const c = await TestClient.connect(`ws://127.0.0.1:${gateway.port}/_build/${id}/ws`); clients.push(c);
    c.welcome = await c.hello('partition', token); return c;
  }
  const ok = async (c, msg) => {
    const reply = await c.request(msg); assert.equal(reply.t, 'ok', JSON.stringify(reply));
  };
  try {
    const a = await player(old), b = await player(old);
    for (const c of [a, b]) {
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY' });
      await ok(c, { t: 'room.start' });
      await c.waitFor('m.public', p => p.phase === 'INFO_CHECK');
    }
    const initial = await health(old);
    assert.deepEqual(initial.matchWorkers.map(w => w.matches), [1, 1]);
    const next = await gateway.activate(fixture);
    await b.terminate();
    const resumed = await player(old, b.welcome.token);
    assert.equal(resumed.welcome.playerId, b.welcome.playerId);
    await resumed.waitFor('m.public', p => p.phase === 'INFO_CHECK');
    const restored = await health(old);
    assert.deepEqual(restored.matchWorkers.map(w => w.threadId), initial.matchWorkers.map(w => w.threadId));
    assert.deepEqual(restored.matchWorkers.map(w => w.matches), [1, 1]);
    const fresh = await player(next.id);
    await ok(fresh, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    await ok(fresh, { t: 'room.start' });
    await fresh.waitFor('m.public', p => p.phase === 'INFO_CHECK');
    assert.deepEqual((await health(next.id)).matchWorkers.map(w => w.matches), [1, 0]);
    await ok(a, { t: 'g.infoReady' });
    await a.waitFor('m.public', p => p.phase === 'BAND_DRAFT');
    await ok(a, { t: 'g.band', bandId: 'band_sarkazb' });
    await a.waitFor('m.public', p => p.phase === 'PREP', 10000);
    await ok(a, { t: 'g.ready', ready: true });
    const battle = await a.waitFor('b.start', p => p.authoritative, 10000);
    assert.equal(battle.spec.kind, 'normal');
    assert.equal(battle.fieldId, `n:${a.welcome.playerId}`);
    assert.equal(a.isOpen, true);
  } finally { await Promise.all(clients.map(c => c.terminate().catch(() => {}))); await gateway.close(); }
});
