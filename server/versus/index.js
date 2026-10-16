import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { createStaticHandler } from '../http/static.js';
import { AssaultRoom } from './assault.js';
import { versusCatalog } from './http.js';
import { t } from '../../shared/i18n.js';

export async function startVersus({ port = 3227, host = '127.0.0.1' } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const staticHandler = createStaticHandler({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared') });
  const rooms = new Map(), clients = new Set(), sessions = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.writeHead(302, { Location: '/versus.html' }); res.end(); return; }
    if (url.pathname === '/versus/catalog') {
      versusCatalog(req, res); return;
    }
    staticHandler(req, res, url.pathname, url.search.slice(1)).catch(e => { console.error(e); if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  const wss = new WebSocketServer({ server, path: '/versus/socket', maxPayload: 4096 });
  const send = (ws, value) => { if (ws.readyState === 1 && ws.bufferedAmount < 512000) ws.send(JSON.stringify(value)); };
  wss.on('connection', ws => {
    const client = { ws, room: null, player: null, watch: null, focus: null, rate: 0, rateAt: performance.now() }; clients.add(client);
    send(ws, { type: 'hello', version: 'pvp-preview-2' });
    ws.on('message', raw => {
      try {
        if (performance.now() - client.rateAt >= 1000) { client.rateAt = performance.now(); client.rate = 0; }
        if (++client.rate > 15) throw new Error('操作过快');
        const msg = JSON.parse(String(raw));
        if (msg.action === 'join' || msg.action === 'create') {
          if (client.room) throw new Error('已经加入房间');
          let room;
          if (msg.action === 'create') {
            if (rooms.size >= 32) throw new Error('本地测试房间已满，请重启测试服务器');
            let code; do { code = randomBytes(3).toString('hex').slice(0, 4).toUpperCase(); } while (rooms.has(code));
            room = new AssaultRoom(code); rooms.set(code, room);
          } else room = rooms.get(String(msg.code || '').trim().toUpperCase());
          if (!room) throw new Error('找不到房间');
          const p = room.join(msg.name), token = randomBytes(24).toString('hex');
          client.room = room; client.player = p; sessions.set(token, { room, player: p });
          send(ws, { type: 'joined', code: room.code, token, playerId: p.id });
        } else if (msg.action === 'resume') {
          if (client.room) throw new Error('已经加入房间');
          const session = sessions.get(msg.token); if (!session) throw new Error('测试会话已失效');
          for (const other of clients) if (other !== client && other.player === session.player) { other.ws.close(4001, t('另一页面接管')); other.player = null; other.room = null; }
          Object.assign(client, session); client.player.connected = true;
          send(ws, { type: 'joined', code: client.room.code, token: msg.token, playerId: client.player.id });
        } else {
          if (!client.room || !client.player) throw new Error('请先加入房间');
          if (msg.action === 'start') client.room.start(client.player.id, !!msg.fillAI);
          else if (msg.action === 'watch') {
            const duel = client.room.duels.find(d => d.id === msg.id);
            if (!duel) throw new Error('找不到这场对局');
            if (msg.playerId && !duel.pair.some(p => p.id === msg.playerId)) throw new Error('玩家不在这场对局');
            client.watch = msg.id; client.focus = msg.playerId || null;
          } else client.room.action(client.player, msg);
        }
        send(ws, { type: 'ack', action: msg.action }); broadcast();
      } catch (e) { send(ws, { type: 'error', message: e.message }); }
    });
    ws.on('close', () => { if (client.player) client.player.connected = false; clients.delete(client); });
    ws.on('error', () => {});
  });
  function broadcast() {
    const fields = new Map();
    for (const client of clients) {
      const { room, player, ws } = client; if (!room || !player) continue;
      let fieldId = client.watch || player.duel;
      if (!room.duels.some(d => d.id === fieldId)) {
        client.watch = null; client.focus = null;
        fieldId = room.duels.some(d => d.id === player.duel) ? player.duel : room.duels[0]?.id;
      }
      if (!fields.has(room)) fields.set(room, new Map());
      const cache = fields.get(room);
      if (fieldId && !cache.has(fieldId)) cache.set(fieldId, room.fieldViews(fieldId));
      const feeds = cache.get(fieldId);
      const focus = feeds?.[client.focus] ? client.focus : feeds?.[player.id] ? player.id : Object.keys(feeds || {})[0];
      send(ws, { type: 'state', room: room.publicView(), me: room.privateView(player), field: feeds?.[focus] || null });
    }
  }
  let last = performance.now(), accumulator = 0, ticks = 0;
  const timer = setInterval(() => {
    const now = performance.now(); accumulator += Math.min(1, (now - last) / 1000); last = now;
    while (accumulator >= 1 / 30) {
      for (const room of rooms.values()) room.tick(1 / 30);
      accumulator -= 1 / 30; ticks++;
      if (ticks % 6 === 0) broadcast();
    }
  }, 16);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, wss, rooms, url: `http://${host}:${server.address().port}/versus.html`, close: async () => {
    clearInterval(timer); for (const c of clients) c.ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r));
  } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = await startVersus({ port: Number(process.env.VERSUS_PORT || 3227), host: process.env.VERSUS_HOST || '127.0.0.1' });
  console.log(`对抗模式本地验收版: ${service.url}`);
  const stop = async () => { await service.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
