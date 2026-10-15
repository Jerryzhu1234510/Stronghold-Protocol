// public/js/account.js — 浏览器侧的账号会话：token 与公开资料存在 localStorage，登录后 hello 带上它。
//
// 与座位 token 的分工（别混）：
//   `sp.token` / `sp.tokens`（public/js/net.js）是**这台设备**的座位凭据 —— 断线回来坐回原位；
//   `sp.account`（这里）是**这个人**的凭据 —— 换设备登录同一个账号，新设备接管原席位。
// 两者可以同时存在：hello 里 `token` 给座位、`account` 给账号（服务端见 server/net.js onHelloMsg）。
//
// 失效处理：token 过期或服务器换了账号库时 `/api/me` 会 401，这里就把它清掉（下次进标题页要求重新登录），
// 不会把玩家卡在一个"看起来登录了但什么都没用"的状态。

const K_TOKEN = 'sp.account';        // localStorage：账号 token
const K_PROFILE = 'sp.account.profile';   // localStorage：公开资料（离线时也能显示名字）

const safe = (name) => {
  try { return globalThis[name] ?? null; } catch { return null; }
};

function readRaw(key) {
  try { return safe('localStorage')?.getItem(key) ?? null; } catch { return null; }
}
function writeRaw(key, value) {
  try {
    if (value == null) safe('localStorage')?.removeItem(key);
    else safe('localStorage')?.setItem(key, value);
  } catch { /* 隐私模式/配额：静默，账号功能退化成"这次会话有效" */ }
}

/** 当前账号 token（未登录 ⇒ null）。 */
export function accountToken() {
  const t = readRaw(K_TOKEN);
  return typeof t === 'string' && t.length > 0 && t.length <= 128 ? t : null;
}

/** 当前账号的公开资料（未登录或没缓存 ⇒ null）。 */
export function accountProfile() {
  const raw = readRaw(K_PROFILE);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && typeof p.name === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** 是否已登录（乐观判断：有 token 就算 —— 真正的有效性由 `/api/me` 回答）。 */
export const isSignedIn = () => accountToken() != null;

/** 登录成功后写入。 */
export function setAccount(token, profile) {
  writeRaw(K_TOKEN, typeof token === 'string' && token ? token : null);
  writeRaw(K_PROFILE, profile ? JSON.stringify(profile) : null);
  globalThis.dispatchEvent?.(new Event('sp:account-change'));
  return { token: accountToken(), profile: accountProfile() };
}

/** 退出 / token 失效时清掉。 */
export function clearAccount() {
  writeRaw(K_TOKEN, null);
  writeRaw(K_PROFILE, null);
  globalThis.dispatchEvent?.(new Event('sp:account-change'));
}

/**
 * 调账号 API。路径以 `/api/` 开头，`opts.token` 缺省用当前的账号 token。
 * @returns {Promise<object>} 答复的 JSON（非 2xx 时抛一个带 `code`/`status` 的错误）
 */
export async function accountFetch(pathname, { method = 'GET', body = null, token = undefined, fetchImpl = null } = {}) {
  const f = fetchImpl || globalThis.fetch;
  const tk = token === undefined ? accountToken() : token;
  const headers = {};
  if (body != null) headers['Content-Type'] = 'application/json';
  if (tk) headers.Authorization = `Bearer ${tk}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try { res = await f(pathname, { method, headers, body: body == null ? undefined : JSON.stringify(body), signal: controller.signal }); }
  finally { clearTimeout(timer); }
  let parsed = null;
  const text = await res.text().catch(() => '');
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!res.ok) {
    const err = new Error(parsed?.error || `HTTP ${res.status}`);
    err.code = parsed?.error || 'HTTP';
    err.status = res.status;
    // token 失效 ⇒ 顺手清掉，别让界面一直以为登录着
    if (res.status === 401 && tk && accountToken() === tk) clearAccount();
    throw err;
  }
  return parsed;
}

// ── 高层动作（标题页与设置页直接调这些）────────────────────────────────────────────────────────────

/** 注册并登录。 */
export async function register({ username, password, nickname }, opts = {}) {
  const r = await accountFetch('/api/auth/register', { method: 'POST', body: { username, password, nickname }, token: null, ...opts });
  setAccount(r.token, r.profile);
  return r;
}

/** 登录。 */
export async function login({ username, password }, opts = {}) {
  const r = await accountFetch('/api/auth/login', { method: 'POST', body: { username, password }, token: null, ...opts });
  setAccount(r.token, r.profile);
  return r;
}

/** 退出登录（先告诉服务器把会话删掉，再清本地）。 */
export async function logout(opts = {}) {
  try { await accountFetch('/api/auth/logout', { method: 'POST', ...opts }); } catch { /* 服务器不认识也无所谓 */ }
  clearAccount();
}

/**
 * 用缓存的 token 问服务器「我是谁」。
 * @returns {Promise<object|null>} 资料；没登录 ⇒ null；token 失效 ⇒ null（并已清掉本地）
 */
export async function refreshMe(opts = {}) {
  const token = accountToken();
  if (!token) return null;
  try {
    const r = await accountFetch('/api/me', { ...opts, token });
    if (token !== accountToken()) return null;
    setAccount(token, r.profile);
    return r.profile;
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}

// ── 客户端侧的校验（与 shared/account-protocol.js 同一套规则，让玩家在发出去之前就看到错）─────────────
// 这里**重复**了服务端的规则而不是 import：服务端的模块在 Node 侧、浏览器拿不到；规则很短，重复的代价
// 小于把它拆成两份构建。两边的数字必须一致（test/accounts.test.js 会钉住服务端那份）。

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NICKNAME_MAX = 12;

/** 本地检查：返回错因的键（给界面挑文案），都对 ⇒ null。 */
export function checkCredentials({ username, password } = {}) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return 'username';
  const n = typeof password === 'string' ? [...password].length : 0;
  if (n < PASSWORD_MIN || n > PASSWORD_MAX) return 'password';
  return null;
}
