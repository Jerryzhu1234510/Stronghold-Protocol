import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const stage = path.resolve(process.argv[2]);
const previousGeneration = process.argv[3] || (await (await fetch('https://64-90-4-56.sslip.io/__hot/status',
  { signal: AbortSignal.timeout(15000), cache: 'no-store' })).json()).build;
assert.match(previousGeneration, /^[a-zA-Z0-9_-]{1,64}$/);
const response = await fetch('https://64-90-4-56.sslip.io/_build/' + previousGeneration + '/data/resource-cache.json',
  { signal: AbortSignal.timeout(60000), cache: 'no-store' });
assert.equal(response.status, 200);
const previous = await response.json();
const next = JSON.parse(await readFile(path.join(stage, 'public/data/resource-cache.json'), 'utf8'));
assert.ok(previous.count >= 20000 && next.count >= 20000);
const delta = await mkdtemp(path.join(path.dirname(stage), 'rainyun-delta-'));
await cp(stage, delta, { recursive: true, filter: source => {
  const relative = path.relative(stage, source).split(path.sep).join('/');
  return !['public/assets', 'public/fonts'].some(root => relative === root || relative.startsWith(root + '/'));
} });
let changedResources = 0, changedBytes = 0, reusedResources = 0;
for (const [url, entry] of Object.entries(next.entries)) {
  assert.ok(url.startsWith('/assets/') || url.startsWith('/fonts/'));
  const old = previous.entries[url];
  if (old?.hash === entry.hash && old.bytes === entry.bytes) { reusedResources++; continue; }
  const relative = 'public' + decodeURIComponent(url);
  const source = path.resolve(stage, relative), target = path.resolve(delta, relative);
  assert.ok(source.startsWith(stage + path.sep) && target.startsWith(delta + path.sep));
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
  changedResources++; changedBytes += entry.bytes;
}
const archive = delta + '.tgz';
execFileSync('tar', ['-czf', archive, '-C', delta, '.'], { stdio: 'inherit' });
const hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const report = { delta, archive, sha256: hash.digest('hex'), archiveBytes: (await stat(archive)).size,
  previousGeneration, reusedResources, changedResources, changedBytes };
await writeFile(path.join(path.dirname(stage), 'rainyun-v026-delta.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
