import { isIP } from 'node:net';

const normalize = value => typeof value === 'string' ? value.toLowerCase().replace(/\.$/, '') : '';
export function createDomainGuard({ domain, port = 8443 }) {
  const name = normalize(domain);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) || name.includes('..') || isIP(name)) throw Error('Invalid entry domain');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid entry port');
  const origin = 'https://' + name + (port === 443 ? '' : ':' + port);
  function hostMatches(req, expectedPort) {
    const value = req.headers?.host;
    if (typeof value !== 'string') return false;
    if (req.rawHeaders) {
      let hosts = 0;
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'host') hosts++;
      if (hosts !== 1) return false;
    }
    const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(value);
    return !!match && normalize(match[1]) === name && (!match[2] || match[2] === String(expectedPort));
  }
  const servernameMatches = value => normalize(value) === name;
  function allows(req, { tls = true, expectedPort = port } = {}) {
    return hostMatches(req, expectedPort)
      && (!tls || req.socket?.encrypted === true && servernameMatches(req.socket.servername))
      && typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//');
  }
  function reject(req, res) {
    const body = Buffer.from('请使用 ' + origin + '/ 访问。');
    res.writeHead(421, { 'Content-Type':'text/plain; charset=utf-8', 'Content-Length':body.length,
      'Cache-Control':'no-store', 'Connection':'close', 'X-Content-Type-Options':'nosniff', 'X-SP-Domain-Guard':'r01' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  function upgrade(handler) {
    return (req, socket, head) => {
      if (!allows(req)) { socket.end('HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\nContent-Length: 0\r\nX-SP-Domain-Guard: r01\r\n\r\n'); return; }
      handler(req, socket, head);
    };
  }
  return { origin, hostMatches, servernameMatches, allows, reject, upgrade };
}
