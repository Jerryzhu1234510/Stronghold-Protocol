#!/usr/bin/env node
// tools/whats-running.mjs — 列出本机正在运行的服务器实例：端口 / 版本 / 前端指纹 / 进程 / 当前人数。
//
// 为什么需要它：启动器（scripts/start-windows.bat → scripts/launch.mjs）探到端口上「本游戏的服务器」时只会打开
// 浏览器、不会重启，而它判断「是本游戏」的依据（tools/doctor.mjs probePort）只是 /healthz 里有 `ok` 和
// `uptimeSec` —— **分不清是哪份副本、哪个版本**。于是另一个目录里的旧副本（例如 v0.1.3）占着 3000 时，双击新副本
// 的启动器只会把你送到旧服务器上，页面上当然「什么都没变」。这个脚本把每份实例的身份摊开给你看。
//
//   node tools/whats-running.mjs                    # 扫 3000-3005
//   node tools/whats-running.mjs 3000 3010          # 只扫这两个端口
//   node tools/whats-running.mjs --range 3000-3020  # 扫一个区间
//   scripts\whats-running.cmd                       # Windows 双击版（scripts/whats-running.cmd）
//
// 每份实例打印：版本（/healthz 的 `app`）、前端指纹（`build`，与**当前目录**的前端比对）、进程（PID / 启动时间 /
// 命令行）、当前人数，以及停止它的命令。只读：不重启、不杀进程、不改任何文件。文档：docs/DEPLOY.md。

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probePort } from './doctor.mjs';
import { computeBuildTag } from '../server/index.js';
import { APP_VERSION } from '../shared/constants.js';
import { c, mark } from './setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

/** 不带参数时扫的端口（启动器的默认端口在前）。 */
export const DEFAULT_PORTS = Object.freeze([3000, 3001, 3002, 3003, 3004, 3005]);

/** 一次最多扫多少个端口，避免手滑输入 `1-65535` 时对着 6 万个端口发请求。 */
export const MAX_PORTS = 64;

const clampPort = (n) => (Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null);

/**
 * 端口清单：位置参数（`3000` 或 `3000-3010`）与 `--port N` / `--range a-b`；去重、保序、最多 {@link MAX_PORTS} 个。
 * 认不出任何端口时用 {@link DEFAULT_PORTS}。
 * @param {string[]} argv
 * @returns {number[]}
 */
export function parsePorts(argv) {
  const out = [];
  const push = (n) => { const p = clampPort(n); if (p != null && !out.includes(p) && out.length < MAX_PORTS) out.push(p); };
  const pushRange = (a, b) => { for (let p = Math.min(a, b); p <= Math.max(a, b); p++) push(p); };
  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i]);
    const [flag, inline] = raw.split('=');
    const value = inline !== undefined ? inline : argv[i + 1];
    const take = () => { if (inline === undefined) i++; return value; };
    if (flag === '--port') { push(Number(take())); continue; }
    const spec = flag === '--range' ? String(take() ?? '') : raw;
    const m = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(spec);
    if (!m) continue;                                  // 认不出的参数（--help 之类）忽略
    if (m[2] !== undefined) pushRange(Number(m[1]), Number(m[2]));
    else push(Number(m[1]));
  }
  return out.length ? out : [...DEFAULT_PORTS];
}

/**
 * `netstat -ano` 的输出 → `Map(port → pid)`：只看 TCP 且状态为 LISTENING 的行（IPv4 与 IPv6 都认）。
 * @param {string} text
 * @returns {Map<number, number>}
 */
export function parseNetstat(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    if (!/^TCP$/i.test(cols[0])) continue;
    if (!/^LISTENING$/i.test(cols[cols.length - 2])) continue;
    const local = cols[1];
    const port = Number(local.slice(local.lastIndexOf(':') + 1));
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(port) && Number.isInteger(pid) && !out.has(port)) out.set(port, pid);
  }
  return out;
}

/**
 * 一份实例与「当前目录」的关系。
 *   `same`          版本与前端指纹都一致 → 它就是这份副本、且跑的是当前前端
 *   `other-version` 版本不同 → 另一个目录里的副本（例如 v0.1.3）
 *   `other-frontend` 版本相同但前端指纹不同 → 另一份同版本副本，**或**本目录改过 public/ 而那个服务器还没重启
 *   `unknown`       它没报 build（老版本或非本游戏的应答）
 * @param {{ app?: string, build?: string }} health /healthz 的应答
 * @param {{ app: string, build: string }} local 当前目录的版本与前端指纹
 * @returns {'same'|'other-version'|'other-frontend'|'unknown'}
 */
export function classifyInstance(health, local) {
  if (!health || !health.app || health.app !== local.app) return 'other-version';
  if (!health.build || !local.build) return 'unknown';
  return health.build === local.build ? 'same' : 'other-frontend';
}

/**
 * 命令行里能认出的项目目录：`…<dir>/server/index.js` 的 `<dir>`；命令行只有相对路径时返回 null。
 * 脚本路径通常是最后一个参数，前面可能还有被引号包起来的 node.exe（`"C:\…\node.exe" D:\a\b\server\index.js`）。
 * @param {string} commandLine
 * @returns {string|null}
 */
export function projectDirOf(commandLine) {
  const m = /"([^"]*[\\/]server[\\/]index\.js)"|(\S*[\\/]server[\\/]index\.js)\s*$/i.exec(String(commandLine || ''));
  const script = m ? (m[1] ?? m[2]) : null;
  if (!script) return null;
  return script.replace(/[\\/]server[\\/]index\.js$/i, '') || null;
}

/** 端口 → PID。Windows 用 netstat，其他平台用 lsof；没有可用的命令就返回空表（进程信息只是加分项）。 */
export function portOwners() {
  try {
    if (IS_WIN) return parseNetstat(execFileSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    const text = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const out = new Map();
    for (const line of text.split(/\r?\n/).slice(1)) {
      const cols = line.trim().split(/\s+/);
      const port = Number(String(cols[8] || '').slice(String(cols[8] || '').lastIndexOf(':') + 1));
      const pid = Number(cols[1]);
      if (Number.isInteger(port) && Number.isInteger(pid) && !out.has(port)) out.set(port, pid);
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * PID → `{ name, startedAt, commandLine }`（拿不到返回 null）。
 * @param {number} pid
 */
export function processInfo(pid) {
  try {
    if (IS_WIN) {
      const ps = 'Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '" | '
        + 'Select-Object Name,CreationDate,CommandLine | ConvertTo-Json -Compress';
      const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 15000 }).trim();
      if (!raw) return null;
      const o = JSON.parse(raw);
      return { name: o.Name ?? null, startedAt: o.CreationDate ?? null, commandLine: o.CommandLine ?? null };
    }
    const raw = execFileSync('ps', ['-o', 'lstart=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 10000 }).trim();
    return raw ? { name: raw.split(/\s+/).pop(), startedAt: raw.slice(0, 24).trim(), commandLine: null } : null;
  } catch {
    return null;
  }
}

/** Date（或 Windows 的 `/Date(...)/`）→ `YYYY-MM-DD HH:mm:ss`；认不出就原样返回。 */
export function formatStarted(value) {
  if (!value) return null;
  const m = /\/Date\((\d+)\)\//.exec(String(value));
  const d = m ? new Date(Number(m[1])) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 已运行时长的可读写法。 */
export function formatUptime(sec) {
  if (!Number.isFinite(sec)) return '?';
  const s = Math.max(0, Math.round(sec));
  if (s < 120) return `${s} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min（${s} s）`;
  return `${(s / 3600).toFixed(1)} h（${s} s）`;
}

/**
 * 一个端口的全部情况。
 * @param {number} port
 * @param {{ app: string, build: string }} local
 */
export async function inspectPort(port, local) {
  const probe = await probePort(port, '0.0.0.0');
  const info = { port, state: probe.state, health: probe.health ?? null, pid: null, process: null, relation: null, projectDir: null };
  if (probe.state !== 'ours') return info;
  const pid = portOwners().get(port) ?? null;
  if (pid != null) {
    info.pid = pid;
    info.process = processInfo(pid);
    info.projectDir = projectDirOf(info.process?.commandLine);
  }
  info.relation = classifyInstance(info.health, local);
  return info;
}

const RELATION_TEXT = Object.freeze({
  same: ['ok', '版本与前端都与本目录一致（就是这份副本）'],
  'other-frontend': ['warn', '版本相同，但前端指纹不同：另一份同版本副本，或本目录改过 public/ 而它还没重启'],
  'other-version': ['warn', '版本与本目录不同 —— 它是**另一个目录**里的副本'],
  unknown: ['skip', '它没有报前端指纹（老版本？）'],
});

/** 中日韩字符按 2 列算的显示宽度（只用于标签对齐）。 */
const displayWidth = (s) => [...String(s)]
  .reduce((n, ch) => n + (/[\u2e80-\ua4cf\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0);
const padLabel = (s, w = 10) => s + ' '.repeat(Math.max(1, w - displayWidth(s)));

function render(info) {
  const h = info.health;
  const line = (m, label, text) => console.log(`    ${m} ${c.dim(padLabel(label))} ${text}`);
  console.log(`\n  ${c.bold(`端口 ${info.port}`)}  ${c.dim(`http://localhost:${info.port}`)}`);
  line(mark.ok, '服务器', `${h.app ? `v${h.app}` : '版本未知'} · 已运行 ${formatUptime(Number(h.uptimeSec))}`);
  const [m, text] = RELATION_TEXT[info.relation] ?? RELATION_TEXT.unknown;
  line(mark[m] ?? mark.skip, '与本目录', text);
  if (info.pid != null) {
    const who = info.process?.name || '进程';
    const when = formatStarted(info.process?.startedAt);
    line(mark.skip, '进程', `PID ${info.pid} · ${who}${when ? ` · 启动于 ${when}` : ''}`);
    if (info.process?.commandLine) line(' ', '', c.dim(info.process.commandLine));
    if (info.projectDir) line(mark.skip, '所在目录', info.projectDir);
    else line(mark.skip, '所在目录', c.dim('命令行没带绝对路径，认不出（用下面的停止命令即可）'));
    line(mark.skip, '停止', IS_WIN ? `Stop-Process -Id ${info.pid} -Force` : `kill ${info.pid}`);
  } else {
    line(mark.skip, '进程', c.dim('查不到占用它的进程（netstat/lsof 不可用或权限不足）'));
  }
  line(mark.skip, '当前', `在线 ${h.online ?? '?'} · 房间内 ${h.inRoom ?? '?'} · 房间 ${h.rooms ?? '?'} · 对局 ${h.matches ?? '?'}`
    + `${h.queued != null ? ` · 排队 ${h.queued}` : ''} · 会话 ${h.sessions ?? '?'}`);
  return info;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('用法：node tools/whats-running.mjs [端口…] [--port N] [--range a-b]');
    console.log('  列出本机正在运行的服务器实例（版本 / 前端指纹 / 进程 / 人数）。只读，不重启也不杀进程。');
    return 0;
  }
  const ports = parsePorts(argv);
  const local = { app: APP_VERSION, build: computeBuildTag(ROOT) };
  console.log(`\n卫戍协议：盟约 · 正在运行的实例`);
  console.log(`  ${mark.ok} 本目录  ${c.bold(ROOT)}`);
  console.log(`            v${local.app} · 前端指纹 ${local.build}`);

  const found = [];
  const busy = [];
  for (const port of ports) {
    // eslint-disable-next-line no-await-in-loop
    const info = await inspectPort(port, local);
    if (info.state === 'ours') found.push(render(info));
    else if (info.state === 'busy' || info.state === 'denied') busy.push(port);
  }

  if (!found.length) console.log(`\n  ${mark.warn} 端口 ${ports[0]}-${ports[ports.length - 1]} 上没有发现运行中的服务器。`);
  for (const port of busy) console.log(`\n  ${c.bold(`端口 ${port}`)}\n    ${mark.warn} 被其他程序占用（不是本游戏）`);

  console.log('');
  if (found.some((f) => f.relation !== 'same')) {
    console.log(`${mark.warn} 上面有实例与本目录的版本或前端不一致：那是另一个目录里的副本（或本目录改过前端而它没重启）。`);
    console.log(c.dim('  刷新页面没用 —— 用上面的停止命令结束它，再启动你要的那份（scripts\\start-windows.bat 或 npm start）。'));
  } else if (found.length) {
    console.log(c.dim('  上面的实例就是本目录的服务器，跑的是当前前端。想重启：结束它，再运行 scripts\\start-windows.bat。'));
  }
  return 0;
}

function isMain() {
  try { return !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
}
