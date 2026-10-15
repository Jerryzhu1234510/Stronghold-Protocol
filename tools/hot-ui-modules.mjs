import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['/js/render/projection.js', '/js/ui/fieldHost.js', '/js/ui/releaseNotes.js',
  '/js/render/app.js', '/js/render/adaptiveLoad.js', '/js/battle/runner.js']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Only the uncached HTML entry changes. Previously published modules and all match workers stay untouched.
export async function applyUiModules({ releaseRoot, modules, expectedCameraSha256, expectedModuleSha256 = {} }) {
  const root = await realpath(releaseRoot), pub = path.join(root, 'public');
  const originalCamera = await readFile(path.join(pub, 'js/render/projection.js'));
  if (hash(originalCamera) !== expectedCameraSha256) throw new Error('Unexpected base camera; nothing changed');
  const index = path.join(pub, 'index.html'), original = await readFile(index, 'utf8');
  const matches = [...original.matchAll(/(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/g)];
  if (matches.length !== 1) throw new Error('Expected exactly one import map');
  const map = JSON.parse(matches[0][2]);
  if (!map.imports || typeof map.imports !== 'object') throw new Error('Missing imports');
  const names = Object.keys(modules).sort();
  if (!names.length || names.some(name => !allowed.has(name))) throw new Error('Only approved client camera, HUD, rendering and pacing modules may be patched');
  // app.js and its new relative dependency must activate together (the original release lacks this helper).
  if (names.includes('/js/render/app.js') !== names.includes('/js/render/adaptiveLoad.js')) throw new Error('Rendering patch requires both app.js and adaptiveLoad.js');
  for (const [name, expected] of Object.entries(expectedModuleSha256)) {
    if (!allowed.has(name) || hash(await readFile(path.join(pub, name.slice(1)))) !== expected) throw new Error('Unexpected base module: ' + name);
  }
  const written = {};
  for (const name of names) {
    const bytes = modules[name];
    const digest = hash(bytes), alias = name.replace(/\.js$/, `.ui-${digest.slice(0, 16)}.js`);
    const file = path.join(pub, alias.slice(1));
    try { await writeFile(file, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || hash(await readFile(file)) !== digest) throw error; }
    map.imports[name] = alias; written[name] = { alias, sha256: digest };
  }
  const revision = 'ui-' + hash(JSON.stringify(written)).slice(0, 16);
  let html = original.replace(matches[0][0], matches[0][1] + '\n' + JSON.stringify(map, null, 2) + '\n' + matches[0][3]);
  html = html.replace(/\s*<meta name="sp-ui-revision" content="[^"]*"\s*\/>/g, '');
  html = html.replace('</head>', `<meta name="sp-ui-revision" content="${revision}" />\n</head>`);
  await mkdir(path.join(root, '.ui-backups'), { recursive: true });
  const backup = path.join(root, '.ui-backups', `index-before-${revision}.html`);
  try { await writeFile(backup, original, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const temp = index + '.ui-patch.tmp';
  await writeFile(temp, html);
  if (await readFile(index, 'utf8') !== original) throw new Error('Entry changed concurrently; patch not activated');
  await rename(temp, index);
  return { revision, modules: written, backup, backendRestarted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [releaseRoot, payload] = process.argv.slice(2);
  const manifest = JSON.parse(await readFile(path.join(payload, 'ui-manifest.json'), 'utf8'));
  const modules = {};
  for (const [name, file] of Object.entries(manifest.files)) modules[name] = await readFile(path.join(payload, file));
  console.log(JSON.stringify(await applyUiModules({ releaseRoot, modules, expectedCameraSha256: manifest.expectedCameraSha256, expectedModuleSha256: manifest.expectedModuleSha256 })));
}
