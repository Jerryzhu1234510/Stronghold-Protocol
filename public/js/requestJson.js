// Bound the complete transfer, including response bodies. Racing also handles a
// custom fetch that ignores AbortSignal; its late result never replaces a retry.
export function requestJson(url, {
  fetchFn = (...args) => globalThis.fetch(...args), cache = 'no-cache',
  timeoutMs = 30000, signal, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const controller = new AbortController();
  let timer, rejectBound;
  const bound = new Promise((_, reject) => { rejectBound = reject; });
  const cancel = reason => { rejectBound(reason); controller.abort(reason); };
  const abort = () => cancel(signal.reason || new Error('request cancelled'));
  if (signal?.aborted) { abort(); return bound; }
  signal?.addEventListener('abort', abort, { once: true });
  if (timeoutMs > 0) timer = setTimer(() => cancel(Object.assign(new Error(`timeout: ${url}`), { timeout: true })), timeoutMs);
  const run = Promise.resolve().then(async () => {
    const res = await fetchFn(url, { cache, signal: controller.signal });
    if (!res?.ok) {
      await res?.body?.cancel?.();
      throw Object.assign(new Error(`HTTP ${res?.status ?? '???'}`), { status: res?.status });
    }
    try { return await res.json(); }
    catch (err) {
      // AbortError / TypeError during a transfer is retryable, not malformed JSON.
      if (err?.name === 'SyntaxError') err.badJson = true;
      throw err;
    }
  });
  return Promise.race([run, bound]).finally(() => {
    clearTimer(timer);
    signal?.removeEventListener('abort', abort);
  });
}
