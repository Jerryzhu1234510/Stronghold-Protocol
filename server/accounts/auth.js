// server/accounts/auth.js — 账号核心：注册、登录、会话、改代号。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 移植自 fork 的 `worker/accounts/{directory,account,auth,names}.js`，但**合成一个模块**：fork 拆成「一个
// SiteDirectory DO（全站唯一）+ 每个账号一个 Account DO」是因为 Durable Object 的并发模型逼出来的（每个对象串行、
// 跨对象不能事务）。本移植跑在**单进程**里 —— 全站状态本来就只有一份，所以拆开只增加复杂度。
//
// 与 fork 一致的规则（照抄，因为它们都被实战检验过）：
//   · 用户名 3–20 位字母数字下划线，**不区分大小写唯一**（存玩家输入的大小写），**从不展示给其他玩家**；
//   · 密码 8–128 码位，PBKDF2-SHA256 存哈希；
//   · 用户名不存在与密码错误给出**同一个答复**，且**耗时相同**（见 passwords.js 的 NOBODY）；
//   · 博士代号「昵称#NNNN」：昵称可重名，编号全站唯一；判断同一代号时先去不可见字符、再 NFKC、再转小写；
//   · 编号在自己改名时**尽量保留**（新代号下该编号空闲就留着）。
//
// 一处刻意的差别：fork 的注册要写两个对象，中途中断（部署时对象重启）靠「下次登录补完」。单进程没有这个窗口，
// 但**保留了补完逻辑的等价物**：`completePending()` 在启动时跑一遍，把「用户已建但 profile 缺失」的记录补上
// （导入 fork 备份时会遇到这种半成品）。

import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  AccountError, USERNAME_PATTERN, validPassword, validNickname, nicknameKey,
  displayName, formatDiscriminator, ACCOUNT_LIMITS, NICKNAME_MAX, NUMBER_SIGNS,
} from '../../shared/account-protocol.js';
import { hashPassword, verifyPassword, looksLikeHash } from './passwords.js';

/** 会话 token 的长度（字节）；hex 之后是 64 个字符。 */
const TOKEN_BYTES = 32;

/** 登录限流的窗口与额度（fork 用 Cloudflare 的 rate limiting 绑定；这里自己数）。 */
export const LOGIN_RATE = Object.freeze({
  /** 密码校验：每个网络每分钟 10 次。 */
  perNetworkPerMinute: 10,
  /** 其中同一个用户名每分钟 5 次。 */
  perUsernamePerMinute: 5,
  /** 注册：每个网络每分钟 3 次。 */
  registerPerNetworkPerMinute: 3,
});

/** 规范化一个代号：去掉一切读作 `#` 的字符、去掉首尾空白、截到上限。返回 `{ nickname, key }`。 */
export function parseNickname(raw) {
  if (typeof raw !== 'string') throw new AccountError('INVALID_NICKNAME');
  const cleaned = raw.replace(NUMBER_SIGNS, '').replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim();
  if (!cleaned) throw new AccountError('INVALID_NICKNAME');
  // 按**码位**截断（不是 UTF-16 单元），否则会截出半个代理对
  const nickname = [...cleaned].slice(0, NICKNAME_MAX).join('');
  if (!validNickname(nickname)) throw new AccountError('INVALID_NICKNAME');
  return { nickname, key: nicknameKey(nickname) };
}

/** 校验用户名。 */
export function parseUsername(raw) {
  if (typeof raw !== 'string' || !USERNAME_PATTERN.test(raw)) throw new AccountError('INVALID_USERNAME');
  return raw;
}

/**
 * 一个固定窗口的计数器（限流用）。键 → `{ window, count }`。
 * 刻意做得**很小**：它只防「拿脚本撞密码」，不是 DDoS 防护（那交给反向代理）。
 */
class RateLimiter {
  constructor(perMinute) { this.perMinute = perMinute; this.map = new Map(); }

  /** 记一次，返回是否**超限**。 */
  hit(key, now) {
    const window = Math.floor(now / 60000);
    const row = this.map.get(key);
    if (!row || row.window !== window) {
      this.map.set(key, { window, count: 1 });
      return false;
    }
    row.count++;
    return row.count > this.perMinute;
  }

  /** 顺手清掉过期窗口（免得 Map 无限长）。 */
  prune(now) {
    const window = Math.floor(now / 60000);
    for (const [k, row] of this.map) if (row.window !== window) this.map.delete(k);
  }
}

/** 账号服务：所有账号操作的唯一入口。 */
export class Accounts {
  constructor(store, { now = Date.now } = {}) {
    this.store = store;
    this.now = now;
    this.loginLimiter = new RateLimiter(LOGIN_RATE.perNetworkPerMinute);
    this.userLimiter = new RateLimiter(LOGIN_RATE.perUsernamePerMinute);
    this.registerLimiter = new RateLimiter(LOGIN_RATE.registerPerNetworkPerMinute);
    this.completePending();
  }

  // ── 内部工具 ───────────────────────────────────────────────────────────────────────────────────

  /** 一个账号要展示给别人的资料（**不含用户名、不含哈希**）。 */
  publicProfile(profile) {
    if (!profile) return null;
    return {
      accountId: profile.accountId,
      provider: profile.provider,
      nickname: profile.nickname,
      discriminator: profile.discriminator,
      name: profile.name,
      avatarUrl: profile.avatarUrl ?? null,
      totalTrophies: this.store.totalTrophiesOf(profile.accountId),
    };
  }

  /** 账号资料 + 好友/历史条数（`/api/me` 用）。 */
  meView(accountId) {
    const profile = this.store.getProfile(accountId);
    if (!profile) return null;
    const friends = Object.values(this.store.friendsOf(accountId));
    return {
      ...this.publicProfile(profile),
      friends: { accepted: friends.filter((f) => f.state === 'accepted').length, pending: friends.filter((f) => f.state === 'pending').length },
      history: this.store.historyOf(accountId).length,
    };
  }

  /**
   * 把一个代号登记到索引里并拿一个编号。
   * `prefer` 是原编号（改名时尽量保留）。
   */
  claimName(accountId, nickname, prefer = null) {
    const key = nicknameKey(nickname);
    if (!key) throw new AccountError('INVALID_NICKNAME');
    const n = this.store.claimNumber(key, nickname, prefer);
    if (n == null) throw new AccountError('NICKNAME_FULL', 409);
    return formatDiscriminator(n);
  }

  /** 启动时补完「用户已建、资料缺失」的半成品（导入 fork 备份会遇到）。 */
  completePending() {
    let done = 0;
    for (const user of Object.values(this.store.db.users)) {
      if (!user?.accountId || this.store.getProfile(user.accountId)) continue;
      // 用户名在、资料不在：按一个默认代号补出来，玩家下次登录能看到自己的账号（改名入口在那里）
      try {
        const nickname = [...String(user.username)].slice(0, NICKNAME_MAX).join('') || '博士';
        const discriminator = this.claimName(user.accountId, nickname, null);
        this.store.putProfile(user.accountId, {
          accountId: user.accountId, provider: 'password', username: user.username,
          nickname, nicknameSource: 'user', discriminator, name: displayName(nickname, discriminator), avatarUrl: null,
        });
        done++;
      } catch { /* 代号满了就留着，下次启动再试；不阻塞启动 */ }
    }
    return done;
  }

  // ── 注册 ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * 注册一个用户名密码账号。
   * @returns {Promise<{ profile: object, token: string }>}
   */
  async register({ username, password, nickname, network = '-' }) {
    const now = this.now();
    this.registerLimiter.prune(now);
    if (this.registerLimiter.hit(`reg:${network}`, now)) throw new AccountError('TOO_MANY_ATTEMPTS', 429);

    const user = parseUsername(username);
    if (!validPassword(password)) throw new AccountError('INVALID_PASSWORD');
    const name = parseNickname(nickname ?? user);

    if (this.store.findUser(user)) throw new AccountError('USERNAME_TAKEN', 409);
    const nameKey = name.key;
    if (this.store.takenFor(nameKey)?.taken?.length >= 10000) throw new AccountError('NICKNAME_FULL', 409);

    const accountId = this.store.newAccountId();
    const passwordHash = await hashPassword(password);
    const discriminator = this.claimName(accountId, name.nickname, null);
    const profile = {
      accountId, provider: 'password', username: user,
      nickname: name.nickname, nicknameSource: 'user',
      discriminator, name: displayName(name.nickname, discriminator), avatarUrl: null,
    };
    // 先写用户（占住用户名）再写资料：顺序与 fork 相反也不要紧，因为单进程里中间不会被打断
    this.store.putUser(user, { accountId, username: user, password: passwordHash });
    this.store.putProfile(accountId, profile);
    this.store.flush();
    return { profile: this.publicProfile(profile), token: this.createSession(accountId) };
  }

  // ── 登录 ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * 用户名 + 密码登录。**用户名不存在与密码错误给出同一个答复、耗时也相同**。
   * @returns {Promise<{ profile: object, token: string }>}
   */
  async login({ username, password, network = '-' }) {
    const now = this.now();
    this.loginLimiter.prune(now);
    this.userLimiter.prune(now);
    if (this.loginLimiter.hit(`net:${network}`, now)) throw new AccountError('TOO_MANY_ATTEMPTS', 429);
    const userKey = String(username ?? '').toLowerCase();
    // 用户名维度的次数**按网络分别算**：别人的尝试只花掉他自己网络的额度，不能借限流把某个玩家挡在门外
    if (userKey && this.userLimiter.hit(`u:${network}:${userKey}`, now)) throw new AccountError('TOO_MANY_ATTEMPTS', 429);

    const user = typeof username === 'string' ? this.store.findUser(username) : null;
    const { ok, rehash } = await verifyPassword(user?.password ?? null, String(password ?? ''));
    if (!ok || !user) throw new AccountError('BAD_CREDENTIALS', 401);

    // 参数变了（迭代次数上调/换了 pepper）⇒ 按当前参数重存，玩家无感
    if (rehash) this.store.putUser(user.username, { ...user, password: rehash });

    const profile = this.store.getProfile(user.accountId);
    if (!profile) throw new AccountError('ACCOUNT_INCOMPLETE', 409);
    this.store.pruneSessions(now);
    return { profile: this.publicProfile(profile), token: this.createSession(user.accountId) };
  }

  /** 改密码：需要当前密码；**其他设备的登录随即失效，本设备保持**。 */
  async changePassword({ accountId, current, next, keepToken = null }) {
    const profile = this.store.getProfile(accountId);
    if (!profile?.username) throw new AccountError('NO_PASSWORD_ACCOUNT', 400);
    if (!validPassword(next)) throw new AccountError('INVALID_PASSWORD');
    const user = this.store.findUser(profile.username);
    const { ok } = await verifyPassword(user?.password ?? null, String(current ?? ''));
    if (!ok) throw new AccountError('BAD_CREDENTIALS', 401);
    this.store.putUser(user.username, { ...user, password: await hashPassword(next) });
    this.store.deleteSessionsOf(accountId, keepToken);
    this.store.flush();
    return { ok: true };
  }

  /** 管理员重置密码（忘记密码的玩家）。所有登录失效。 */
  async resetPassword({ accountId, next }) {
    const profile = this.store.getProfile(accountId);
    if (!profile?.username) throw new AccountError('NO_PASSWORD_ACCOUNT', 400);
    if (!validPassword(next)) throw new AccountError('INVALID_PASSWORD');
    const user = this.store.findUser(profile.username);
    if (!user) throw new AccountError('NO_PASSWORD_ACCOUNT', 400);
    this.store.putUser(user.username, { ...user, password: await hashPassword(next) });
    const killed = this.store.deleteSessionsOf(accountId, null);
    this.store.flush();
    return { ok: true, sessionsInvalidated: killed };
  }

  /** 按用户名找账号 id（管理员工具用；**不返回**哈希）。 */
  accountIdOfUsername(username) {
    const u = typeof username === 'string' ? this.store.findUser(username) : null;
    return u?.accountId ?? null;
  }

  // ── 会话 ───────────────────────────────────────────────────────────────────────────────────────

  /** 建一个会话，返回 token。 */
  createSession(accountId) {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const now = this.now();
    this.store.putSession(token, { accountId, createdAt: now, lastSeenAt: now, expiresAt: now + ACCOUNT_LIMITS.sessionMs });
    return token;
  }

  /** 用一个 token 取账号（过期/不存在 ⇒ null）。顺手更新 lastSeenAt（节流到每分钟一次，免得每次请求都写盘）。 */
  sessionAccount(token) {
    if (typeof token !== 'string' || !token) return null;
    const s = this.store.getSession(token);
    if (!s) return null;
    const now = this.now();
    if (s.expiresAt <= now) { this.store.deleteSession(token); return null; }
    if (now - s.lastSeenAt > 60000) { s.lastSeenAt = now; this.store.markDirty(); }
    return s.accountId;
  }

  logout(token) { return this.store.deleteSession(token); }

  // ── 代号 ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * 改博士代号。新代号下原编号**空闲就保留**，否则重新分配；换键时旧编号随即释放。
   *
   * 注意同键改名的情形（`晴猫` → `晴猫`，只是改写法）：那个编号**本来就在这个账号名下**，直接留着即可 ——
   * 不能交给 `claimNumber`，因为它看到「已被占」会以为被别人抢了、又随机分一个（这个 bug 被测试抓到过）。
   * @returns {{ profile: object }}
   */
  rename({ accountId, nickname }) {
    const profile = this.store.getProfile(accountId);
    if (!profile) throw new AccountError('NO_ACCOUNT', 404);
    const { nickname: clean, key } = parseNickname(nickname);
    const oldKey = nicknameKey(profile.nickname);
    const oldNumber = Number.parseInt(profile.discriminator, 10);
    const sameKey = oldKey === key;
    // 同键：编号仍归自己，直接用；换键：请索引尽量保留它（空闲才留得住）
    const discriminator = sameKey && Number.isInteger(oldNumber)
      ? profile.discriminator
      : this.claimName(accountId, clean, oldNumber);
    // 换了键才释放旧编号（同键改名 = 改写法，编号还是那个）
    if (!sameKey && Number.isInteger(oldNumber)) this.store.releaseNumber(oldKey, oldNumber);
    const next = {
      ...profile, nickname: clean, nicknameSource: 'user', discriminator,
      name: displayName(clean, discriminator),
    };
    this.store.putProfile(accountId, next);
    this.store.flush();
    return { profile: this.publicProfile(next) };
  }

  /** 按「显示名 / 代号#编号 / 用户名」找一个账号（好友搜索用）。**用户名只有自己搜得到**，见 search 的参数。 */
  find(query, { selfAccountId = null } = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const out = [];
    const wanted = q.toLowerCase();
    for (const profile of Object.values(this.store.db.accounts)) {
      if (profile.name.toLowerCase() === wanted || profile.nickname.toLowerCase() === wanted) out.push(profile);
    }
    // 用户名是登录标识、从不外露：**只有本人**能按它搜到自己（例如在设置页确认账号）
    if (!out.length && selfAccountId) {
      const self = this.store.getProfile(selfAccountId);
      if (self?.username && self.username.toLowerCase() === wanted) out.push(self);
    }
    return out;
  }

  /** 一个账号的公开资料（按 id）。 */
  profileOf(accountId) { return this.publicProfile(this.store.getProfile(accountId)); }

  /** 导出/导入用：整库快照。 */
  snapshot() { return this.store.snapshot(); }
}

export { looksLikeHash, timingSafeEqual };
