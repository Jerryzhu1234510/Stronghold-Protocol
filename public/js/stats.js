const $ = id => document.getElementById(id);
const labels = { images: '图片', models: '角色模型 / 骨骼', audio: '音乐 / 语音', code: '程序 / 字体', data: '游戏数据', httpOther: '其他 HTTP', game: '游戏同步', chat: '好友房间聊天', connection: '连接 / 房间消息' };
const number = n => Number(n || 0).toLocaleString('zh-CN');
function bytes(n) {
  n = Math.max(0, Number(n) || 0);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: i ? 2 : 0 })} ${units[i]}`;
}
const text = (id, value) => { $(id).textContent = value; };
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
text('server-address', location.origin);
text('environment', local ? '本地测试服务' : '当前服务器');
text('environment-note', local ? '当前显示的是这台电脑上的测试数据。要看线上流量，需要把统计功能更新到线上服务器，再打开线上地址的 /stats。' : '下方数据来自这个地址上的游戏服务。累计统计从服务本次启动开始，不能补算更新之前的流量。');
let loading = false, timer = null;
async function refreshNetwork(signal) {
  try {
    const response = await fetch('/network-data', { cache: 'no-store', signal });
    if (!response.ok) throw new Error('unavailable');
    const s = await response.json();
    if (!s.available || !s.today || !s.recent) throw new Error('unavailable');
    text('network-today', bytes(s.today.outBytes));
    text('network-in', bytes(s.today.inBytes));
    text('network-rate', s.recent.outMbps === null ? '采样中' : `${Number(s.recent.outMbps).toFixed(2)} Mbps`);
    text('network-status', `${s.day} · ${s.today.partial ? '今日记录不完整，起点或采样存在缺口' : '从今日零点连续采样'} · 记录起点 ${new Date(s.today.coveredFrom * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间） · 数据更新 ${new Date(s.sampledAt).toLocaleTimeString('zh-CN')}。`);
  } catch {
    text('network-today', '—'); text('network-in', '—'); text('network-rate', '—');
    text('network-status', '整机流量采样暂不可用。下方进程分类仍可查看，但不代表公网实际用量。');
  }
}
const diagnosticLabels = { 'server-stall': '服务器停顿', 'send-queue': '发送积压 / 已限画面', 'player-latency': '前台玩家延迟升高', 'client-stall': '前台页面停顿' };
const decimal = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
function renderPerformance(d) {
  const r = d?.latest, peaks = d?.peak60 || {};
  $('perf-export').hidden = !d;
  if (!r) {
    text('perf-reading', d ? '正在收集第一秒的数据…' : '当前服务尚未安装卡顿记录功能。更新程序并重启后即可看到；原有流量统计仍可使用。');
    return;
  }
  text('perf-out', `${decimal(r.outMbps)} Mbps`);
  text('perf-out-peak', `一分钟内峰值：${decimal(peaks.outMbps)} Mbps`);
  text('perf-rtt', r.clientReports ? `${number(r.rttMaxMs)} ms` : '—');
  text('perf-reports', r.clientReports ? `最近收到 ${number(r.clientReports)} 个前台样本 · 一分钟最高 ${number(peaks.rttMaxMs)} ms` : '暂无前台样本，不代表玩家延迟为零');
  text('perf-loop', `${decimal(r.loopMaxMs)} ms`); text('perf-loop-peak', `一分钟内峰值：${decimal(peaks.loopMaxMs)} ms`);
  text('perf-queue', bytes(r.queueMaxBytes)); text('perf-queue-peak', `一分钟内峰值：${bytes(peaks.queueMaxBytes)}`);
  text('perf-cpu', `${decimal(r.cpuPercent)}%`); text('perf-busy', `${decimal(r.loopBusyPercent)}%`);
  text('perf-skipped', number(r.skippedSnapshots)); text('perf-client-stall', r.clientReports ? `${number(r.clientStallMaxMs)} ms` : '—');
  text('perf-sampled', `服务器采样时间 ${new Date(r.at).toLocaleTimeString('zh-CN')}`);
  const signals = [];
  if (r.loopMaxMs >= d.thresholds.loopMs) signals.push('服务器主线程出现停顿');
  if (r.queueMaxBytes >= d.thresholds.queueBytes || r.skippedSnapshots) signals.push('连接出现发送积压，已限制追加画面');
  if (r.clientReports && r.rttMaxMs >= d.thresholds.rttMs) signals.push('前台玩家延迟升高');
  if (r.clientReports && r.clientStallMaxMs >= d.thresholds.clientStallMs) signals.push('前台页面出现停顿');
  text('perf-reading', signals.length ? `本次采样：${signals.join('；')}。请结合下面同一时间的异常记录判断，单次采样不能确定根因。` : `本次采样未触发异常阈值。已保留 ${number(d.incidentCount)} 组异常，之前的卡顿仍可查看记录。`);
  const rows = document.createDocumentFragment();
  for (const incident of [...d.incidents].reverse()) {
    const tr = document.createElement('tr'), th = document.createElement('th');
    th.scope = 'row'; th.textContent = new Date(incident.at).toLocaleTimeString('zh-CN'); tr.append(th);
    const cells = [incident.reasons.map(k => diagnosticLabels[k] || k).join('、'), incident.clientReports ? `${number(incident.rttMaxMs)} ms` : '—',
      `${decimal(incident.loopMaxMs)} ms`, bytes(incident.queueMaxBytes), `${decimal(incident.outMbps)} Mbps`];
    for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    rows.append(tr);
  }
  if (!d.incidents.length) {
    const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 6;
    td.textContent = '尚未记录到异常。没有前台玩家样本时，不能据此判断所有玩家都正常。'; tr.append(td); rows.append(tr);
  }
  $('diagnostic-rows').replaceChildren(rows);
}
function render(s) {
  if (!s.traffic?.groups || typeof s.onlinePlayers !== 'number') throw new Error('当前游戏服务还没有安装这个统计功能。');
  renderPerformance(s.performance);
  for (const [id, key] of Object.entries({ 'online-players': 'onlinePlayers', 'online-rooms': 'roomsOnline', 'offline-rooms': 'roomsOffline', bots: 'bots', 'lobby-online': 'onlineInLobby', 'humans-online': 'onlineHumans', 'spectators-online': 'onlineSpectators', 'humans-offline': 'offlineHumans' })) text(id, number(s[key]));
  text('rooms-detail', `${number(s.rooms)} / ${number(s.waitingRooms)}`);
  text('matches-detail', `${number(s.matchesOnline)} / ${number(s.matchesOffline)}`);
  text('bots-detail', `${number(s.botsInOnlineRooms)} / ${number(s.botsInOfflineRooms)}`);
  text('sessions-detail', `${number(s.sockets)} / ${number(s.sessions)}`);
  const t = s.traffic, total = t.totals.gameOutBytes, windowSecs = Math.max(1, t.windowSecs);
  text('total-out', bytes(total));
  text('rate-out', `${bytes(t.totals.recentGameOutBytes / windowSecs)}/秒`);
  text('total-in', bytes(t.totals.inBytes));
  text('all-out', bytes(t.totals.outBytes));
  text('since', `统计起点：${new Date(t.startedAt).toLocaleString('zh-CN')} · 服务版本 ${s.app} · 重启后累计归零，最近速度按约 ${Math.round(windowSecs)} 秒计算。`);
  const rows = t.groups.filter(r => Object.hasOwn(labels, r.id)).sort((a, b) => b.total.outBytes - a.total.outBytes);
  const fragment = document.createDocumentFragment();
  for (const r of rows) {
    const tr = document.createElement('tr'), th = document.createElement('th');
    th.scope = 'row'; th.textContent = labels[r.id]; tr.append(th);
    const share = total ? 100 * r.total.outBytes / total : 0;
    const cells = [bytes(r.total.outBytes), `${share.toFixed(1)}%`, `${bytes(r.recent.outBytes / windowSecs)}/秒`, number(r.total.requests || r.total.messagesOut)];
    cells.forEach((value, i) => {
      const td = document.createElement('td'); td.textContent = value;
      if (i === 1) {
        td.className = 'share';
        const bar = document.createElement('div'), fill = document.createElement('span');
        bar.className = 'bar'; bar.setAttribute('aria-hidden', 'true'); fill.style.width = `${Math.min(100, share)}%`;
        bar.append(fill); td.append(bar);
      }
      tr.append(td);
    });
    fragment.append(tr);
  }
  $('traffic-rows').replaceChildren(fragment);
  const resource = t.groups.filter(r => ['images', 'models', 'audio', 'code', 'data', 'httpOther'].includes(r.id));
  const sum = field => resource.reduce((n, r) => n + r.total[field], 0);
  text('requests-detail', `${number(sum('requests'))} / ${number(sum('notModified'))}`);
  text('errors-detail', `${number(sum('errors'))} / ${number(sum('aborted'))}`);
  text('monitor-detail', bytes(t.groups.find(r => r.id === 'monitor')?.total.outBytes));
  const leader = rows[0];
  text('traffic-reading', total ? `当前进程记录最多的是“${labels[leader.id]}”，占内部计数的 ${(100 * leader.total.outBytes / total).toFixed(1)}%。此比例未包含 Caddy 直发素材，也未扣除外层压缩，不能用来判断公网资源占比。` : '当前进程尚未记录到正文或游戏消息。');
}
function schedule() {
  clearTimeout(timer);
  if ($('auto').checked && !document.hidden) timer = setTimeout(refresh, 10_000);
}
async function refresh() {
  if (loading) return;
  loading = true; $('refresh').disabled = true;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  const network = refreshNetwork(controller.signal);
  try {
    const response = await fetch('/stats-data', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）。请确认服务器已更新并重新启动。`);
    render(await response.json()); $('error').hidden = true;
    text('status', `上次更新 ${new Date().toLocaleTimeString('zh-CN')}`);
  } catch (e) {
    $('error').hidden = false;
    text('error', e.name === 'AbortError' ? '读取超时。请检查服务是否运行，再点“立即刷新”。' : e.message);
    text('status', '数据未更新；已显示的数字是上次结果。');
  } finally {
    await network;
    clearTimeout(timeout); loading = false; $('refresh').disabled = false; schedule();
  }
}
$('refresh').addEventListener('click', refresh);
$('auto').addEventListener('change', schedule);
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && $('auto').checked) refresh(); });
refresh();
