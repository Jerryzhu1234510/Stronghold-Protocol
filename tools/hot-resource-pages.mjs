import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['/js/resources/client.js', '/js/resources/manifest.js', '/js/versus/app.js',
  '/js/browser/main.js', '/js/browser/versus.js', '/js/browser/training.js']);
const preloadGroup = ['/js/resources/preload.js', '/js/resources/worker.js', '/js/ui/resourcePreload.js', '/js/ui/settings.js'];
const pages = ['index.html', 'versus.html', 'training.html', 'js/browser/game.html', 'js/browser/versus.html'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const flag = "<script>window.__SP_LOCAL_RESOURCES_REQUIRED = location.hostname === 'weishuxieyiwangye.cn';</script>";

// Publish new addresses, then change only no-store HTML. Existing games, workers,
// account authority and immutable module addresses are never replaced/restarted.
export async function applyResourcePages({ releaseRoot, modules, expected }) {
  const root = await realpath(releaseRoot), pub = path.join(root, 'public');
  const names = Object.keys(modules).sort();
  const complete = [...allowed, ...(names.length === allowed.size ? [] : preloadGroup)];
  if (names.length !== complete.length || names.some(name => !complete.includes(name))) throw Error('Expected the complete approved resource module group');
  const originals = {};
  for (const relative of [...names.map(n => n.slice(1)), ...pages]) {
    const bytes = await readFile(path.join(pub, relative));
    if (!expected[relative] || digest(bytes) !== expected[relative]) throw Error('Unexpected published base: ' + relative);
    originals[relative] = bytes;
  }
  const published = {};
  for (const name of names) {
    const bytes = modules[name], sha256 = digest(bytes);
    // A root-level worker can control the whole pinned release without changing
    // headers in the live backend. Its payload preserves the original URL bases.
    const alias = name === '/js/resources/worker.js' ? `/worker.local-${sha256.slice(0,16)}.js`
      : name.replace(/\.js$/, `.local-${sha256.slice(0, 16)}.js`);
    published[name] = { alias, sha256 };
  }
  const revision = 'local-' + digest(JSON.stringify(published)).slice(0, 16), html = {};
  for (const page of pages) {
    let text = originals[page].toString('utf8');
    if (!/<head\b[^>]*>/i.test(text)) throw Error('Missing HTML head: ' + page);
    if (!text.includes('__SP_LOCAL_RESOURCES_REQUIRED')) text = text.replace(/<head\b[^>]*>/i, match => match + '\n' + flag);
    const maps = [...text.matchAll(/(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/g)];
    if (maps.length > 1) throw Error('Multiple import maps: ' + page);
    const map = maps.length ? JSON.parse(maps[0][2]) : { imports: {} };
    if (!map.imports || typeof map.imports !== 'object') throw Error('Invalid import map: ' + page);
    for (const name of names) map.imports[name] = published[name].alias;
    const markup = '<script type="importmap">' + JSON.stringify(map) + '</script>';
    text = maps.length ? text.replace(maps[0][0], markup) : text.replace(/<head\b[^>]*>/i, match => match + '\n' + markup);
    for (const name of names) text = text.replaceAll('src="' + name + '"', 'src="' + published[name].alias + '"');
    html[page] = text.replace('</head>', `<meta name="sp-local-resource-revision" content="${revision}">\n</head>`);
  }
  // Validate every entry before writing aliases or switching any page.
  for (const [name, bytes] of Object.entries(modules)) {
    const file = path.join(pub, published[name].alias.slice(1));
    try { await writeFile(file, bytes, { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST' || digest(await readFile(file)) !== digest(bytes)) throw e; }
  }
  const backup = path.join(root, '.resource-backups', revision);
  await mkdir(backup, { recursive: true });
  for (const page of pages) {
    const file = path.join(backup, page); await mkdir(path.dirname(file), { recursive: true });
    try { await writeFile(file, originals[page], { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST' || digest(await readFile(file)) !== digest(originals[page])) throw e; }
    await writeFile(path.join(pub, page) + '.' + revision + '.tmp', html[page]);
  }
  const activated = [];
  try {
    for (const page of pages) {
      const file = path.join(pub, page);
      if (digest(await readFile(file)) !== expected[page]) throw Error('Entry changed concurrently: ' + page);
      await rename(file + '.' + revision + '.tmp', file); activated.push(page);
    }
  } catch (e) {
    for (const page of activated.reverse()) {
      const file = path.join(pub, page), temp = file + '.' + revision + '.rollback';
      await writeFile(temp, originals[page]); await rename(temp, file);
    }
    throw e;
  }
  const result = { revision, published, pages: Object.fromEntries(pages.map(page => [page, digest(html[page])])), backup, backendRestarted: false };
  await writeFile(path.join(backup, 'receipt.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [releaseRoot, payload] = process.argv.slice(2);
  const manifest = JSON.parse(await readFile(path.join(payload, 'manifest.json'), 'utf8'));
  const modules = {};
  for (const [name, entry] of Object.entries(manifest.modules)) {
    if (!(allowed.has(name) || preloadGroup.includes(name)) || !/^[a-z0-9.-]+$/.test(entry.file)) throw Error('Invalid payload path');
    let bytes;
    if (entry.delta) {
      const base = await readFile(path.join(releaseRoot, 'public', name.slice(1)));
      if (digest(base) !== manifest.expected[name.slice(1)]) throw Error('Unexpected delta base');
      const recipe = JSON.parse(await readFile(path.join(payload, entry.file), 'utf8'));
      bytes = Buffer.concat(recipe.map(part => Array.isArray(part) ? base.subarray(part[0], part[0] + part[1]) : Buffer.from(part, 'base64')));
    } else bytes = await readFile(path.join(payload, entry.file));
    if (digest(bytes) !== entry.sha256) throw Error('Payload digest mismatch: ' + name);
    modules[name] = bytes;
  }
  console.log(JSON.stringify(await applyResourcePages({ releaseRoot, modules, expected: manifest.expected })));
}
