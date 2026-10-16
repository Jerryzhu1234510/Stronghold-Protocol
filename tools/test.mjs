// Run actual suites only: fixtures deliberately contain scripts that throw or never finish.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
export function testFiles(dir = path.join(root, 'test')) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(e => {
    if (e.name.startsWith('.') || ['fixtures', 'node_modules'].includes(e.name)) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? testFiles(full) : /\.test\.(?:js|mjs)$/.test(e.name) ? [full] : [];
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=120000', ...process.argv.slice(2), ...testFiles().map(f => path.relative(root, f))],
    { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
