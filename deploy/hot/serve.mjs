import { readFile, writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { startGateway } from '../../server/hot/gateway.mjs';

// Optional startup pointer remembers the active release, never a live match.
const stateFile = process.env.SP_HOT_CURRENT_FILE;
let root = process.argv[2];
if (stateFile) {
  try { root = (await readFile(stateFile, 'utf8')).trim() || root; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!root) throw new Error('请指定首个版本目录，或设置 SP_HOT_CURRENT_FILE');
const gateway = await startGateway({ releaseRoot: root, host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3222) });
async function remember() {
  if (!stateFile) return;
  await writeFile(stateFile + '.tmp', gateway.active.root + '\n', 'utf8');
  await rename(stateFile + '.tmp', stateFile);
}
await remember();
console.log(`热更入口已启动，端口 ${gateway.port}。指令：versions / update 新目录 / retire 旧版本ID / announce 文字`);
const input = createInterface({ input: process.stdin });
let queue = Promise.resolve();
input.on('line', line => {
  queue = queue.then(async () => {
    line = line.trim();
    if (line === 'versions') {
      for (const r of gateway.releases.values()) {
        const health = await fetch(`http://127.0.0.1:${r.port}/healthz`).then(res => res.json()).catch(() => ({}));
        console.log(JSON.stringify({ id:r.id, current:r === gateway.active, root:r.root, draining:r.draining, connections:r.connections, matches:health.matches ?? null, healthy:r.healthy }));
      }
    } else if (line.startsWith('update ')) {
      try { await gateway.activate(line.slice(7).trim().replace(/^"|"$/g, '')); }
      catch (error) { console.error(`更新未启用，当前版本继续运行：${error.message}`); return; }
      try { await remember(); console.log('当前版本目录已记录'); }
      catch (error) { console.error(`新版已启用，但启动记录写入失败：${error.message}。维护重启前须修复记录。`); }
    } else if (line.startsWith('retire ')) {
      await gateway.retire(line.slice(7).trim()); console.log('旧版本已清理，磁盘文件保留');
    } else if (line.startsWith('announce')) {
      for (const r of gateway.releases.values()) if (r.healthy) r.child.send({ type:'announce', line });
    } else if (line) console.log('可用指令：versions / update 新目录 / retire 旧版本ID / announce 文字');
  }).catch(error => console.error(error.message));
});
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, async () => {
  input.close(); await queue; await gateway.close(); process.exit(0);
});
