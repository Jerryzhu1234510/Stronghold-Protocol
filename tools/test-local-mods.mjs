import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = path.join(root, 'clients/desktop/tests');
await fs.mkdir(path.join(root, 'clients/desktop/test-output'), { recursive: true });
const files = (await fs.readdir(tests)).filter(name => name.endsWith('-test.mjs')).map(name => path.join(tests, name));
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
