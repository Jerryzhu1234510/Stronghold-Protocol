import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Three-way import only upstream runtime/tests; conflicts never enter the working source.
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.cache/v026-integration');
const apply = process.argv.includes('--apply');
mkdirSync(out, { recursive: true });
const paths = execFileSync('git', ['diff', '--name-only', 'official/v0.2.5', 'official/v0.2.6'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(p => /^(public\/|server\/|shared\/|test\/|tools\/local-extract\/|package)/.test(p));
const results = [];
for (const path of paths) {
  const local = resolve(root, path), base = resolve(root, '.cache/upstream-v025', path), next = resolve(root, '.cache/upstream-v026', path);
  const before = existsSync(local) ? readFileSync(local) : null;
  const backup = resolve(out, 'before', path);
  if (before && !existsSync(backup)) { mkdirSync(dirname(backup), { recursive: true }); copyFileSync(local, backup); }
  let merged, status;
  if (!existsSync(base)) {
    if (before) { results.push({ path, status: 'new-file-exists' }); continue; }
    merged = readFileSync(next); status = 'new';
  } else if (!before) { results.push({ path, status: 'local-missing' }); continue; }
  else {
    const inputs = [local, base, next].map((p, i) => {
      const dest = resolve(out, `input-${i}`);
      writeFileSync(dest, readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
      return dest;
    });
    const result = spawnSync('git', ['merge-file', '-p', ...inputs], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (result.status === null || result.status > 127) throw new Error(result.stderr);
    merged = result.stdout; status = result.status === 0 ? 'clean' : 'conflict';
  }
  const candidate = resolve(out, 'candidate', path);
  mkdirSync(dirname(candidate), { recursive: true }); writeFileSync(candidate, merged);
  if (apply && status !== 'conflict') { mkdirSync(dirname(local), { recursive: true }); writeFileSync(local, merged); }
  results.push({ path, status, beforeSha256: before && createHash('sha256').update(before).digest('hex') });
}
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ apply, results }, null, 2));
console.log(JSON.stringify(results.filter(r => r.status !== 'clean' && r.status !== 'new'), null, 2));
console.log(`${results.length} files; ${results.filter(r => r.status === 'conflict').length} conflicts; ${apply ? 'clean merges applied' : 'dry run'}`);
