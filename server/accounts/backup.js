// server/accounts/backup.js — 备份 / 恢复 / 管理员操作。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// fork 对应的是 `worker/storage/backup.js` + `worker/archive/{archive,outbox,routes}.js` + `tools/archive-backup.mjs`：
// 它把备份写进 R2、带 outbox 重试、并能跨环境导出导入（`SP_ARCHIVE_EXPORT_TOKEN` / `IMPORT_TOKEN`）。本移植是自建
// Node 服务器，**备份就是「导出整个账号库的 JSON」+「把一份 JSON 导回来」** —— 没有 R2、没有 outbox，因为运维者
// 自己就能 `scp` 那个文件。所以这里刻意做小：
//
//   · `exportAll()`  → 一份**带版本与时间戳**的 JSON（可以直接存盘 / 传走）；
//   · `importAll()`  → 校验形状 + **默认 dry-run**（先报「会导入什么」，确认后才真写）；
//   · 三个管理动作：重置密码、看统计、导出/导入。
//
// 安全：
//   · 管理接口要 `SP_ACCOUNT_ADMIN_TOKEN`（**至少 32 字符**）；**没配置时一律拒绝**（不是「默认放行」）；
//   · 令牌比较用定长比较；
//   · 导入**不做合并**（fork 的 archive 是追加式的）：这里是「整库替换」，因为账号库小、语义清楚 —— 合并两套账号
//     需要决定「同一个用户名冲突怎么办」，那是一个产品决定，不该由恢复工具偷偷替你做。要合并请先导出现在这份、
//     手工决定，再导回去。

import { timingSafeEqual, randomBytes } from 'node:crypto';

import { AccountError } from '../../shared/account-protocol.js';
import { validTrophyTable } from './store.js';

/** 备份里的顶层键（导入时按它筛；与 store.js 的表一致）。 */
export const STORE_KEYS = Object.freeze(['users', 'names', 'accounts', 'sessions', 'friends', 'history', 'preferences', 'trophies']);

/**
 * 生成一个高强度随机密码（管理员重置时用，**只显示这一次**）。
 * 用无歧义字母表（去掉 0/O/1/l/I），16 个字符 ≈ 78 bit。
 * 独立导出（不只是 Backup 的方法）：运维脚本 `tools/accounts.mjs` 也要用它。
 */
export function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export class Backup {
  constructor(store, { accounts, history = null, preferences = null, friends = null, now = Date.now } = {}) {
    this.store = store;
    this.accounts = accounts;
    this.history = history;
    this.preferences = preferences;
    this.friends = friends;
    this.now = now;
  }

  /** 配置的管理令牌（**没配置 ⇒ null**，管理接口一律拒绝）。 */
  get adminToken() {
    const t = String(process.env.SP_ACCOUNT_ADMIN_TOKEN || '');
    return t.length >= 32 ? t : null;
  }

  /**
   * 从请求里认出管理员。接受 `Authorization: Bearer <token>` 或 `X-Admin-Token`。
   * @returns {boolean}
   */
  adminFrom(req) {
    const want = this.adminToken;
    if (!want) return false;                        // 没配置 ⇒ 谁都不是管理员
    const h = req.headers.authorization;
    const bearer = typeof h === 'string' && /^Bearer\s+(.+)$/i.test(h.trim()) ? h.trim().replace(/^Bearer\s+/i, '') : null;
    const given = bearer || req.headers['x-admin-token'];
    if (typeof given !== 'string' || given.length !== want.length) return false;
    try {
      return timingSafeEqual(Buffer.from(given), Buffer.from(want));
    } catch {
      return false;
    }
  }

  /** 一份可以存盘的备份。 */
  exportAll() {
    const snapshot = this.store.snapshot();
    return {
      kind: 'stronghold-accounts',
      version: 1,
      exportedAt: this.now(),
      stats: this.store.stats(),
      db: snapshot,
    };
  }

  /** 导入前的形状检查：返回 `{ ok, problems, willImport }`。 */
  check(payload) {
    const problems = [];
    if (!payload || typeof payload !== 'object') return { ok: false, problems: ['不是一个对象'], willImport: null };
    if (payload.kind !== 'stronghold-accounts') problems.push(`kind 不是 stronghold-accounts（是 ${JSON.stringify(payload.kind)}）`);
    const db = payload.db;
    if (!db || typeof db !== 'object') problems.push('缺少 db');
    if (problems.length) return { ok: false, problems, willImport: null };
    // 顶层键逐个看：不认识的丢掉（旧/新版本混用不该炸），但要**报出来**
    const known = new Set(['version', ...STORE_KEYS]);
    for (const k of Object.keys(db)) if (!known.has(k)) problems.push(`未知的顶层键 ${k}（会忽略）`);
    const willImport = {};
    for (const k of STORE_KEYS) {
      const v = db[k];
      if (v == null) { willImport[k] = 0; continue; }
      if (typeof v !== 'object' || Array.isArray(v)) { problems.push(`${k} 不是一个对象`); continue; }
      willImport[k] = Object.keys(v).length;
    }
    if (!validTrophyTable(db.trophies)) problems.push('trophies 累计杯数或结算去重账本无效');
    // 引用完整性：每个 users 指向的 accountId 最好在 accounts 里（缺了不算致命，completePending/登录会发现）
    const accounts = db.accounts ?? {};
    let dangling = 0;
    for (const u of Object.values(db.users ?? {})) if (u?.accountId && !accounts[u.accountId]) dangling++;
    if (dangling) problems.push(`${dangling} 个用户指向不存在的账号（登录时会补资料）`);
    return { ok: !problems.some((p) => !p.includes('会忽略') && !p.includes('会补资料')), problems, willImport };
  }

  /**
   * 导入一份备份。**默认 dry-run**（只报会导入什么，不动数据）。
   * @param {object} payload
   * @param {{dryRun?: boolean}} opts
   */
  importAll(payload, { dryRun = true } = {}) {
    const check = this.check(payload);
    if (!check.ok) throw new AccountError('BAD_BACKUP', 400);
    if (dryRun) return { dryRun: true, ...check };
    const db = payload.db;
    const next = { version: 1, ...Object.fromEntries(STORE_KEYS.map(key => [key, {}])) };
    for (const k of Object.keys(next)) if (db[k] && typeof db[k] === 'object') next[k] = db[k];
    if (db.preferences && typeof db.preferences === 'object') next.preferences = db.preferences;
    this.store.restore(next);
    this.store.flush();
    // 补完半成品（导入的库里可能有「用户已建、资料缺失」）
    const fixed = this.accounts.completePending();
    this.store.flush();
    return { dryRun: false, imported: check.willImport, repaired: fixed, stats: this.store.stats(), problems: check.problems };
  }

  /** 管理统计：账号、好友、历史、配置各有多少。 */
  stats() {
    return {
      store: this.store.stats(),
      history: this.history ? this.history.stats() : null,
      preferences: this.preferences ? this.preferences.stats() : null,
      adminTokenConfigured: !!this.adminToken,
    };
  }

  /** 生成一个高强度随机密码（见模块级的 generatePassword —— 运维脚本也要用同一份实现）。 */
  generatePassword() { return generatePassword(); }
}

