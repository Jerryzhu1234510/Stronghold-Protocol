import { unhashedUrl } from '../../../shared/assetPaths.js';

export function isBundledClient() {
  return typeof globalThis.SPAndroidResources?.getManifest === 'function' || typeof globalThis.window?.SPAndroidResources?.getManifest === 'function' || /(?:SPDesktop|SPAndroid|StrongholdAndroid)\//.test(globalThis.navigator?.userAgent || '') || !!globalThis.window?.chrome?.webview;
}

// Shipped native shells index bundled files by plain path. Web hot updates must keep reusing those files.
export function manifestForNative(value, native = isBundledClient()) {
  if (!native) return value;
  if (typeof value === 'string') return unhashedUrl(value);
  if (Array.isArray(value)) return value.map(v => manifestForNative(v, true));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,v]) => [key, manifestForNative(v, true)]));
}
