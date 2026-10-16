import { createHash } from 'node:crypto';

// Code and gameplay JSON participate in v0.3 content identities. Never transform
// their bytes in a proxy. HTML may route its imports to an immutable generation.
export function pinIdentityHtml(html, id) {
  const prefix = '/_build/' + id;
  html = html.replace(/(["'])(\/(?:assets|vendor|data|media|packs|fonts|sim|shared|js|css|sw\.js)[^"'\n]*)\1/g,
    (_, quote, value) => quote + prefix + value + quote);
  return html.replace('<head>', '<head><script src="' + prefix + '/__generation.js"></script>');
}

export function generationBootstrap(id) {
  const prefix = '/_build/' + id;
  return `(()=>{const p=${JSON.stringify(prefix)};window.__SP_GENERATION=${JSON.stringify(id)};
const f=window.fetch.bind(window);window.fetch=(input,init)=>{let u=new URL(input instanceof Request?input.url:input,location.href);
if(u.origin===location.origin&&!u.pathname.startsWith('/_build/')&&!u.pathname.startsWith('/__hot/')&&!u.pathname.startsWith('/api/')){u.pathname=p+u.pathname;input=input instanceof Request?new Request(u,input):u;}return f(input,init);};
const W=window.WebSocket;window.WebSocket=class extends W{constructor(url,protocols){const u=new URL(url,location.href);if(u.host===location.host&&u.pathname==='/ws')u.pathname=p+u.pathname;super(u.href,...(protocols===undefined?[]:[protocols]));}};})();`;
}

export function htmlCsp(policy, html) {
  if (!policy) return policy;
  const hashes = [...html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)]
    .map(m => "'sha256-" + createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64') + "'");
  return policy.replace(/script-src\s+[^;]+/, "script-src 'self'" + (hashes.length ? ' ' + hashes.join(' ') : ''));
}
