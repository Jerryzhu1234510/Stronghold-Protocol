import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { TestClient } from '../test/helpers/wsClient.js';

const origin = 'https://64-90-4-56.sslip.io';
const release = process.env.SP_QA_RELEASE || '/opt/stronghold-rainyun/releases/20261014-official-default';
const key = 'C:/Users/34775/Downloads/rainyun-rcs-SHA256_eEzi3VbqxrjANuRRmU5edBgOGF4YsSDacAYzamMnC_Y.pem';
const proxyOptions = process.env.SP_QA_SSH_PROXY ? ['-o', `ProxyCommand=${process.env.SP_QA_SSH_PROXY}`] : [];
const ssh = command => execFileSync('C:/Windows/System32/OpenSSH/ssh.exe', ['-i', key, ...proxyOptions, '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=12', '-o', 'StrictHostKeyChecking=yes', 'root@64.90.4.56', command], { encoding: 'utf8', timeout: 20000 }).trim();
const status = () => fetch(origin + '/__hot/status', { cache: 'no-store' }).then(r => r.json());
const health = id => fetch(origin + `/_build/${id}/healthz`).then(r => r.json());
const clients = [];
let step = 'create old match';
const ok = async (c, message) => {
  const reply = await c.request(message, 15000);
  assert.equal(reply.t, 'ok', JSON.stringify(reply));
};
async function connect(id, token) {
  const c = await TestClient.connect(origin.replace('https:', 'wss:') + `/_build/${id}/ws`, { timeout: 15000 });
  clients.push(c); c.welcome = await c.hello('hot-map-qa', token); return c;
}
try {
  const old = (await status()).build;
  const pid = ssh('systemctl show stronghold-rainyun --property MainPID --value');
  const a = await connect(old);
  await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY', mapVersion: 'classic', visibility: 'private' });
  await ok(a, { t: 'room.start' });
  await a.waitFor('m.public', p => p.phase === 'INFO_CHECK', 15000);
  const before = await health(old);
  ssh(`printf 'update ${release}\n' > /run/stronghold-rainyun/control`);
  step = 'activate release';
  let next;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await status();
    if (value.build !== old) { next = value; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(next, 'local maintenance FIFO did not activate the release');
  assert.equal(ssh('systemctl show stronghold-rainyun --property MainPID --value'), pid);
  assert.equal(ssh('cat /var/lib/stronghold-rainyun/current-release'), release);
  assert.ok(next.versions.find(v => v.id === old)?.draining);
  assert.equal(a.isOpen, true);
  const after = await health(old);
  assert.deepEqual(after.matchWorkers.map(w => w.threadId), before.matchWorkers.map(w => w.threadId));
  assert.ok(after.matches >= 1, 'Old release lost the test match');
  await a.terminate();
  step = 'reconnect old match';
  const resumed = await connect(old, a.welcome.token);
  assert.equal(resumed.welcome.playerId, a.welcome.playerId);
  const oldPublic = await resumed.waitFor('m.public', p => p.phase === 'INFO_CHECK', 15000);
  assert.equal(oldPublic.mapVersion, 'classic');
  await ok(resumed, { t: 'g.infoReady' });
  step = 'old band draft';
  await resumed.waitFor('m.public', p => p.phase === 'BAND_DRAFT', 15000);
  await ok(resumed, { t: 'g.band', bandId: 'band_sarkazb' });
  step = 'old preparation';
  await resumed.waitFor('m.public', p => p.phase === 'PREP', 15000);
  await ok(resumed, { t: 'g.ready', ready: true });
  step = 'old battle';
  await resumed.waitFor('b.start', p => p.authoritative, 15000);
  const fresh = await connect(next.build);
  for (const gameMode of ['normal', 'clone', 'versus']) {
    step = 'default room ' + gameMode;
    await ok(fresh, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', gameMode, capacity: 4, visibility: 'private' });
    const room = await fresh.waitFor('room.state', p => p.gameMode === gameMode, 15000);
    assert.equal(room.mapVersion, 'official');
    await ok(fresh, { t: 'room.leave' });
  }
  await ok(fresh, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY', visibility: 'private' });
  step = 'new match appearance';
  await ok(fresh, { t: 'room.start' });
  assert.equal((await fresh.waitFor('m.public', p => p.phase === 'INFO_CHECK', 15000)).mapVersion, 'official');
  await ok(fresh, { t: 'room.leave' });
  await ok(resumed, { t: 'room.leave' });
  console.log(JSON.stringify({ passed: true, old, current: next.build, gatewayPid: pid,
    defaultAppearance: 'official', oldCombatAndReconnectPreserved: true, activeReleasePersisted: true }));
} catch (error) {
  console.error(JSON.stringify({ step, recent: clients.map(c => c.log.slice(-8).map(p => ({ t: p.t, phase: p.phase, code: p.code }))) }));
  throw error;
} finally {
  for (const client of clients) {
    try { if (client.isOpen) await client.request({ t: 'room.leave' }, 5000); } catch { /* disconnected */ }
    await client.terminate().catch(() => {});
  }
}
