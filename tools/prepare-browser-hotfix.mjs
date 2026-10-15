import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pinText } from '../server/hot/gateway.mjs';

const generation = process.argv[2];
if (!/^[a-f0-9]{12}-\d+$/.test(generation || '')) throw new Error('Pass the current generation');
const names = ['main.js', 'versus.js', 'compat.js', 'sim.js', 'game.html', 'versus.html', 'server-lobby.html'];
const files = new Map(await Promise.all(names.map(async name => [name, await readFile('public/js/browser/' + name, 'utf8')])));
const hash = createHash('sha256').update([...files.values()].join('\n')).digest('hex').slice(0, 12);
const out = 'D:/Codex/2026-10-10/a/outputs/browser-access/hotfix-' + hash;
const alias = '/js/browser/' + hash;
await mkdir(out + alias, { recursive: true });
for (const [name, source] of files) {
  const html = name.endsWith('.html');
  const original = name === 'server-lobby.html' ? '/' : name === 'game.html' ? '/game.html' : '/versus.html';
  const body = pinText(source.replaceAll('/js/browser/', alias + '/'), html ? 'text/html' : 'application/javascript', html ? original : alias + '/' + name, generation);
  const target = out + (html ? '/' : alias + '/') + name;
  await writeFile(target, body);
  if (!html) await writeFile(target + '.gz', gzipSync(body));
}
await writeFile(out + '/source-hashes.json', await readFile('public/js/browser/source-hashes.json'));
await writeFile('D:/Codex/2026-10-10/a/outputs/browser-access/hotfix.json', JSON.stringify({ generation, hash, out, alias }, null, 2));
console.log(JSON.stringify({ generation, hash, out, alias }));
