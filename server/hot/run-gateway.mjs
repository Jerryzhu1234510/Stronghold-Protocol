// Fixed entry point. Its files stay in entry/ while immutable games stay in releases/.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { startGateway } from './gateway.mjs';

const configPath = path.resolve(process.argv[2] || 'gateway.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const stateDir = path.resolve(config.stateDir);
const releaseBase = await fs.realpath(config.releaseBase);
await fs.mkdir(stateDir, { recursive: true });
const pointer = path.join(stateDir, 'current.json');
const controlFile = path.join(stateDir, 'control.json');
async function atomicJson(file, value) {
  const temp = file + '.tmp';
  const handle = await fs.open(temp, 'w');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}
async function verifyRelease(root) {
  root = await fs.realpath(root);
  const relative = path.relative(releaseBase, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('发布目录必须在配置的 releases 目录内');
  const marker = JSON.parse(await fs.readFile(path.join(root, 'HOT-RELEASE.json'), 'utf8'));
  if (marker.accountsProtocol !== 1) throw new Error('此包未适配账号热更新');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'MANIFEST.json'), 'utf8'));
  for (const [name, item] of Object.entries(manifest.files)) {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep)) throw new Error('发布清单包含目录外文件');
    const stat = await fs.stat(file);
    if (stat.size !== item.size) throw new Error('文件大小校验失败: ' + name);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== item.sha256) throw new Error('文件校验失败: ' + name);
  }
  return root;
}
let root = config.releaseRoot;
try { root = JSON.parse(await fs.readFile(pointer, 'utf8')).root; }
catch (e) { if (e.code !== 'ENOENT') throw e; }
root = await verifyRelease(root);
const gateway = await startGateway({ releaseRoot: root, accountFile: config.accountFile,
  allowCreateAccounts: config.allowCreateAccounts === true, port: config.port, host: config.host || '127.0.0.1',
  workerEnv: config.workerEnv || {} });
await atomicJson(pointer, { root, id: gateway.active.id, activatedAt: new Date().toISOString() });
const token = randomBytes(32).toString('hex');
const sameToken = value => typeof value === 'string' && value.length === token.length
  && timingSafeEqual(Buffer.from(value), Buffer.from(token));
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
let busy = false;
const control = http.createServer(async (req, res) => {
  if (!sameToken(req.headers.authorization?.replace(/^Bearer /, ''))) return json(res, 403, { error: '禁止访问' });
  try {
    if (req.method === 'GET' && req.url === '/status') {
      const versions = await Promise.all([...gateway.releases.values()].map(async r => ({ id: r.id, root: r.root,
        draining: r.draining, connections: r.connections, healthy: r.healthy,
        health: r.healthy ? await fetch(`http://127.0.0.1:${r.port}/healthz`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null) : null })));
      return json(res, 200, { build: gateway.active.id, versions });
    }
    if (req.method !== 'POST' || !['/update', '/retire', '/stop'].includes(req.url)) return json(res, 404, { error: '未知指令' });
    if (busy) return json(res, 409, { error: '另一项操作正在进行' });
    busy = true;
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('指令过长'); }
      const data = JSON.parse(body || '{}');
      if (req.url === '/update') {
        const release = await gateway.activate(await verifyRelease(data.root));
        try { await atomicJson(pointer, { root: release.root, id: release.id, activatedAt: new Date().toISOString() }); }
        catch { return json(res, 500, { error: '新版本已经启用，但重启指针保存失败；请修复 current.json', activated: true, id: release.id }); }
        return json(res, 200, { ok: true, id: release.id });
      }
      if (req.url === '/retire') { await gateway.retire(data.id); return json(res, 200, { ok: true }); }
      json(res, 200, { ok: true });
      setImmediate(() => void stop());
    } finally { busy = false; }
  } catch (e) { json(res, 400, { error: e.message }); }
});
try {
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(config.controlPort || 27529, '127.0.0.1', resolve); });
  await atomicJson(controlFile, { port: control.address().port, token, pid: process.pid });
} catch (e) { await gateway.close(); throw e; }
console.log(`Gateway ready: ${gateway.port}; control listens only on loopback.`);
let stopping;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    control.close();
    await gateway.close();
    await fs.rm(controlFile, { force: true });
    process.exitCode = 0;
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
