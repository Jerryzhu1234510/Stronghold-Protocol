import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildRainyunResourceManifest, RAINYUN_CDN_CATALOG } from './rainyun-resource-cdn.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache');
await mkdir(cache, { recursive: true });
const stage = await mkdtemp(path.join(cache, 'rainyun-release-'));
// A runtime-only snapshot of the current workspace, not a migration of Tencent's live release.
for (const name of ['server', 'shared', 'data', 'public', 'packs', 'deploy/hot', 'deploy/rainyun',
  'package.json', 'package-lock.json', 'node_modules/ws', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md']) {
  await cp(path.join(root, name), path.join(stage, name), { recursive: true, filter: src =>
    !src.split(path.sep).some(part => part === 'dev' || part.startsWith('.') || /\.(pem|key)$/i.test(part)) });
}
for (const [source, target] of [['game.html', 'index.html'], ['server-lobby.html', 'server-lobby.html'], ['versus.html', 'versus.html']]) {
  await cp(path.join(root, 'public/js/browser', source), path.join(stage, 'public', target));
}
const manifest = await buildRainyunResourceManifest(path.join(stage, 'public'), path.join(stage, RAINYUN_CDN_CATALOG));
await mkdir(path.join(stage, 'public/data'), { recursive: true });
await writeFile(path.join(stage, 'public/data/resource-cache.json'), JSON.stringify(manifest));
const archive = stage + '.tgz';
if (process.argv.includes('--stage-only')) {
  console.log(JSON.stringify({ stage, resources: manifest.count, resourceBytes: manifest.totalBytes, cdn: manifest.cdn }));
  process.exit(0);
}
execFileSync('tar', ['-czf', archive, '-C', stage, '.'], { stdio: 'inherit' });
const hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const digest = hash.digest('hex');
await writeFile(archive + '.sha256', `${digest}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ stage, archive, sha256: digest, resources: manifest.count, resourceBytes: manifest.totalBytes, cdn: manifest.cdn }));
