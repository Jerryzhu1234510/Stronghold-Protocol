// Immutable art/audio identities shared by browser caches across hot releases.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AUDIO_EXTS } from '../../shared/media.js';

const TYPES = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif', '.svg', '.mp3', '.ogg', '.wav', '.m4a', '.woff', '.woff2', '.ttf', '.otf', '.skel', '.atlas', '.obj', '.mtl', '.glb', '.gltf', '.ktx2', '.fnt', '.mp4', '.webm']);
export async function buildResourceManifest(publicDir) {
  const root = path.resolve(publicDir), files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const scene = path.relative(root, abs).replace(/\\/g, '/').startsWith('assets/local/');
        if (TYPES.has(ext) || (scene && ['.json', '.bin'].includes(ext))) files.push(abs);
      }
    }
  }
  await walk(path.join(root, 'assets')); await walk(path.join(root, 'fonts'));
  files.sort();
  const entries = {}; let totalBytes = 0, cursor = 0;
  async function hashFiles() {
    while (cursor < files.length) {
      const abs = files[cursor++], stat = await fsp.stat(abs);
      if (!stat.size || stat.size > 32 * 1024 * 1024) continue;
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(abs)) hash.update(chunk);
      const url = '/' + path.relative(root, abs).split(path.sep).map(encodeURIComponent).join('/');
      entries[url] = { hash: hash.digest('hex'), bytes: stat.size };
      totalBytes += stat.size;
    }
  }
  await Promise.all(Array.from({ length: 4 }, hashFiles));
  // Match serveMedia's extension preference exactly; aliases share one cache entry.
  const aliases = {};
  for (const url of Object.keys(entries).sort()) {
    if (!url.startsWith('/assets/audio/')) continue;
    const ext = path.posix.extname(url).toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) continue;
    const stem = '/media/' + url.slice('/assets/audio/'.length, -ext.length);
    aliases[stem + ext] = url;
    if (!aliases[stem] || AUDIO_EXTS.indexOf(ext) < AUDIO_EXTS.indexOf(path.posix.extname(aliases[stem]).toLowerCase())) aliases[stem] = url;
  }
  return { version: 1, entries, aliases, count: Object.keys(entries).length, totalBytes };
}

export function resourceManifestLoader(publicDir) {
  let pending;
  return () => pending ??= fsp.readFile(path.join(publicDir, 'data', 'resource-cache.json'), 'utf8')
    .then(body => {
      const value = JSON.parse(body);
      if (value.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('Invalid resource manifest');
      return value;
    }).catch(error => {
      if (error.code === 'ENOENT') return buildResourceManifest(publicDir);
      throw error;
    }).catch(error => { pending = undefined; throw error; });
}
