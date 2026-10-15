// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST 0.0.0.0, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate from 1 KB; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the content packs (/packs/index.json, /packs/<id>/<file> — the registry is packs.js)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json and /data/local-assets.json: every art URL with its hash segment
//                      (/assets/~<hash>/…, immutable when the hash matches); the committed files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400 / 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import { getData, loadData } from './data.js';
import { ROOT, listenAddress, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createPackRegistry } from './packs.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError } from './http/common.js';
import { lanUrls, isProcessEntry, runMain } from './http/boot.js';
import { TrafficStats } from './traffic.js';
import { PerformanceStats } from './performance.js';
import { createAnnouncements } from './announcements.js';
import { createAccountClient } from './accounts/client.js';
import { versusCatalog } from './versus/http.js';
import { createMatchWorkerPool, matchWorkerCount } from './match/workers/pool.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string,
 *   MatchClass?: Function, VersusMatchClass?: Function, seedFn?: () => number, matchWorkers?: number,
 *   matchWorkerModule?: string,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number },
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom)
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPackRegistry>,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const { publicDir, dataDir, sharedDir, packsDir } = serveDirs(opts);

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  const workers = matchWorkerCount(opts.matchWorkers);
  if (workers && opts.MatchClass) throw new Error('custom MatchClass cannot be combined with match workers');
  const matchWorkerPool = workers ? await createMatchWorkerPool({ count: workers, dataDir, log,
    matchModule: opts.matchWorkerModule, heapMb: Number(process.env.SP_MATCH_WORKER_HEAP_MB || 1024) }) : null;
  const sessionOpts = matchWorkerPool ? { ...opts, MatchClass: matchWorkerPool.MatchClass, VersusMatchClass: matchWorkerPool.MatchClass } : opts;
  const traffic = new TrafficStats();
  const assetTraffic = createTrafficCounter();

  const accounts = opts.accounts || (process.env.SP_ACCOUNT_IPC === '1' ? createAccountClient() : null);
  if (!accounts && process.env.SP_ACCOUNTS !== 'off') throw new Error('请使用固定热更网关启动账号版');
  const { registry, lobby, network } = createSessionStack(sessionOpts, { data, log, traffic, accounts });
  const performanceStats = new PerformanceStats({ traffic, network, counts: () => lobby.stats(), log });
  const announcements = createAnnouncements({ registry, log, input: opts.consoleInput || null });
  const onHello = lobby.onHello.bind(lobby);
  lobby.onHello = (session, meta) => { announcements.sendCurrent(session); return onHello(session, meta); };
  // content packs (docs/PACKS.md): scanned now — the start log names them — and again whenever their folders change
  const packs = createPackRegistry({ publicDir, dataDir, packsDir }, { log });
  packs.refresh(true);
  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = assetIndex ? createManifestViews({ dataDir, index: assetIndex, log }) : null;
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, packsDir, packs, log, assetIndex, views });
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  const routeRequest = createRequestHandler({ serveStatic, health: { startedAt, network, registry, lobby, traffic, assetTraffic, assetIndex, views, performanceStats, matchWorkerPool }, log, trustProxy: network.opts.trustProxy });
  const server = http.createServer((req, res) => {
    traffic.observeHttp(req, res);
    assetTraffic.meter(res, req.url?.split('?')[0] || '/');
    if (req.url?.split('?')[0] === '/versus/catalog') { versusCatalog(req, res); return; }
    routeRequest(req, res);
  });
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, traffic: assetTraffic });

  try {
    await new Promise((resolve, reject) => {
      const onError = (e) => { server.off('listening', onListening); reject(e); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  } catch (e) {
    performanceStats.close();
    announcements.close();
    network.close(); // stop heartbeat/sweep timers of the half-built server
    await accounts?.close?.();
    await matchWorkerPool?.close();
    assetIndex?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  assetIndex?.start();

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${host === '0.0.0.0' || host === '::' ? 'localhost' : host}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      performanceStats.close();
      announcements.close();
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      network.close();
      await accounts?.close?.();
      await matchWorkerPool?.close();
      assetIndex?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  const beginDrain = () => { lobby.draining = true; };
  const cancelDrain = () => { lobby.draining = false; };
  return { port: actualPort, host, url, server, wss, lobby, network, registry, packs, assetIndex, views, assetTraffic, traffic, performanceStats, announcements, matchWorkerPool, beginDrain, cancelDrain, close };
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(startServer);
