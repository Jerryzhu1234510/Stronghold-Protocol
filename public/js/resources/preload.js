import { cacheSupported, resourceCacheAction, networkPreloadAllowed } from './client.js';
import { preloadConcurrency } from './policy.js';

// Pages keep a bounded worker queue supplied. A closed/suspended browser cannot be forced to run.
export function startResourcePreload({ enabled = false, canDownload = () => true, action = resourceCacheAction,
  supported = cacheSupported, schedule = setTimeout, cancel = clearTimeout, random = Math.random,
  manual = false, concurrency = 1, onStatus = () => {}, onError = () => {} } = {}) {
  // Bulk downloads must be explicitly scheduled after capacity controls are in place.
  // Content requested by the game continues to be cached normally.
  if (!enabled || !networkPreloadAllowed() || !supported()) return () => {};
  let stopped = false, timer, currentWarmId = null;
  const cancelWarm = () => {
    if (currentWarmId) void action('warm.stop', { warmId: currentWarmId }).catch(() => {});
  };
  const visibilityChanged = () => { if (!canDownload()) cancelWarm(); };
  if (manual) globalThis.document?.addEventListener('visibilitychange', visibilityChanged);
  const later = delay => { if (!stopped) timer = schedule(tick, delay); };
  async function tick() {
    if (stopped) return;
    if (!networkPreloadAllowed()) { stopped = true; cancelWarm(); return; }
    if (!canDownload() || globalThis.navigator?.onLine === false) { later(5000); return; }
    try {
      const extra = manual ? { manual: true } : {};
      if (manual && concurrency > 1) {
        extra.concurrency = preloadConcurrency(concurrency);
        // One ticket per message lets pause stop refill without cancelling media already needed by a game.
        extra.warmId = globalThis.crypto?.randomUUID?.() || `warm-${Date.now()}-${random()}`;
        currentWarmId = extra.warmId;
      }
      const status = await action('warm', extra);
      currentWarmId = null;
      if (stopped) return;
      onStatus(status);
      const state = status.preload?.state;
      if (manual && state === 'complete') return;
      // Explicit lobby downloads run at network speed; background scheduling stays paced.
      const pace = manual ? 0 : Math.max(100, Math.ceil((status.preload?.downloadedBytes || 0) / 131072 * 1000));
      later(!status.enabled || state === 'complete' ? 60000 : state === 'paused' ? (manual ? 1000 : 60000)
        : state === 'retry' ? 30000 : pace);
    } catch (error) { cancelWarm(); currentWarmId = null; if (!stopped) { onError(error); later(10000); } }
  }
  later(manual ? 0 : 5000 + Math.floor(random() * 10000)); // Spread automatic reconnect bursts across clients.
  return () => {
    if (stopped) return;
    stopped = true; cancel(timer); cancelWarm();
    if (manual) globalThis.document?.removeEventListener('visibilitychange', visibilityChanged);
  };
}
