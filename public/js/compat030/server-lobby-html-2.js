// i18n-ignore-file: retained standalone Chinese portal/bootstrap configuration, outside the translated game UI.
(() => {
  'use strict';
  const config = window.SP_LOBBY_CONFIG;
  if (!config || !Array.isArray(config.nodes)) return;
  const byId = id => document.getElementById(id);
  const safeUrl = value => { try { const u = new URL(value); return (u.protocol === 'https:' || u.protocol === 'http:' && u.origin === location.origin) && !u.username && !u.password ? u.href : null; } catch { return null; } };
  const localPreview = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
  const ownNode = config.nodes.find(node => node.id === '8443');
  if (ownNode) {
    ownNode.displayUrl = localPreview ? ownNode.url : location.origin;
    ownNode.url = location.origin + '/game.html';
    ownNode.ping = location.origin + '/healthz';
    config.statusEndpoint = ownNode.ping;
  }
  if (localPreview) config.nodes[0].ping = '';
  for (const node of config.nodes) {
    const url = new URL(node.url);
    if (url.origin === location.origin && /^\/(?:index\.html)?$/.test(url.pathname)) node.url = url.origin + '/game.html';
  }
  const nodes = config.nodes.filter(n => /^(8443|icu)$/.test(n.id) && safeUrl(n.url));
  let snapshot = {}, busy = false, lastRefresh = 0, toastTimer, randomId;
  const storageKey = 'sp-lobby:last-server:v1';
  const count = n => Number.isSafeInteger(n) && n >= 0 ? n.toLocaleString('zh-CN') : '—';
  const toast = message => { clearTimeout(toastTimer); byId('toast').textContent = message; byId('toast').hidden = false; toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 3500); };
  function remember(id) { try { localStorage.setItem(storageKey, id); } catch {} markLast(id); }
  function markLast(id) { nodes.forEach(n => { byId('last-' + n.id).hidden = n.id !== id; }); }
  nodes.forEach(n => {
    const title = byId('name-' + n.id);
    title.firstChild.textContent = n.name + ' ';
    title.closest('.server-name').querySelector('p').textContent = new URL(n.displayUrl || n.url).host;
    document.querySelectorAll('[data-enter="' + n.id + '"]').forEach(a => {
      a.href = n.url; a.querySelector('span').textContent = '进入 ' + n.name;
      a.addEventListener('click', () => remember(n.id));
    });
  });
  const notice = document.querySelector('.notice-card > p');
  if (nodes.length === 2) {
    notice.replaceChildren();
    nodes.forEach((n, i) => { if (i) notice.append(' 与 '); const strong = document.createElement('strong'); strong.textContent = n.name; notice.append(strong); });
    notice.append(' 已接入联机大厅。查看站点状态，选择你的目的地，开启下一场对局。');
  }
  try { markLast(localStorage.getItem(storageKey)); } catch {}
  byId('qq-number').textContent = String(config.qq || '561101140');
  byId('copy-qq').setAttribute('aria-label', '复制 QQ 交流群号 ' + byId('qq-number').textContent);
  byId('copy-qq').addEventListener('click', async () => {
    const qq = byId('qq-number').textContent;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(qq); toast('群号已复制：' + qq);
    } catch {
      const range = document.createRange(); range.selectNodeContents(byId('qq-number'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      toast('群号：' + qq + '，请长按或按 Ctrl+C 复制');
    }
  });
  function renderStatus(data) {
    snapshot = data && typeof data.nodes === 'object' ? data.nodes : {};
    let known = 0, total = 0, onlineNodes = 0;
    nodes.forEach(n => {
      const s = snapshot[n.id] || {};
      const healthy = s.state === 'online', reachable = s.state === 'reachable';
      if (healthy) onlineNodes++;
      const el = byId('state-' + n.id), dot = document.createElement('span');
      dot.className = 'status-dot' + (healthy || reachable ? '' : ' unknown');
      el.replaceChildren(dot, document.createTextNode(healthy ? '在线' : reachable ? '可访问' : '状态未知'));
      for (const metric of ['online', 'rooms', 'matches', 'waiting']) byId(metric + '-' + n.id).textContent = count(s[metric]);
      if (Number.isSafeInteger(s.online) && s.online >= 0) { known++; total += s.online; }
      byId('info-' + n.id).textContent = s.partial ? '部分版本暂未返回，人数仅含已确认版本' : healthy ? '站点运行中 · 数据约每 30 秒更新' : reachable ? '站点可访问 · 暂未提供人数数据' : '暂未获取状态 · 仍可尝试进入';
    });
    byId('total-online').textContent = known ? count(total) : '—';
    byId('total-label').textContent = known === nodes.length ? '当前在线玩家' : known ? '已确认在线玩家' : '暂未获取人数';
    const summary = byId('status-summary'), dot = document.createElement('span');
    dot.className = 'status-dot' + (onlineNodes === nodes.length ? '' : ' unknown');
    summary.replaceChildren(dot, document.createTextNode(onlineNodes === nodes.length ? '全部节点状态正常' : onlineNodes ? onlineNodes + ' 个节点已确认在线' : '站点状态暂不可用'));
  }
  async function latency(n) {
    const el = byId('latency-' + n.id), started = performance.now();
    try {
      const url = safeUrl(n.ping);
      if (!url) throw new Error('no ping');
      const r = await fetch(url, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(6500) });
      if (r.type !== 'opaque' && !r.ok) throw new Error('ping unavailable');
      const ms = Math.max(1, Math.round(performance.now() - started));
      el.querySelector('span').textContent = ms.toLocaleString('zh-CN') + ' ms';
      el.classList.toggle('slow', ms > 300); el.classList.remove('unknown');
    } catch { el.querySelector('span').textContent = '未测得'; el.classList.add('unknown'); el.classList.remove('slow'); }
  }
  async function ownStatus() {
      const endpoint = safeUrl(config.statusEndpoint);
      if (!endpoint) throw new Error('no endpoint');
      const r = await fetch(endpoint, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('unavailable');
      let result = await r.json();
      if (!result.nodes && new URL(endpoint).origin === location.origin) {
        try {
          const hot = await fetch('/__hot/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) }).then(response => {
            if (!response.ok) throw new Error('no hot gateway');
            return response.json();
          });
          const versions = hot.versions.filter(version => version.healthy && /^[a-zA-Z0-9_-]{1,64}$/.test(version.id));
          if (!versions.length) throw new Error('no healthy releases');
          const health = await Promise.all(versions.map(version => fetch('/_build/' + version.id + '/healthz', {
            cache: 'no-store', signal: AbortSignal.timeout(4000)
          }).then(async response => {
            if (!response.ok) throw new Error('release unavailable');
            const value = await response.json();
            if (!value.ok) throw new Error('release unhealthy');
            return value;
          })));
          const totals = { ok: true, onlinePlayers: 0, roomsOnline: 0, matchesOnline: 0, waitingRooms: 0 };
          for (const value of health) for (const key of ['onlinePlayers', 'roomsOnline', 'matchesOnline', 'waitingRooms']) {
            if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error('invalid population');
            totals[key] += value[key];
          }
          result = totals;
        } catch { /* Direct servers and local previews keep their own health counts. */ }
      }
      return result.nodes?.icu || { state: result.ok ? 'online' : 'unknown', online: result.onlinePlayers, rooms: result.roomsOnline, matches: result.matchesOnline, waiting: result.waitingRooms };
  }
  async function nodeStatus(node) {
    if (node.id === 'icu') return ownStatus();
    const endpoint = safeUrl(node.statusEndpoint);
    if (!endpoint) throw new Error('no node status endpoint');
    const response = await fetch(endpoint, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('node status unavailable');
    const result = await response.json();
    // The friend server also reports icu; use only its own node to avoid double counting.
    const status = result.nodes?.[node.id];
    if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('missing node status');
    return status;
  }
  async function refresh(manual = false) {
    if (busy || Date.now() - lastRefresh < 5000) return;
    busy = true; lastRefresh = Date.now();
    const button = byId('refresh-status'); button.disabled = true; button.classList.add('is-loading');
    try {
      const results = await Promise.allSettled(nodes.map(nodeStatus));
      const status = {};
      results.forEach((result, i) => { if (result.status === 'fulfilled') status[nodes[i].id] = result.value; });
      renderStatus({ nodes: status });
      if (manual) toast(Object.keys(status).length ? '站点状态已刷新' : '暂时无法获取状态，选服入口仍可使用');
    } finally { await Promise.allSettled(nodes.map(latency)); busy = false; button.disabled = false; button.classList.remove('is-loading'); }
  }
  byId('refresh-status').addEventListener('click', () => { void refresh(true); });
  const dialog = byId('random-dialog');
  function selectRandom() {
    let eligible = nodes.filter(n => snapshot[n.id]?.state === 'online');
    if (!eligible.length) eligible = nodes;
    if (eligible.length > 1 && randomId) eligible = eligible.filter(n => n.id !== randomId);
    const n = eligible[Math.floor(Math.random() * eligible.length)]; if (!n) return;
    randomId = n.id; byId('random-title').textContent = '这次，去 ' + n.name + '。';
    const a = byId('random-enter'); a.href = n.url; a.querySelector('span').textContent = '进入 ' + n.name;
  }
  byId('random-server').addEventListener('click', () => { selectRandom(); dialog.showModal(); });
  byId('random-again').addEventListener('click', selectRandom);
  byId('random-enter').addEventListener('click', () => remember(randomId));
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) { const b = dialog.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dialog.close(); } });
  document.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('is-active', link === a)); }));
  renderStatus(null); void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastRefresh > 30000) void refresh(); });
})();
