import net from 'node:net';
export function gatewayHeaders(req) {
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const localProxy = peer === '::1' || /^127\./.test(peer);
  let address = peer;
  // The existing HTTPS proxy appends its actual peer. Ignore any client-supplied prefix.
  if (localProxy && typeof req.headers['x-forwarded-for'] === 'string') {
    const candidate = req.headers['x-forwarded-for'].split(',').at(-1).trim();
    if (net.isIP(candidate)) address = candidate;
  }
  const headers = { ...req.headers, 'x-forwarded-for': address, 'accept-encoding': 'identity' };
  delete headers['cf-connecting-ip']; delete headers['x-real-ip']; delete headers['x-forwarded-host'];
  headers['x-forwarded-proto'] = localProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return headers;
}
