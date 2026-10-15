// shared/account-protocol.js — 账号协议的共享部分：前后端同一套校验规则、同一个错误类型。
//
// 移植自 0.1.3 fork 的 `shared/account-protocol.js`（fork 是 Cloudflare Worker + Durable Object 实现；本移植是
// Node 自建服务器，**只沿用它的规则与命名，不沿用存储层**）。客户端先按同一套规则检查一遍，玩家在发出去之前就能看到错。
//
// 与 fork 的差别：
//   · 会话时长、加入申请、预留、租约这些**属于在线大厅**的常量还没用上（大厅是后续一轮），先按 fork 的值留着；
//   · 没有 `oauthMs` 以外的 GitHub 逻辑 —— GitHub 登录见 server/accounts/github.js。

export const ACCOUNT_LIMITS = Object.freeze({
  /** 一次登录的会话有效期（30 天）。 */
  sessionMs: 30 * 86400000,
  /** 一个加入申请的有效期。 */
  applicationMs: 120000,
  /** 批准后为申请者预留席位的时间（够在手机上来回切一次应用）。 */
  approvalMs: 120000,
  /** 在线大厅条目的租约。 */
  leaseMs: 60000,
  /** 续租间隔。 */
  heartbeatMs: 20000,
  /** 一页最多多少条（历史、好友都按它分页）。 */
  pageSize: 50,
});

/** 一个带 HTTP 状态码的协议错误。`code` 是稳定标识，客户端按它选文案。 */
export class AccountError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'AccountError';
    this.code = code;
    this.status = status;
  }
}

/** 这个错误是不是协议错误（跨进程只剩 code/status 时也认）。 */
export const isAccountError = (error) => typeof error?.code === 'string' && Number.isInteger(error.status);

/** 校验一个不透明 id（账号 id、对局 id、会话 id）。 */
export function requireId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new AccountError('INVALID_ID');
  return value;
}

/** 校验分页条数。 */
export function pageLimit(value = 20) {
  if (!Number.isSafeInteger(value) || value < 1 || value > ACCOUNT_LIMITS.pageSize) throw new AccountError('INVALID_PAGE');
  return value;
}

// ── 用户名与密码 ──────────────────────────────────────────────────────────────────────────────────
// 用户名**只是登录标识，从不展示给其他玩家**：3–20 位字母、数字或下划线。

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

/** 密码 8–128 个码位，任意字符。 */
export const PASSWORD_LENGTH = Object.freeze({ min: 8, max: 128 });

/** 博士代号（昵称）在规范化之后最多这么多个码位。 */
export const NICKNAME_MAX = 12;

/** 一切读作 `#` 的字符（含其 NFKC 形式）：代号里不允许有，这样显示名只有一种解析方式。 */
export const NUMBER_SIGNS = /[#\uFE5F\uFF03]/g;

/** 密码长度是否合法。 */
export const validPassword = (password) => typeof password === 'string'
  && [...password].length >= PASSWORD_LENGTH.min && [...password].length <= PASSWORD_LENGTH.max;

/**
 * 代号编号的唯一性键：形近字、大小写变体、夹带不可见字符的代号**共用**它。先去掉 Unicode 认定的不可见字符
 * （Default_Ignorable_Code_Point），再 NFKC 规范化并转小写。空键 ⇒ 这个代号什么都没显示。
 */
export const nicknameKey = (nickname) => String(nickname)
  .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
  .normalize('NFKC')
  .toLowerCase();

/** 一个**已规范化**的代号是否合法：1–NICKNAME_MAX 个码位、有可见内容、不含 `#`。 */
export const validNickname = (nickname) => typeof nickname === 'string'
  && nicknameKey(nickname).length > 0
  && [...nickname].length <= NICKNAME_MAX
  && !nickname.match(NUMBER_SIGNS);

/** 其他玩家看到的名字：代号 + 编号（0000–9999），例如 `晴猫#1145`。 */
export const displayName = (nickname, discriminator) => `${nickname}#${discriminator}`;

/** 拆开一个显示名：账号的是 `{ nickname, tag: '#NNNN' }`；其他名字整段都算昵称（tag 为空）。 */
export function nameParts(name) {
  const tag = /#\d{4}$/.exec(String(name))?.[0] ?? '';
  return { nickname: String(name).slice(0, String(name).length - tag.length), tag };
}

/** 编号格式化成 4 位（0000–9999）。 */
export const formatDiscriminator = (n) => String(n).padStart(4, '0');

// ── 好友 ──────────────────────────────────────────────────────────────────────────────────────────
// fork 里**没有好友功能**（它的 directory 是全站身份索引），所以这一节是本移植新设计的。

/** 好友关系的两种状态：`pending`（请求已发出，等对方接受）与 `accepted`。 */
export const FRIEND_STATES = Object.freeze(['pending', 'accepted']);

/** 一条好友请求最多挂多久（超过就算过期，双方可以重新发）。 */
export const FRIEND_REQUEST_MS = 14 * 86400000;

/** 一个账号最多多少好友（防止用好友列表刷爆内存）。 */
export const FRIEND_MAX = 200;

// ── 对局历史 ──────────────────────────────────────────────────────────────────────────────────────

/** 一个账号最多保留多少条对局历史（超出丢最旧的）。 */
export const HISTORY_MAX = 200;

/** 结算里一个玩家一行能写的字段（其余一律丢弃：历史是外部输入）。 */
export const HISTORY_ROW_KEYS = Object.freeze([
  'seat', 'name', 'operators', 'damageDealt', 'damageTaken', 'kills', 'leaked', 'lp', 'survived', 'bondMax',
]);

/** 一次对局能记的玩家行数上限（= 最大席位数）。 */
export const HISTORY_MAX_ROWS = 8;

/** 一条回放最多存多少字节（压缩后）；超过就只留结算，不留回放。 */
export const REPLAY_MAX_BYTES = 2 * 1024 * 1024;
