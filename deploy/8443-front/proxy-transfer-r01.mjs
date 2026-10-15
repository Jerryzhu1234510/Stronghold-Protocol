import http from 'node:http';
import net from 'node:net';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';

export function acceptsGzip(value = '') {
  let gzip, wildcard;
  for (const part of String(value).split(',')) {
    const [name, ...parameters] = part.trim().toLowerCase().split(';');
    let q = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/.exec(parameter);
      if (match) q = Number(match[1]);
    }
    q = Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
    if (name.trim() === 'gzip' || name.trim() === 'x-gzip') gzip = q;
    if (name.trim() === '*') wildcard = q;
  }
  return (gzip ?? wildcard ?? 0) > 0;
}

function canCompress(req, response) {
  if (!['GET', 'HEAD'].includes(req.method) || response.statusCode !== 200 || req.headers.range) return false;
  const h = response.headers;
  if ((h['content-encoding'] && h['content-encoding'] !== 'identity') || h['content-range'] || h['set-cookie']) return false;
  if (/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(h['cache-control'] || '')
    || /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(req.headers['cache-control'] || '')) return false;
  const size = Number(h['content-length']);
  if (h['content-length'] != null && Number.isFinite(size) && size < 512) return false;
  let pathname;
  try { pathname = new URL(req.url, 'http://local').pathname; } catch { return false; }
  // Only public game assets. Account endpoints, diagnostics and event streams are never transformed.
  if (!/^\/(?:_build\/[a-zA-Z0-9_-]+\/)?(?:assets|vendor|data|media|packs|fonts|sim|shared|js|css)\//.test(pathname)) return false;
  const type = String(h['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'text/event-stream') return false;
  if (/^(?:image\/(?!svg\+xml)|audio\/|video\/)/.test(type)) return false;
  return /^text\/(?!event-stream)|(?:json|javascript|xml|wasm)$|^font\/(?:ttf|otf)$/.test(type)
    || /\.(?:json|atlas|skel|bin|wasm|svg|otf|ttf|js|mjs|css|html)$/i.test(pathname);
}

function varyEncoding(value) {
  const values = String(value || '').split(',').map(v => v.trim()).filter(Boolean);
  if (values.includes('*')) return '*';
  if (!values.some(v => v.toLowerCase() === 'accept-encoding')) values.push('Accept-Encoding');
  return [...new Map(values.map(v => [v.toLowerCase(), v])).values()].join(', ');
}

export function createProxyHandler({ host, port, headers, onError = () => {} }) {
  return function proxy(req, res) {
    let response;
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers: headers(req) }, reply => {
      response = reply;
      if (res.destroyed) { reply.destroy(); return; }
      const h = { ...reply.headers };
      const eligible = canCompress(req, reply);
      const compress = eligible && acceptsGzip(req.headers['accept-encoding']);
      if (eligible) h.vary = varyEncoding(h.vary);
      if (compress) {
        h['content-encoding'] = 'gzip';
        delete h['content-length'];
        delete h['content-md5'];
        delete h.digest;
        delete h['content-digest'];
        delete h['accept-ranges'];
        if (h.etag && !h.etag.startsWith('W/')) h.etag = 'W/' + h.etag;
      }
      res.writeHead(reply.statusCode || 502, h);
      // HEAD returns the same representation headers as GET, without a gzip body.
      if (req.method === 'HEAD') { reply.resume(); res.end(); return; }
      const done = error => {
        if (error) { upstream.destroy(); response?.destroy(); }
      };
      if (compress) pipeline(reply, createGzip({ level: 6 }), res, done);
      else pipeline(reply, res, done);
    });
    const cancel = () => { upstream.destroy(); response?.destroy(); };
    req.once('aborted', cancel);
    req.once('error', cancel);
    res.once('close', () => { if (!res.writableFinished) cancel(); });
    upstream.once('error', error => {
      if (res.destroyed) return;
      onError(error);
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('服务器暂时无法连接，请稍后重试。');
    });
    req.pipe(upstream);
  };
}

export function createUpgradeHandler({ host, port }) {
  return function upgrade(req, socket, head) {
    const upstream = net.connect(port, host, () => {
      if (socket.destroyed) { upstream.destroy(); return; }
      let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        if (['x-forwarded-proto', 'x-forwarded-for'].includes(key.toLowerCase())) continue;
        raw += key + ': ' + req.rawHeaders[i + 1] + '\r\n';
      }
      raw += 'X-Forwarded-Proto: https\r\nX-Forwarded-For: ' + (socket.remoteAddress || '') + '\r\n\r\n';
      upstream.write(raw);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    socket.setNoDelay(true); upstream.setNoDelay(true);
    socket.once('error', () => upstream.destroy());
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.once('close', () => socket.destroy());
  };
}
