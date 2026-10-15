// Public immutable media only. Never forward a game cookie or authorization header.
export function resourceCdnUrl(item) {
  if (!/^[a-f0-9]{64}$/.test(item?.hash) || !(item.bytes > 0 && item.bytes <= 32 * 1024 * 1024)) return null;
  try {
    const url = new URL(item.cdn);
    return url.origin === 'https://assets.weishuxieyi.icu' && url.pathname.startsWith('/pilot/')
      && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

export function createResourceTransport({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000, cooldownMs = 30000 } = {}) {
  const blocked = new Map();
  const counters = { attempts: 0, downloads: 0, bytes: 0, failures: 0, fallbacks: 0 };
  const origin = async request => ({ response: await fetchImpl(request), verified: false });
  return {
    status: () => ({ ...counters, retryInMs: Math.max(0, ...[...blocked.values()].map(at => at - now())) }),
    async fetch(request, item) {
      const url = resourceCdnUrl(item);
      if (!url) return origin(request);
      if (now() < (blocked.get(url) || 0)) { counters.fallbacks++; return origin(request); }
      blocked.delete(url);
      const controller = new AbortController();
      const cancel = () => controller.abort(request.signal.reason);
      if (request.signal.aborted) cancel();
      else request.signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('Resource CDN timed out')), timeoutMs);
      counters.attempts++;
      try {
        const response = await fetchImpl(new Request(url, {
          method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
          cache: request.cache === 'reload' ? 'reload' : 'default',
          referrerPolicy: 'no-referrer', signal: controller.signal,
        }));
        if (response.status !== 200 || response.type === 'opaque') throw new Error('Resource CDN unavailable');
        const body = await response.arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (body.byteLength !== item.bytes || digest !== item.hash) throw new Error('Resource CDN content mismatch');
        const headers = new Headers(response.headers);
        headers.delete('content-encoding'); headers.set('content-length', String(body.byteLength));
        headers.set('x-sp-resource-source', 'r2');
        counters.downloads++; counters.bytes += body.byteLength;
        // A synthetic response keeps relative atlas texture URLs on the original game path.
        return { response: new Response(body, { status: 200, headers }), verified: true };
      } catch {
        if (request.signal.aborted) throw request.signal.reason;
        counters.failures++; counters.fallbacks++; blocked.set(url, now() + cooldownMs);
        if (blocked.size > 256) blocked.delete(blocked.keys().next().value);
        return origin(request);
      } finally {
        clearTimeout(timer); request.signal.removeEventListener('abort', cancel);
      }
    },
  };
}
