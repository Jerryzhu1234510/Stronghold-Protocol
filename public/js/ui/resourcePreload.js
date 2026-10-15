import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { cacheSupported, resourceCacheAction } from '../resources/client.js';
import { startResourcePreload } from '../resources/preload.js';
import { MANUAL_PRELOAD_CONCURRENCY } from '../resources/policy.js';

const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

export function ResourcePreloadButton() {
  const [open, setOpen] = useState(false), [status, setStatus] = useState(null), [running, setRunning] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const stop = useRef(null), root = useRef(null), alive = useRef(true), starting = useRef(false);
  const supported = cacheSupported(), plan = status?.preload;
  const complete = plan?.state === 'complete';
  const percent = plan?.totalBytes ? Math.floor(plan.completedBytes / plan.totalBytes * 100) : 0;
  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    const refresh = () => resourceCacheAction().then(value => { if (alive) { setStatus(value); setError(''); } })
      .catch(err => { if (alive) setError(err.message); });
    void refresh();
    const timer = setInterval(() => { if (!stop.current) void refresh(); }, 5000);
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    addEventListener('pointerdown', outside);
    return () => { alive = false; stop.current?.(); clearInterval(timer); removeEventListener('pointerdown', outside); };
  }, [supported]);
  useEffect(() => () => { alive.current = false; }, []);
  const toggle = async () => {
    if (starting.current) return;
    if (stop.current) { stop.current(); stop.current = null; setRunning(false); return; }
    starting.current = true;
    setBusy(true); setError('');
    try {
      if (status?.enabled === false) await resourceCacheAction('enable', { enabled: true });
      if (!alive.current) return;
      // No simultaneous loop when the double-click falls before registration finishes.
      setRunning(true);
      stop.current = startResourcePreload({ enabled: true, manual: true, concurrency: MANUAL_PRELOAD_CONCURRENCY,
        canDownload: () => document.visibilityState === 'visible',
        onStatus: value => {
          setStatus(value); setError('');
          if (value.preload?.state === 'complete' || !value.enabled) { stop.current?.(); stop.current = null; setRunning(false); }
          else if (value.preload?.state === 'retry') setError('下载或保存失败，稍后重试；请检查网络和存储空间');
        }, onError: err => setError(err.message) });
    } catch (err) { setError(err.message); setRunning(false); }
    finally { starting.current = false; if (alive.current) setBusy(false); }
  };
  return html`<div ref=${root} class="resource-preload" onKeyDown=${e => { if (e.key === 'Escape') setOpen(false); }}>
    <button type="button" class="resource-preload__button" aria-expanded=${open} aria-controls="resource-preload-panel" onClick=${() => setOpen(!open)}>
      <${Icon} name=${complete ? 'check' : running ? 'download' : 'chevronRight'}/>
      <span>${complete ? '预加载完成' : running ? `预加载 ${percent}%` : plan?.completed ? '继续预加载' : '资源预加载'}</span>
    </button>
    ${open && html`<section id="resource-preload-panel" class="resource-preload__panel" aria-label="资源预加载">
      <header><b>资源预加载</b><button type="button" aria-label="关闭资源预加载" onClick=${() => setOpen(false)}><${Icon} name="close"/></button></header>
      ${supported && plan?.total ? html`<progress value=${plan.completedBytes} max=${plan.totalBytes} aria-label="资源下载进度"></progress>
        <p role="status">${plan.completed}/${plan.total} · ${mb(plan.completedBytes)} / ${mb(plan.totalBytes)}</p>
        <p>${complete ? '全部素材已缓存' : running ? '正在下载' : plan.completed ? '已暂停，可继续下载' : '等待下载'}</p>` : null}
      <p class="resource-preload__error" role="status">${!supported ? '当前网址或浏览器不支持缓存，请使用 HTTPS 或本机 localhost。' : error}</p>
      ${supported && !complete && html`<button type="button" class="resource-preload__start" disabled=${busy || !status || !plan?.total} onClick=${toggle}>
        <${Icon} name=${running ? 'pause' : 'download'}/>${running ? '暂停下载' : '开始下载'}
      </button>`}
    </section>`}
  </div>`;
}
