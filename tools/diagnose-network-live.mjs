import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spineEntry } from '../public/js/assets.js';
import { unhashedUrl } from '../shared/assetPaths.js';
import { TestClient } from '../test/helpers/wsClient.js';

const out = path.resolve('.cache/network-live-20261014'); mkdirSync(out, { recursive: true });
const origin = 'https://weishuxieyi.icu';
const report = { at: new Date().toISOString(), resources: [], ping: [], errors: [] };
const get = url => JSON.parse(execFileSync('curl.exe', ['--noproxy', '*', '--compressed', '--connect-timeout', '8', '--max-time', '20', '-sS', url],
  { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 25000 }));
const probe = (url, name) => {
  const file = path.join(out, name + '.body'), headers = path.join(out, name + '.headers');
  let text;
  try { text = execFileSync('curl.exe', ['--noproxy', '*', '--compressed', '--connect-timeout', '8', '--max-time', '20', '-sS', '-D', headers, '-o', file, '-w', '%{json}', url],
    { encoding: 'utf8', timeout: 25000 }); }
  catch (e) { text = e.stdout; }
  let stats; try { stats = JSON.parse(text); } catch { return { url, error: String(text).slice(0, 300) }; }
  const header = readFileSync(headers, 'utf8');
  return { url, code: stats.http_code, error: stats.errormsg, remote: stats.remote_ip,
    dns: stats.time_namelookup, connect: stats.time_connect, tls: stats.time_appconnect,
    first: stats.time_starttransfer, total: stats.time_total, bytes: stats.size_download, bytesPerSecond: stats.speed_download,
    cache: header.match(/cf-cache-status:\s*(\S+)/i)?.[1], cors: header.match(/access-control-allow-origin:\s*([^\r\n]+)/i)?.[1],
    hash: stats.http_code === 200 ? createHash('sha256').update(readFileSync(file)).digest('hex') : null };
};
let client;
try {
  report.hot = get(origin + '/__hot/status');
  const base = origin + '/_build/' + report.hot.build;
  report.health = get(origin + '/healthz');
  const m = get(base + '/data/assets.json'), local = get(base + '/data/local-assets.json');
  const enemy = 'enemy_1000_gopro_2';
  const models = [['char_003_kalts', spineEntry(m, 'char_003_kalts')], [enemy, spineEntry(m, enemy, { local })]];
  report.models = models;
  const routes = new Map();
  for (const [id, entry] of models) {
    if (!entry) continue;
    for (const resource of [entry.skel, entry.atlas, entry.textures?.[0]].filter(Boolean)) {
      const plain = unhashedUrl(resource.replace('/_build/' + report.hot.build, '')), directory = plain.slice(0, plain.lastIndexOf('/'));
      if (!routes.has(directory)) routes.set(directory, get(base + '/data/resource-routes/' + createHash('sha256').update(directory).digest('hex') + '.json'));
      const item = routes.get(directory).entries?.[plain];
      const number = report.resources.length;
      const source = probe(new URL(resource, origin).href, 'source-' + number);
      const cdn = item?.cdn ? probe(item.cdn, 'cdn-' + number) : null;
      const row = { id, resource, expected: item, source, cdn };
      report.resources.push(row); console.log(JSON.stringify(row));
    }
  }
  client = await TestClient.connect(origin.replace('https:', 'wss:') + '/_build/' + report.hot.build + '/ws', { timeout: 15000 });
  await client.hello('网检');
  for (let i = 0; i < 15; i++) {
    const at = performance.now();
    try { await client.request({ t: 'ping', c: Date.now() }, 8000); report.ping.push(Math.round(performance.now() - at)); }
    catch (e) { report.errors.push(e.message); }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(JSON.stringify({ ping: report.ping, errors: report.errors }));
} catch (e) { report.errors.push(e.stack); process.exitCode = 1; }
finally { await client?.terminate(); writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
