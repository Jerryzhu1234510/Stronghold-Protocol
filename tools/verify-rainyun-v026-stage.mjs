import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = fs.realpathSync(process.argv[2]);
assert.ok(root.startsWith('/opt/stronghold-rainyun/releases/'));
const load = file => import(pathToFileURL(path.join(root, file)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, '0.2.6');
const choices = JSON.parse(fs.readFileSync(path.join(root, 'data/choices.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
for (const mode of ['mode_single_hard', 'mode_single_abyss', 'mode_multi_hard', 'mode_multi_abyss']) {
  assert.deepEqual(config.modes[mode].spRounds, [3, 8, 10]);
  assert.deepEqual(choices.schedule[mode].spRounds, [3, 8, 10]);
  assert.deepEqual(Object.keys(choices.schedule[mode].rounds), ['3', '8', '10']);
  for (const round of [3, 8]) assert.deepEqual(choices.schedule[mode].rounds[round].families, [{ family: 'bounty', weight: 1 }]);
  assert.deepEqual(choices.schedule[mode].rounds[10].families,
    ['bounty', 'shop', 'tactic'].map(family => ({ family, weight: 1 })));
}
const { entrancePoseOffsetY, KALTS2_START_MAX_RISE } = await load('public/js/render/flightPose.js');
assert.equal(KALTS2_START_MAX_RISE, 0.35);
assert.ok(entrancePoseOffsetY({ spine: 'char_1052_kalts2' }, { current: 'Start', entry: { anims: { deploy: 'Start' } },
  spine: { skeleton: { findBone: () => ({ y: 634.58, data: { y: -50 } }) } } }, 100 / 320, 1 / 320) > 170);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/data/resource-cache.json'), 'utf8'));
assert.ok(manifest.count >= 20000);
assert.equal(Object.keys(manifest.entries).length, manifest.count);
let bytes = 0;
for (const [url, entry] of Object.entries(manifest.entries)) {
  const file = path.resolve(root, 'public', '.' + decodeURIComponent(url));
  assert.ok(file.startsWith(path.join(root, 'public') + path.sep));
  const body = fs.readFileSync(file);
  assert.equal(body.length, entry.bytes, url);
  assert.equal(createHash('sha256').update(body).digest('hex'), entry.hash, url);
  bytes += body.length;
}
assert.equal(bytes, manifest.totalBytes);
const { enemyEnabled } = await load('shared/customEnemyPolicy.js');
assert.equal(enemyEnabled('enemy_1512_mcmstr'), false);
const { startServer } = await load('server/index.js');
const server = await startServer({ host: '127.0.0.1', port: 0, matchWorkers: 2, quiet: true,
  assetIndex: { delayMs: 0 } });
let timer;
try {
  await Promise.race([server.assetIndex.whenReady(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Asset index startup timed out')), 60000);
  })]);
  clearTimeout(timer);
  const health = await (await fetch(server.url + '/healthz?traffic=1')).json();
  assert.equal(health.ok, true);
  assert.equal(health.app, '0.2.6');
  assert.equal(health.matchWorkers.length, 2);
  assert.ok(health.matchWorkers.every(worker => worker.healthy && worker.pending === 0));
  assert.equal(health.assetHashes.ready, true);
  assert.ok(health.assetHashes.files >= manifest.count);
  assert.equal(health.assetHashes.last.error, null);
  for (const file of ['/game.html', '/versus.html', '/data/assets.json', '/data/local-assets.json']) {
    const response = await fetch(server.url + file);
    assert.equal(response.status, 200, file);
    await response.arrayBuffer();
  }
  console.log(JSON.stringify({ passed: true, root, version: health.app, build: health.build,
    verifiedResources: manifest.count, resourceBytes: bytes, assetIndex: health.assetHashes,
    workers: health.matchWorkers }));
} finally {
  clearTimeout(timer);
  await server.close();
}
