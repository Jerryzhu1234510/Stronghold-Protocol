import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// Only server-confirmed reconnect tokens can share a place. Never persist raw tokens.
export class SessionCap {
  constructor({ limit = 100, graceMs = 20000, now = Date.now } = {}) {
    this.limit = limit; this.graceMs = graceMs; this.now = now;
    this.seats = new Map(); this.refused = 0;
  }
  key(token, route) { return typeof token === 'string' && token.length <= 64 ? createHash('sha256').update(route + ':' + token).digest('hex') : null; }
  prune() { for (const [key, seat] of this.seats) if (!seat.holders.size && seat.until <= this.now()) this.seats.delete(key); }
  reserve(token, route) {
    this.prune();
    const known = this.key(token, route), key = known && this.seats.has(known) ? known : randomUUID();
    if (this.limit > 0 && !this.seats.has(key) && this.seats.size >= this.limit) { this.refused++; return null; }
    const seat = this.seats.get(key) || { holders: new Set(), until: 0 };
    const lease = { key, id: randomUUID(), confirmed: false };
    seat.holders.add(lease.id); this.seats.set(key, seat); return lease;
  }
  confirm(lease, token, route) {
    if (!lease || lease.released) return;
    const key = this.key(token, route); if (!key) return;
    const old = this.seats.get(lease.key), target = this.seats.get(key);
    if (old) { old.holders.delete(lease.id); if (!old.holders.size) this.seats.delete(lease.key); }
    const seat = target || { holders: new Set(), until: 0 };
    seat.holders.add(lease.id); seat.until = 0; this.seats.set(key, seat);
    lease.key = key; lease.confirmed = true;
  }
  release(lease) {
    if (lease) lease.released = true;
    if (!lease) return; const seat = this.seats.get(lease.key); if (!seat) return;
    seat.holders.delete(lease.id);
    if (!seat.holders.size) { if (lease.confirmed) seat.until = this.now() + this.graceMs; else this.seats.delete(lease.key); }
  }
  status() {
    this.prune(); return { limit: this.limit, online: [...this.seats.values()].filter(s => s.holders.size).length,
      reserved: this.seats.size, reconnectGraceSeconds: this.graceMs / 1000, refused: this.refused, unlimited: this.limit === 0, full: this.limit > 0 && this.seats.size >= this.limit };
  }
}

export function createCappedUpgradeHandler({ host, port, wsModule, cap = new SessionCap(), metrics, authorizeNewRoom }) {
  const { WebSocket, WebSocketServer } = createRequire(import.meta.url)(wsModule);
  const compression = { threshold: 2048, concurrencyLimit: 2, serverNoContextTakeover: true, clientNoContextTakeover: true,
    zlibDeflateOptions: { level: 1, memLevel: 7 } };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: compression, clientTracking: true });
  wss.on('error', () => {});
  const handler = (req, socket, head) => {
    socket.on('error', () => {});
    const route = new URL(req.url, 'http://local').pathname;
    if (!/^\/(?:_build\/[A-Za-z0-9_-]+\/)?ws$/.test(route)) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    try { wss.handleUpgrade(req, socket, head, front => {
      let back, lease, queue = [], queueBytes = 0, timer, wireAt = socket.bytesWritten, preHelloAt = Date.now(), preHelloCount = 0;
      let ended = false;
      const active = () => !ended && front.readyState === WebSocket.OPEN;
      let alive = true;
      front.on('pong', () => { alive = true; });
      const heartbeat = setInterval(() => { if (!alive) { front.terminate(); return; } alive = false; if (front.readyState === WebSocket.OPEN) front.ping(); }, 15000); heartbeat.unref();
      const wire = () => { const n = socket.bytesWritten - wireAt; wireAt = socket.bytesWritten; metrics?.add('game', n); };
      const send = (ws, data, binary = false) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 8 * 1024 * 1024) { ws.terminate(); return; }
        ws.send(data, { binary }, error => { if (ws === front) wire(); if (error) ws.terminate(); });
      };
      const close = (ws, code, reason) => {
        if (!ws) return;
        if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
        else if (ws.readyState === WebSocket.OPEN) ws.close(code >= 1000 && code !== 1005 && code !== 1006 ? code : 1011, reason?.subarray?.(0, 120));
      };
      timer = setTimeout(() => front.close(4002, 'hello timeout'), 30000); timer.unref();
      const receive = async (data, binary) => {
        if (!active()) return;
        if (authorizeNewRoom && !binary) {
          let message;try{message=JSON.parse(data.toString());}catch{}
          if (['room.create','room.join','room.start','room.spectate','room.matchmake','room.matchmakeParty','room.ready'].includes(message?.t)) {
            let allowed=false;try{allowed=await authorizeNewRoom(req,route);}catch{}
            if (!active()) return;
            if(!allowed){send(front,JSON.stringify({t:'error',code:'ENTRY_REQUIRED',rid:message.rid,msg:'本局结束后，请从网页选服大厅检查资源后重进，或到QQ群1095895855群文件下载电脑端。'}));return;}
          }
        }
        if (!back) {
          if (Date.now() - preHelloAt >= 1000) { preHelloAt = Date.now(); preHelloCount = 0; }
          if (++preHelloCount > 50) { front.close(4000, 'rate limit'); return; }
          let message; try { message = JSON.parse(data.toString()); } catch { front.close(4000, 'bad message'); return; }
          // The name-entry screen sends clock pings before it has an identity.
          if (message.t === 'ping') { send(front, JSON.stringify({ t: 'pong', c: message.c, s: Date.now(), ...(message.rid != null ? {rid:message.rid} : {}) })); return; }
          if (message.t !== 'hello') { send(front, JSON.stringify({ t: 'error', code: 'BAD_MSG', rid: message.rid, msg: 'hello required' })); return; }
          lease = cap.reserve(message.token, route);
          if (!lease) {
            send(front, JSON.stringify({ t: 'error', code: 'SERVER_FULL', rid: message.rid, msg: '8443服已达100人试运行上限，请稍后重试或选择icu服。' }));
            front.close(1013, 'server full'); return;
          }
          clearTimeout(timer);
          const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-for': socket.remoteAddress || '' };
          if (req.headers.cookie) headers.cookie = req.headers.cookie;
          if (req.headers.origin) headers.origin = req.headers.origin;
          // The internal hop needs no compression; the public hop retains bounded Deflate.
          back = new WebSocket(`ws://${host}:${port}${req.url}`, { headers, perMessageDeflate: false, maxPayload: 32 * 1024 * 1024, handshakeTimeout: 10000 });
          back.on('open', () => { if (!active()) { back.terminate(); queue = []; queueBytes = 0; return; } for (const [body, isBinary] of queue) send(back, body, isBinary); queue = []; queueBytes = 0; });
          back.on('message', (body, isBinary) => {
            if (!active()) return;
            // Welcome and account-resume messages are small; battle payloads pass through untouched.
            if (body.length < 16384 && !isBinary) try {
              const m = JSON.parse(body.toString()); if (m.t === 'welcome') cap.confirm(lease, m.token, route);
            } catch {}
            send(front, body, isBinary);
          });
          back.on('close', (code, reason) => close(front, code, reason));
          back.on('error', () => close(front, 1011));
          back.on('ping', body => { if (front.readyState === WebSocket.OPEN) front.ping(body); });
        }
        if (back.readyState === WebSocket.OPEN) send(back, data, binary);
        else if (back.readyState === WebSocket.CONNECTING && queueBytes + data.length <= 262144) { queue.push([data, binary]); queueBytes += data.length; }
        else front.close(1013, 'connection busy');
      };
      // Serialize async admission checks with game commands; preserve wire order.
      let receiving=Promise.resolve(),queuedBytes=0;
      front.on('message',(data,binary)=>{queuedBytes+=data.length;if(queuedBytes>1048576){front.close(1013,'connection busy');return;}receiving=receiving.then(()=>receive(data,binary)).catch(()=>front.close(1011,'relay failure')).finally(()=>{queuedBytes-=data.length;});});
      front.on('close', (code, reason) => { ended = true; clearTimeout(timer); clearInterval(heartbeat); cap.release(lease); wire(); close(back, code, reason); queue = []; });
      front.on('error', () => back?.terminate());
    }); } catch { socket.destroy(); }
  };
  handler.close = () => { for (const ws of wss.clients) ws.terminate(); wss.close(); };
  return handler;
}
