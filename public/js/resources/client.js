import { isBundledClient } from './manifest.js';
let starting;
// Every document on 8443, including child frames and auxiliary pages, must choose
// the same worker policy. A missing HTML flag must never downgrade its scope.
export const localResourcesRequired = () => (globalThis.__SP_LOCAL_RESOURCES_REQUIRED === true
  || globalThis.location?.hostname?.toLowerCase() === 'weishuxieyiwangye.cn') && !isBundledClient();
const worker = new URL('./worker.js', import.meta.url);
// The policy is part of the worker identity, so suspension/restart cannot reset it.
if (localResourcesRequired()) worker.searchParams.set('localOnly', '1');
const workerUrl = worker.href;
const startupError = message => Object.assign(new Error(message), { code: 'LOCAL_RESOURCES_REQUIRED' });

// A still-open legacy auxiliary page can register the older network-enabled
// worker over this scope. Restore the required identity without deleting data.
let restoring = false;
function restoreRequiredWorker() {
  const controller = globalThis.navigator?.serviceWorker?.controller;
  if (!localResourcesRequired() || !controller || controller.scriptURL === workerUrl || restoring) return;
  restoring = true; starting = undefined;
  Promise.resolve().then(startResourceCache).catch(() => null).finally(() => { restoring = false; });
}
globalThis.navigator?.serviceWorker?.addEventListener?.('controllerchange', restoreRequiredWorker);
globalThis.document?.addEventListener?.('visibilitychange', restoreRequiredWorker);

export async function requireLocalResourceController() {
  if (!localResourcesRequired()) return;
  if (!cacheSupported() || !await waitForResourceController({ timeoutMs: 20000 })) {
    throw startupError('本地素材读取组件尚未接管，请重新加载；若仍失败，请使用正常模式的新版浏览器或完整版客户端。');
  }
  const result = await resourceCacheAction('local-ready');
  if (!result.localOnly) throw startupError('本地素材读取组件版本不符，请重新加载后再进入。');
  // An inventory entry alone does not prove this document can read the imported bytes.
  const probe = await fetch(new URL('../../assets/ui/settle/settlemen_personal_success.png', workerUrl), { cache: 'reload' });
  const hit = probe.ok && probe.headers.get('x-sp-resource-cache') === 'HIT';
  if (!hit) { await probe.body?.cancel(); throw startupError('未能实际读取已导入素材，请回到选服大厅重新检查并补导；无需清空原资源库。'); }
  await probe.arrayBuffer();
}

// History-only URL pinning does not move a document into a service worker's scope.
export function resourceDocumentUrl(href, navigationUrl, generation) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(generation || '') || !navigationUrl) return null;
  try {
    const current = new URL(href), navigation = new URL(navigationUrl);
    const prefix = '/_build/' + generation;
    if (!/^https?:$/.test(current.protocol) || current.origin !== navigation.origin
      || !['/', '/index.html', '/game.html', '/versus.html'].includes(navigation.pathname)) return null;
    if (!current.pathname.startsWith(prefix + '/')) return null;
    return current.href;
  } catch { return null; }
}

export function waitForResourceController({ timeoutMs = 2500, serviceWorker = globalThis.navigator?.serviceWorker,
  register = startResourceCache, expectedUrl = workerUrl } = {}) {
  if (!serviceWorker?.addEventListener) return Promise.resolve(false);
  const controlled = () => serviceWorker.controller?.scriptURL === expectedUrl;
  if (controlled()) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      serviceWorker.removeEventListener('controllerchange', changed); resolve(ready);
    };
    const changed = () => { if (controlled()) finish(true); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    serviceWorker.addEventListener('controllerchange', changed);
    Promise.resolve().then(register).then(registration => {
      if (!registration) finish(false); else changed();
    }, () => finish(false));
    changed();
  });
}

export function cacheSupported() {
  return !!(globalThis.isSecureContext && globalThis.navigator?.serviceWorker && globalThis.navigator?.locks && globalThis.caches && globalThis.crypto?.subtle);
}
export function startResourceCache() {
  // CDN transport does not require Web Locks or persistent cache storage.
  if (!(globalThis.isSecureContext && globalThis.navigator?.serviceWorker && globalThis.crypto?.subtle)) return Promise.resolve(null);
  return starting ??= navigator.serviceWorker.register(workerUrl, {
    type: 'module', scope: new URL('../../', import.meta.url).pathname,
  }).catch(() => { starting = undefined; return null; });
}
export async function resourceCacheAction(action = 'status', extra = {}) {
  const registration = await startResourceCache();
  if (!registration) throw new Error('当前环境无法使用素材缓存');
  if (!registration.active) {
    await new Promise((resolve, reject) => {
      const pending = registration.installing || registration.waiting;
      if (!pending) { reject(new Error('素材缓存正在初始化，请稍后再试')); return; }
      const finish = () => {
        if (pending.state !== 'activated' && pending.state !== 'redundant') return;
        clearTimeout(timer); pending.removeEventListener('statechange', finish); resolve();
      };
      const timer = setTimeout(() => { pending.removeEventListener('statechange', finish); reject(new Error('素材缓存初始化超时')); }, 8000);
      pending.addEventListener('statechange', finish); finish();
    });
  }
  const worker = registration.active;
  if (!worker) throw new Error('素材缓存正在初始化，请稍后再试');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    // A bounded manual window can still be finishing a large file. Status and control replies stay short.
    const timeout = action === 'warm' && extra.manual === true ? 45000 : 10000;
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('素材缓存暂不可用')); }, timeout);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.ok) resolve(event.data); else reject(new Error('浏览器无法保存素材，请检查存储空间'));
    };
    worker.postMessage({ action, ...extra }, [channel.port2]);
  });
}
