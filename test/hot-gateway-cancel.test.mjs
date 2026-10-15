import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startGateway } from '../server/hot/gateway.mjs';

test('cancelling a completed GET releases its unfinished rewritten upstream response', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stronghold-cancel-'));
  let gateway, client;
  try {
    await mkdir(path.join(root, 'server')); await mkdir(path.join(root, 'public'));
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(root, 'public/index.html'), '<head></head>');
    await writeFile(path.join(root, 'server/index.js'), `
      import http from 'node:http';
      export async function startServer() {
        let active = 0, cancelled = 0;
        const timers = new Set();
        const server = http.createServer((req, res) => {
          if (req.url === '/slow.js') {
            active++; res.writeHead(200, {'Content-Type':'text/javascript'});
            const timer = setInterval(() => res.write('// ' + 'x'.repeat(1000) + '\\n'), 10);
            timers.add(timer);
            res.once('close', () => { clearInterval(timer); timers.delete(timer); active--; cancelled++; });
          } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ok:true,build:'cancel',active,cancelled})); }
        });
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        return {port:server.address().port, beginDrain(){}, async close(){ for(const t of timers) clearInterval(t); server.closeAllConnections(); await new Promise(r => server.close(r)); }};
      }
    `);
    gateway = await startGateway({ releaseRoot: root, port: 0, log: { info() {} } });
    const origin = `http://127.0.0.1:${gateway.port}/_build/${gateway.active.id}`;
    const health = () => fetch(origin + '/healthz').then(r => r.json());
    const waitFor = async predicate => {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) { const state = await health(); if (predicate(state)) return state; await new Promise(r => setTimeout(r, 20)); }
      assert.fail('upstream did not reach the expected state');
    };
    client = http.get(origin + '/slow.js'); client.on('error', () => {});
    await waitFor(s => s.active === 1);
    client.destroy();
    const state = await waitFor(s => s.active === 0 && s.cancelled === 1);
    assert.equal(state.cancelled, 1);
  } finally {
    client?.destroy(); await gateway?.close(); await rm(root, { recursive: true, force: true });
  }
});
