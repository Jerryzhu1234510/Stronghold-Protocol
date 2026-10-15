// Keep a playable view while the engine downloads. Separate hosts prevent a late
// engine from drawing over the fallback, and every pending completion is owned.
export function progressiveField(host, loadEngine, makeFallback, {
  onView = () => {}, signal, timeoutMs = 12000,
  setTimer = setTimeout, clearTimer = clearTimeout, warn = console.warn,
} = {}) {
  let closed = false, active = null, engineLayer = null, fallbackLayer = null;
  let resolveFirst, rejectFirst, delivered = false;
  const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const layer = () => {
    const el = host.ownerDocument.createElement('div');
    Object.assign(el.style, { position: 'absolute', inset: '0', visibility: 'hidden' });
    host.appendChild(el);
    return el;
  };
  const remove = el => { try { el?.remove(); } catch { /* detached host */ } };
  const destroy = view => { try { view?.destroy?.(); } catch { /* already disposed */ } };
  function dispose() {
    if (closed) return;
    closed = true;
    clearTimer(timer);
    signal?.removeEventListener('abort', dispose);
    destroy(active); active = null;
    remove(engineLayer); remove(fallbackLayer);
    if (!delivered) rejectFirst(new Error('field mount cancelled'));
  }
  function publish(view) {
    active = view;
    const managed = { ...view, destroy: dispose };
    if (!delivered) { delivered = true; resolveFirst(managed); }
    onView(managed);
  }
  function fallback() {
    if (closed || active) return;
    try {
      fallbackLayer = layer();
      const view = makeFallback(fallbackLayer);
      fallbackLayer.style.visibility = 'visible';
      publish(view);
    } catch (err) { rejectFirst(err); dispose(); }
  }
  const timer = setTimer(fallback, timeoutMs);
  if (signal?.aborted) { dispose(); return { first, dispose }; }
  signal?.addEventListener('abort', dispose, { once: true });
  engineLayer = layer();
  Promise.resolve().then(() => loadEngine(engineLayer)).then(view => {
    if (closed) { destroy(view); return; }
    clearTimer(timer);
    destroy(active); active = null;
    remove(fallbackLayer); fallbackLayer = null;
    engineLayer.style.visibility = 'visible';
    publish(view);
  }, err => {
    if (closed) return;
    clearTimer(timer);
    warn('[field] complete renderer unavailable; keeping simplified view:', err?.message || err);
    remove(engineLayer); engineLayer = null;
    fallback();
  });
  return { first, dispose };
}
