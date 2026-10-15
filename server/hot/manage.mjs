import fs from 'node:fs/promises';
import path from 'node:path';
const [configPath, command = 'status', value] = process.argv.slice(2);
const config = JSON.parse(await fs.readFile(path.resolve(configPath || 'gateway.json'), 'utf8'));
const control = JSON.parse(await fs.readFile(path.join(config.stateDir, 'control.json'), 'utf8'));
if (!['status', 'update', 'retire', 'stop'].includes(command)) throw new Error('指令: status / update <独立发布目录> / retire <版本ID> / stop');
const response = await fetch(`http://127.0.0.1:${control.port}/${command}`, {
  method: command === 'status' ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${control.token}`, 'Content-Type': 'application/json' },
  body: command === 'status' ? undefined : JSON.stringify(command === 'update' ? { root: value } : { id: value }),
  signal: AbortSignal.timeout(120000),
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok) process.exitCode = 1;
