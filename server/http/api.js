// server/http/api.js — 账号相关的 JSON API。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 挂载点：`createRequestHandler` 在静态文件之前先问这里 —— 返回 `false` 表示「这不是我的路径」，交给静态文件。
//
//   POST /api/auth/register   { username, password, nickname }        → { profile, token }
//   POST /api/auth/login      { username, password }                  → { profile, token }
//   POST /api/auth/logout                                             → { ok }
//   GET  /api/me                                                      → { profile, friends, history }
//   POST /api/me/nickname     { nickname }                            → { profile }
//   POST /api/me/password     { current, next }                       → { ok }
//   GET  /api/me/preferences                                          → { preferences }
//   POST /api/me/preferences  { patch }                               → { preferences }
//   GET  /api/me/history?limit&before                                 → { matches: [...] }
//   GET  /api/me/history/:matchId                                     → { match }（含回放，若有）
//   GET  /api/users?q=                                                → { users: [...] }
//   GET  /api/friends                                                 → { friends: [...], incoming: [...], outgoing: [...] }
//   POST /api/friends/request { accountId }                           → { friend }
//   POST /api/friends/accept  { accountId }                           → { friend }
//   POST /api/friends/remove  { accountId }                           → { ok }
//
// 约定：
//   · 认证走 `Authorization: Bearer <token>`（浏览器里也存 localStorage）；**不用 Cookie** —— 游戏本身就是跨源
//     反代部署的常客，Bearer 不用处理 Cookie 的 SameSite / Domain 问题；
//   · 会改状态的方法都校验**同源**（Origin / Sec-Fetch-Site），这是防 CSRF 的那一层（Bearer 本身已经挡住了
//     大部分，但一个被 XSS 注入的页面能读到 localStorage 时，同源校验还能挡住别的站点发起的请求）；
//   · 请求体上限 64 KB（除了导入备份那条走单独的大上限）；
//   · 错误一律 `{ error: CODE }` + 合适的 HTTP 状态。

import { AccountError, isAccountError } from '../../shared/account-protocol.js';
import { parseNickname } from '../accounts/auth.js';
import { sendJson } from './common.js';

/** 普通请求体上限。 */
const MAX_BODY = 64 * 1024;
/** 导入备份的上限（整库 JSON）。 */
const MAX_IMPORT = 32 * 1024 * 1024;

/** 读一个请求体，超过 `max` 就抛（并**干净地**结束请求，让客户端收得到 413）。 */
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;                 // 已经判定超限：继续把剩下的读掉，别让连接卡住
      size += c.length;
      if (size > max) {
        tooBig = true;
        chunks.length = 0;
        reject(new AccountError('BODY_TOO_LARGE', 413));
        return;
      }
      chunks.push(c);
    });
    // 超限时**不 destroy**：destroy 会让客户端只看到 "socket closed"，收不到我们回的 413。
    // 这里只是不再累积，等 'end' 自然结束；`api.js` 的 guard 会把 413 写回去。
    req.on('end', () => {
      if (tooBig) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new AccountError('BAD_JSON', 400)); }
    });
    req.on('error', () => reject(new AccountError('BAD_REQUEST', 400)));
  });
}

/** 同源校验：改状态的方法要求请求来自本站。 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  // 没有 Origin 的时候看 Fetch 元数据（同源导航/表单）；两者都没有就放行（非浏览器客户端，例如管理员 curl）
  const site = req.headers['sec-fetch-site'];
  if (site === 'same-origin' || site === 'none') return true;
  return !origin && !site;
}

/** 从 Authorization 头取 token。 */
const tokenOf = (req) => {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,128})$/i.exec(h.trim());
  return m ? m[1] : null;
};

/** 发起请求的网络（限流按它分桶）。反代后面要设 TRUST_PROXY，否则这里拿到的是反代地址。 */
const networkOf = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '-';
};

/**
 * 建一个 API 处理器。
 * @param {object} deps
 * @param {import('../accounts/auth.js').Accounts} deps.accounts
 * @param {object} [deps.friends]   好友模块（server/accounts/friends.js）
 * @param {object} [deps.history]   历史模块（server/accounts/history.js）
 * @param {object} [deps.preferences] 配置同步模块（server/accounts/preferences.js）
 * @param {object} [deps.backup]    备份模块（server/accounts/backup.js）
 * @param {object} deps.log
 * @returns {(req, res, parts: {rawPath: string, query: string}) => Promise<boolean>} 处理了就 true
 */
export function createApi({ accounts, friends = null, history = null, preferences = null, backup = null, log = console }) {
  /** 跑一个处理器，把协议错误翻成 HTTP。 */
  const guard = async (req, res, fn) => {
    try {
      await fn();
    } catch (e) {
      if (isAccountError(e)) { sendJson(req, res, e.status, { error: e.code }); return; }
      log.error?.('[api] 未处理的错误', e);
      sendJson(req, res, 500, { error: 'INTERNAL' });
    }
  };

  /** 需要登录：返回 accountId，或直接答复 401 并返回 null。 */
  const requireAccount = (req, res) => {
    const token = tokenOf(req);
    const accountId = token ? accounts.sessionAccount(token) : null;
    if (!accountId) { sendJson(req, res, 401, { error: 'UNAUTHORIZED' }); return null; }
    return accountId;
  };

  /** 会改状态的方法：先查同源。 */
  const requireSameOrigin = (req, res) => {
    if (sameOrigin(req)) return true;
    sendJson(req, res, 403, { error: 'CROSS_ORIGIN' });
    return false;
  };

  const q = (parts, key) => {
    const m = new RegExp(`(?:^|&)${key}=([^&]*)`).exec(parts.query || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  };

  return async function handleApi(req, res, parts) {
    const path = parts.rawPath;
    if (!path.startsWith('/api/')) return false;
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    // ── 认证 ──────────────────────────────────────────────────────────────────────────────────
    if (path === '/api/auth/register' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const body = await readBody(req);
        const { profile, token } = await accounts.register({ ...body, network: networkOf(req) });
        sendJson(req, res, 200, { profile, token });
      });
      return true;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const body = await readBody(req);
        const { profile, token } = await accounts.login({ ...body, network: networkOf(req) });
        sendJson(req, res, 200, { profile, token });
      });
      return true;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const token = tokenOf(req);
        if (token) accounts.logout(token);
        sendJson(req, res, 200, { ok: true });
      });
      return true;
    }

    // ── 我的账号 ──────────────────────────────────────────────────────────────────────────────
    if (path === '/api/me' && method === 'GET') {
      await guard(req, res, async () => {
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        sendJson(req, res, 200, { profile: accounts.meView(accountId) });
      });
      return true;
    }

    if (path === '/api/me/nickname' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        const body = await readBody(req);
        const { profile } = accounts.rename({ accountId, nickname: body.nickname });
        sendJson(req, res, 200, { profile });
      });
      return true;
    }

    if (path === '/api/me/password' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        const body = await readBody(req);
        const keepToken = tokenOf(req);
        await accounts.changePassword({ accountId, current: body.current, next: body.next, keepToken });
        sendJson(req, res, 200, { ok: true });
      });
      return true;
    }

    // ── 跨设备配置同步 ────────────────────────────────────────────────────────────────────────
    if (path === '/api/me/preferences' && (method === 'GET' || method === 'POST')) {
      await guard(req, res, async () => {
        if (method === 'POST' && !requireSameOrigin(req, res)) return;
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!preferences) { sendJson(req, res, 503, { error: 'PREFERENCES_OFF' }); return; }
        if (method === 'GET') { sendJson(req, res, 200, { preferences: preferences.get(accountId) }); return; }
        const body = await readBody(req);
        sendJson(req, res, 200, { preferences: preferences.patch(accountId, body.patch ?? body) });
      });
      return true;
    }

    // ── 对局历史 ──────────────────────────────────────────────────────────────────────────────
    if (path === '/api/me/history' && method === 'GET') {
      await guard(req, res, async () => {
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!history) { sendJson(req, res, 503, { error: 'HISTORY_OFF' }); return; }
        const limit = Number(q(parts, 'limit') ?? 20);
        const before = q(parts, 'before');
        sendJson(req, res, 200, { matches: history.list(accountId, { limit, before }) });
      });
      return true;
    }

    const histOne = /^\/api\/me\/history\/([A-Za-z0-9_.:-]{1,128})$/.exec(path);
    if (histOne && method === 'GET') {
      await guard(req, res, async () => {
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!history) { sendJson(req, res, 503, { error: 'HISTORY_OFF' }); return; }
        const row = history.get(accountId, histOne[1]);
        if (!row) { sendJson(req, res, 404, { error: 'NO_MATCH' }); return; }
        sendJson(req, res, 200, { match: row });
      });
      return true;
    }

    // ── 找人与好友 ────────────────────────────────────────────────────────────────────────────
    if (path === '/api/users' && method === 'GET') {
      await guard(req, res, async () => {
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        const found = accounts.find(q(parts, 'q') ?? '', { selfAccountId: accountId });
        sendJson(req, res, 200, { users: found.map((p) => accounts.publicProfile(p)) });
      });
      return true;
    }

    if (path === '/api/friends' && method === 'GET') {
      await guard(req, res, async () => {
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!friends) { sendJson(req, res, 503, { error: 'FRIENDS_OFF' }); return; }
        sendJson(req, res, 200, friends.view(accountId));
      });
      return true;
    }

    if (path === '/api/friends/request' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!friends) { sendJson(req, res, 503, { error: 'FRIENDS_OFF' }); return; }
        const body = await readBody(req);
        sendJson(req, res, 200, { friend: friends.request(accountId, body.accountId) });
      });
      return true;
    }

    if (path === '/api/friends/accept' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!friends) { sendJson(req, res, 503, { error: 'FRIENDS_OFF' }); return; }
        const body = await readBody(req);
        sendJson(req, res, 200, { friend: friends.accept(accountId, body.accountId) });
      });
      return true;
    }

    if (path === '/api/friends/remove' && method === 'POST') {
      await guard(req, res, async () => {
        if (!requireSameOrigin(req, res)) return;
        const accountId = requireAccount(req, res);
        if (!accountId) return;
        if (!friends) { sendJson(req, res, 503, { error: 'FRIENDS_OFF' }); return; }
        const body = await readBody(req);
        sendJson(req, res, 200, { ok: friends.remove(accountId, body.accountId) });
      });
      return true;
    }

    // ── 备份（需要管理令牌，见 server/accounts/backup.js）────────────────────────────────────────
    if (path.startsWith('/api/admin/') && backup) {
      await guard(req, res, async () => {
        const admin = backup.adminFrom(req);
        if (!admin) { sendJson(req, res, 401, { error: 'UNAUTHORIZED' }); return; }
        if (path === '/api/admin/backup' && method === 'GET') {
          sendJson(req, res, 200, backup.exportAll());
          return;
        }
        if (path === '/api/admin/restore' && method === 'POST') {
          const body = await readBody(req, MAX_IMPORT);
          sendJson(req, res, 200, backup.importAll(body, { dryRun: !!body?.dryRun }));
          return;
        }
        if (path === '/api/admin/reset-password' && method === 'POST') {
          const body = await readBody(req);
          let next = body.next;
          if (!next) next = backup.generatePassword();
          const accountId = accounts.accountIdOfUsername(body.username);
          if (!accountId) { sendJson(req, res, 404, { error: 'NO_ACCOUNT' }); return; }
          const r = await accounts.resetPassword({ accountId, next });
          log.info?.(`[accounts] account_password_reset ${accountId}`);
          sendJson(req, res, 200, { ok: true, ...r, generated: body.next ? null : next });
          return;
        }
        if (path === '/api/admin/stats' && method === 'GET') {
          sendJson(req, res, 200, backup.stats());
          return;
        }
        sendJson(req, res, 404, { error: 'NO_ROUTE' });
      });
      return true;
    }

    // /api/ 开头但不认识 ⇒ 明确的 404（不要落到静态文件上，那会返回首页 HTML）
    sendJson(req, res, 404, { error: 'NO_ROUTE' });
    return true;
  };
}

export { readBody, sameOrigin, tokenOf, networkOf, parseNickname };
