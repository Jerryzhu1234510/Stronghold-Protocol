#!/usr/bin/env node
// 卫戍协议 · HTTPS 反向代理（零依赖；支持 ACME webroot 应答与证书热重载）
//   node https-proxy.mjs --cert C:\certs\sslip.pem --key C:\certs\sslip.key --domain 103-205-253-194.sslip.io
//   可选: --port 443  --http-port 80  --target 127.0.0.1:27527  --webroot C:\certs\acme-webroot
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createDomainGuard } from '../domain-guard-r01/domain-guard.mjs';
import { createProxyHandler } from './resource-desktop-r01/proxy-transfer-r02.mjs';
import { createPortalRouter } from '../portal-router-v1.mjs';
import { DownloadBudget } from './resource-desktop-r01/download-budget.mjs';
import { createResourcePolicyRouter } from './resource-desktop-r01/policy-router.mjs';
import { SessionCap, createCappedUpgradeHandler } from './resource-desktop-r01/session-cap.mjs';
import { ExitMetrics, observeResponse, trafficClass } from './resource-desktop-r01/metrics.mjs';
import { Admission } from './resource-desktop-r01/admission.mjs';

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const CERT = arg('cert', ''), KEY = arg('key', '');
const DOMAIN = arg('domain', 'localhost');
const PORT = Number(arg('port', '443'));
const HTTP_PORT = Number(arg('http-port', '80'));
const BIND = arg('bind', '0.0.0.0');
const TARGET = arg('target', '127.0.0.1:27527');
const WEBROOT = arg('webroot', '');
const tParts = TARGET.split(':');
const THOST = tParts[0] || '127.0.0.1';
const TPORT = Number(tParts[1] || '80');
const domainGuard = createDomainGuard({domain:DOMAIN,port:PORT});

if (!CERT || !KEY) {
  console.error('用法: node https-proxy.mjs --cert <证书.pem> --key <私钥.key> [--domain 域名] [--port 443] [--http-port 80] [--target 127.0.0.1:27527] [--webroot C:\\certs\\acme-webroot]');
  process.exit(2);
}
for (const f of [CERT, KEY]) if (!fs.existsSync(f)) { console.error('[X] 找不到文件: ' + f); process.exit(2); }

let creds = { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) };
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (m) => console.log('[' + stamp() + '] ' + m);

// ACME 验证文件应答（续期时反代不用停）
function serveAcme(req, res) {
  if (!WEBROOT) return false;
  const m = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_\-]+)$/.exec(req.url || '');
  if (!m) return false;
  const file = path.join(WEBROOT, '.well-known', 'acme-challenge', m[1]);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return true; }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(fs.readFileSync(file));
  return true;
}

function proxyHeaders(req, proto) {
  const h = Object.assign({}, req.headers);
  h['x-forwarded-proto'] = proto;
  h['x-forwarded-host'] = req.headers.host || DOMAIN;
  const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  h['x-forwarded-for'] = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] + ', ' : '') + ip;
  return h;
}

const budget = new DownloadBudget({bytesPerSecond:Number(arg('download-bytes-per-second','3750000'))});
const cap = new SessionCap({limit:Number(arg('online-limit','0'))}), metrics = new ExitMetrics();
const secretFile=new URL('../resource-desktop-r01/entry-signing-key.txt',import.meta.url);
if(!fs.existsSync(secretFile))throw Error('Existing entry signing key is required');
const admission=new Admission({secret:fs.readFileSync(secretFile,'utf8')});
const variants = JSON.parse(fs.readFileSync(new URL('../resource-desktop-r01/variants.json',import.meta.url)));
const publicOrigin='https://'+DOMAIN+(PORT===443?'':':'+PORT);
const variantsRoot=new URL(arg('variants-root','../resource-open-r01/'),import.meta.url);
const resourcePolicy = createResourcePolicyRouter({gatewayOrigin:'http://' + TARGET, budget, cap, metrics, admission, publicOrigin, assetsRoot:new URL('./resource-desktop-r01/',import.meta.url), variantsRoot, variants, downloads:{
  '8443-extra-v1.zip':arg('extra-pack','D:/Stronghold-Protocol-Hot/releases/r05/public/assets/downloads/8443-r05-extra-v1.zip'),
}});
const forward = createProxyHandler({ host: THOST, port: TPORT, budget, variants,
  headers: req => proxyHeaders(req, 'https'),
  onError: err => log('[!] 后端连接错误: ' + err.message) });
const portal = createPortalRouter({ portalRoot: arg('portal-root', 'D:/Stronghold-Protocol-Hot/portal'), gatewayOrigin: 'http://' + TARGET });
const handle = async (req, res) => {
  if(!domainGuard.allows(req)){domainGuard.reject(req,res);return;}
  res.setHeader('X-SP-Domain-Guard','r01');
  observeResponse(res,metrics,trafficClass(req.url));
  if (serveAcme(req, res)) return;
  if (await resourcePolicy(req,res)) return;
  try { if (await portal(req, res)) return; } catch (e) { log('[!] 大厅路由错误: ' + e.message); }
  if (!res.destroyed && !res.headersSent) forward(req, res);
};
const handleUpgrade = createCappedUpgradeHandler({ host: THOST, port: TPORT, cap, metrics,
  authorizeNewRoom:async(req,route)=>{const build=await admission.currentBuild(async()=>{const r=await fetch('http://'+TARGET+'/__hot/status',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Gateway unavailable');return (await r.json()).build;});return route==='/_build/'+build+'/ws'&&admission.valid(req.headers.cookie,build);},
  wsModule:arg('ws-module','D:/Stronghold-Protocol-Hot/releases/r05/node_modules/ws') });

const server = https.createServer(creds, handle);
server.on('secureConnection',socket=>{if(!domainGuard.servernameMatches(socket.servername))socket.destroy();});
server.on('upgrade', domainGuard.upgrade(handleUpgrade));
server.on('error', (err) => { console.error('[X] HTTPS 监听失败(端口 ' + PORT + '): ' + err.message); process.exit(1); });
server.listen(PORT, BIND, () => log('HTTPS 就绪（大厅资源检查 / 无百人限制 / 静态下载总预算 ' + budget.rate + ' B/s）: https://' + DOMAIN + ':' + server.address().port + '  ->  http://' + TARGET));
// Aggregate diagnostics only: no names, cookies, tokens, addresses or message bodies.
const metricsTimer = setInterval(() => {
  const row = {at:new Date().toISOString(),download:budget.status(),capacity:cap.status(),traffic:metrics.snapshot()};
  const file = new URL('./traffic-' + row.at.slice(0,10) + '.jsonl',import.meta.url);
  fs.appendFile(file,JSON.stringify(row)+'\n',()=>{});
},15000);metricsTimer.unref();

// 证书热重载：证书文件一变就换上，无需重启
let reloading = false;
const reload = () => {
  if (reloading) return;
  reloading = true;
  setTimeout(() => {
    reloading = false;
    try {
      const next = { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) };
      server.setSecureContext(next);
      creds = next;
      log('证书已热重载 ✓');
    } catch (err) { log('[!] 证书重载失败（继续用旧证书）: ' + err.message); }
  }, 800);
};
try { fs.watch(CERT, reload); fs.watch(KEY, reload); } catch (e) { log('[!] 无法监听证书文件变化: ' + e.message); }

const redir = http.createServer((req, res) => {
  if(!domainGuard.allows(req,{tls:false,expectedPort:HTTP_PORT})){domainGuard.reject(req,res);return;}
  res.setHeader('X-SP-Domain-Guard','r01');
  if (serveAcme(req, res)) return;
  res.writeHead(301, { location: domainGuard.origin + req.url });
  res.end();
});
redir.on('error', (err) => log('[!] HTTP 端口 ' + HTTP_PORT + ' 未启用: ' + err.message));
if (HTTP_PORT >= 0) redir.listen(HTTP_PORT, BIND, () => log('HTTP 就绪: http://' + DOMAIN + '  ->  https'));

process.on('SIGINT', () => { log('正在退出...'); process.exit(0); });
