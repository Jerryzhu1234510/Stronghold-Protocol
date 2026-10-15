import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';

const DELAYS = [1000, 3000, 8000];

/** Retry transient image failures without changing URLs or bypassing either cache. */
export function useRetryImage(src) {
  const [failure, setFailure] = useState(null);
  const state = useRef({ src, attempts: 0 });
  if (state.current.src !== src) state.current = { src, attempts: 0 };
  const failed = !!src && failure?.src === src;
  useEffect(() => {
    if (!failed) return;
    // Spread retries across visible cards; missing files stop after three attempts.
    let hash = 0;
    for (const c of src) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    const delay = DELAYS[failure.attempt - 1];
    const retry = () => { if (state.current.src === src) setFailure(null); };
    const online = () => {
      if (state.current.src === src) { state.current.attempts = 0; retry(); }
    };
    const timer = delay == null ? null : setTimeout(retry, delay + hash % 301);
    globalThis.addEventListener?.('online', online);
    return () => { clearTimeout(timer); globalThis.removeEventListener?.('online', online); };
  }, [src, failed, failure]);
  return {
    ok: !!src && !failed,
    onError: () => {
      if (state.current.src === src) setFailure({ src, attempt: ++state.current.attempts });
    },
    onLoad: () => {
      if (state.current.src === src) { state.current.attempts = 0; setFailure(null); }
    },
  };
}
