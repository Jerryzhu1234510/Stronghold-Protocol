// server/accounts/store.js — 账号数据的存储层：一个 JSON 文件 + 内存索引 + 原子写。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 为什么不是 SQLite：fork 用 Durable Object 的 SQLite，那是 **Cloudflare 逼出来的**（DO 只有 SQL）。本移植跑在自建
// Node 服务器上，账号量级是几百到几千，用 JSON 文件就够 —— 零新依赖（SQLite 要原生编译，Docker 镜像和服务器上
// 都要额外的构建工具链），而且**备份就是复制一个文件**。真到了需要事务的规模，换 SQLite 只需替掉这个文件。
//
// 存的是一份 `{ version, users, names, accounts, sessions, friends, history }`：
//   users     用户名 → { accountId, username, password: {alg,iterations,salt,hash} }   （登录标识，从不外露）
//   names     代号键 → { nickname, taken: [编号...] }                                  （编号唯一性，注意是**键**不是原文）
//   accounts  账号 id → profile（对外身份：provider / nickname / discriminator / name / avatarUrl）
//   sessions  会话 token → { accountId, createdAt, lastSeenAt, expiresAt }
//   friends   账号 id → { [对端账号 id]: { state, since, by } }
//   history   账号 id → [一条对局记录, 越新越靠前]
//   preferences 账号 id → { [项]: 值, updatedAt }                                （跨设备配置同步）
//   trophies 账号 id → 永久半杯整数总额 + 有界结算去重账本（不随历史裁剪）
//
// 原子写：先写 `<file>.tmp`，fsync，再 rename 覆盖 —— rename 在同一文件系统上是原子的，所以进程在写的中途被杀
// 也不会留下半个文件。写是**合并**的：一次 tick 内多次 `markDirty()` 只落一次盘。

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** 存储文件的版本（将来改结构时按它迁移）。 */
export const STORE_VERSION = 1;

// 保留近期乱序结算；淘汰记录的时间水位永久保留，旧记录即使不在历史里也不能再次领奖。
export const TROPHY_RECEIPT_MAX = 512;
export const trophyHalfUnits = value => typeof value === 'number' && value >= 0
  && Number.isSafeInteger(value * 2) ? value * 2 : 0;
const validTime = value => Number.isSafeInteger(value) && value > 0;
const validMatchId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

/** 载入/备份恢复共用校验：损坏的去重状态不能悄悄清空后重新发杯。旧库允许没有该表。 */
export function validTrophyTable(table) {
  if (table == null) return true;
  if (!isObject(table)) return false;
  return Object.values(table).every(row => isObject(row)
    && Number.isSafeInteger(row.totalHalfUnits) && row.totalHalfUnits >= 0
    && Number.isSafeInteger(row.settledThrough) && row.settledThrough >= 0
    && Array.isArray(row.recent) && row.recent.length <= TROPHY_RECEIPT_MAX
    && new Set(row.recent.map(item => item?.matchId)).size === row.recent.length
    && row.recent.every(item => isObject(item) && validMatchId(item.matchId)
      && validTime(item.endedAt) && item.endedAt > row.settledThrough));
}

const emptyDb = () => ({
  version: STORE_VERSION,
  users: {}, names: {}, accounts: {}, sessions: {}, friends: {}, history: {}, preferences: {}, trophies: {},
});

export class AccountStore {
  /**
   * @param {object} opts
   * @param {string} opts.file      数据文件路径（目录会被创建）
   * @param {number} [opts.flushMs] 合并写盘的间隔（默认 250 ms；测试里传 0 让每次改动立刻落盘）
   * @param {() => number} [opts.now] 取当前时间（测试可注入）
   */
  constructor({ file, flushMs = 250, now = Date.now } = {}) {
    if (!file) throw new Error('AccountStore needs a file');
    this.file = path.resolve(file);
    this.tmp = `${this.file}.tmp`;
    this.flushMs = Math.max(0, flushMs);
    this.now = now;
    this.db = emptyDb();
    this._dirty = false;
    this._timer = null;
    this._writing = false;
    this.load();
  }

  // ── 载入 / 落盘 ───────────────────────────────────────────────────────────────────────────────

  /** 读数据文件。不存在 ⇒ 空库（首次运行）。文件坏了**不静默吞掉**：备份成 `.corrupt` 再起空库，避免把玩家数据覆盖掉。 */
  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return this;                       // 首次运行
    }
    try {
      const parsed = JSON.parse(raw);
      if (!validTrophyTable(parsed.trophies)) throw new Error('Invalid trophy ledger');
      const base = emptyDb();
      // 只认已知的顶层键，未知的丢掉（旧版本或手改过的文件不该带进来奇怪的东西）
      for (const k of Object.keys(base)) if (k === 'version' || parsed[k]) base[k] = parsed[k];
      base.version = STORE_VERSION;
      this.db = base;
    } catch {
      const backup = `${this.file}.corrupt-${this.now()}`;
      try { fs.renameSync(this.file, backup); } catch { /* 尽力而为 */ }
      console.error(`[accounts] ${this.file} 不是合法 JSON，已备份到 ${backup}，以空库启动`);
      this.db = emptyDb();
    }
    return this;
  }

  /** 标记有改动；按 `flushMs` 合并写盘。 */
  markDirty() {
    this._dirty = true;
    if (this.flushMs === 0) { this.flush(); return this; }
    if (this._timer) return this;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.flushMs);
    if (this._timer.unref) this._timer.unref();   // 别让一个待写盘把进程钉住
    return this;
  }

  /** 立刻落盘（原子：写临时文件 → rename）。 */
  flush() {
    if (!this._dirty) return this;
    this._dirty = false;
    const body = JSON.stringify(this.db);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const fd = fs.openSync(this.tmp, 'w');
      try {
        fs.writeFileSync(fd, body, 'utf8');
        fs.fsyncSync(fd);               // 先落盘再 rename，断电也不会得到一个空文件
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(this.tmp, this.file);
    } catch (e) {
      this._dirty = true;               // 写失败就保持脏，下次再试
      console.error(`[accounts] 写入 ${this.file} 失败：`, e.message);
    }
    return this;
  }

  /** 进程退出前调用（server/index.js 的退出钩子）。 */
  close() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.flush();
  }

  // ── 账号 ───────────────────────────────────────────────────────────────────────────────────────

  /** 一个新的账号 id（不含用户可猜的部分）。 */
  newAccountId() {
    return `a_${randomBytes(12).toString('hex')}`;
  }

  getProfile(accountId) { return this.db.accounts[accountId] ?? null; }

  putProfile(accountId, profile) {
    this.db.accounts[accountId] = profile;
    this.markDirty();
    return profile;
  }

  /** 按用户名找账号（**大小写不敏感**；存的是玩家输入时的大小写）。 */
  findUser(username) {
    const key = String(username).toLowerCase();
    const u = this.db.users[key];
    return u ? { key, ...u } : null;
  }

  putUser(username, record) {
    const key = String(username).toLowerCase();
    this.db.users[key] = { ...record, username };
    this.markDirty();
    return key;
  }

  /** 删除一个用户名（改用户名/删号时用；编号与账号资料各自处理）。 */
  deleteUser(username) {
    const key = String(username).toLowerCase();
    if (!this.db.users[key]) return false;
    delete this.db.users[key];
    this.markDirty();
    return true;
  }

  // ── 编号（代号#NNNN）──────────────────────────────────────────────────────────────────────────

  /** 某个代号键已经占了哪些编号。 */
  takenFor(nameKey) { return this.db.names[nameKey]?.taken ?? null; }

  /**
   * 给一个代号键占一个编号：`prefer` 空闲就用它（改名时保留原编号），否则随机找一个没被占的。
   * 10000 个编号全满 ⇒ 返回 null（调用方回答「这个代号满了，换一个」）。
   */
  claimNumber(nameKey, nickname, prefer = null) {
    const row = (this.db.names[nameKey] ??= { nickname, taken: [] });
    row.nickname = nickname;
    const taken = new Set(row.taken);
    if (prefer != null && prefer >= 0 && prefer <= 9999 && !taken.has(prefer)) {
      row.taken.push(prefer);
      this.markDirty();
      return prefer;
    }
    if (taken.size >= 10000) return null;
    // 随机起点往后扫：10000 个编号，占用率高时也不会退化成顺序扫很久
    const start = randomBytes(2).readUInt16BE(0) % 10000;
    for (let i = 0; i < 10000; i++) {
      const n = (start + i) % 10000;
      if (!taken.has(n)) {
        row.taken.push(n);
        this.markDirty();
        return n;
      }
    }
    return null;
  }

  /** 释放一个编号（改名后旧编号空闲）。 */
  releaseNumber(nameKey, n) {
    const row = this.db.names[nameKey];
    if (!row) return false;
    const i = row.taken.indexOf(n);
    if (i < 0) return false;
    row.taken.splice(i, 1);
    if (!row.taken.length) delete this.db.names[nameKey];
    this.markDirty();
    return true;
  }

  // ── 会话 ───────────────────────────────────────────────────────────────────────────────────────

  putSession(token, session) {
    this.db.sessions[token] = session;
    this.markDirty();
    return session;
  }

  getSession(token) { return this.db.sessions[token] ?? null; }

  deleteSession(token) {
    if (!this.db.sessions[token]) return false;
    delete this.db.sessions[token];
    this.markDirty();
    return true;
  }

  /** 删掉一个账号的全部会话（改密码、重置密码时用）。`keep` 是仍保留的那个 token。 */
  deleteSessionsOf(accountId, keep = null) {
    let n = 0;
    for (const [token, s] of Object.entries(this.db.sessions)) {
      if (s.accountId !== accountId || token === keep) continue;
      delete this.db.sessions[token];
      n++;
    }
    if (n) this.markDirty();
    return n;
  }

  sessionsOf(accountId) {
    return Object.entries(this.db.sessions).filter(([, s]) => s.accountId === accountId);
  }

  /** 清掉过期会话（启动时与每次登录时顺手做）。 */
  pruneSessions(now = this.now()) {
    let n = 0;
    for (const [token, s] of Object.entries(this.db.sessions)) {
      if (s.expiresAt <= now) { delete this.db.sessions[token]; n++; }
    }
    if (n) this.markDirty();
    return n;
  }

  // ── 好友 ───────────────────────────────────────────────────────────────────────────────────────

  /** 一个账号的好友表：`{ [对端]: { state, since, by } }`。 `by` 是谁发的请求。 */
  friendsOf(accountId) { return this.db.friends[accountId] ?? {}; }

  friendship(a, b) {
    const row = this.db.friends[a]?.[b];
    return row ? { ...row } : null;
  }

  setFriendship(a, b, row) {
    (this.db.friends[a] ??= {})[b] = row;
    (this.db.friends[b] ??= {})[a] = row;
    this.markDirty();
    return row;
  }

  dropFriendship(a, b) {
    let hit = false;
    if (this.db.friends[a]?.[b]) { delete this.db.friends[a][b]; hit = true; }
    if (this.db.friends[b]?.[a]) { delete this.db.friends[b][a]; hit = true; }
    if (hit) this.markDirty();
    return hit;
  }

  // ── 对局历史 ───────────────────────────────────────────────────────────────────────────────────

  historyOf(accountId) { return this.db.history[accountId] ?? []; }

  pushHistory(accountId, record, max) {
    const list = (this.db.history[accountId] ??= []);
    list.push(record);
    list.sort((a, z) => (z.endedAt - a.endedAt) || (a.matchId < z.matchId ? 1 : -1));
    if (list.length > max) list.length = max;
    this.markDirty();
    return record;
  }

  /** 公开的累计杯数；旧账号从 0 开始，不从旧历史猜算或补分。 */
  totalTrophiesOf(accountId) {
    return (this.db.trophies[accountId]?.totalHalfUnits || 0) / 2;
  }

  /**
   * 仅权威服务端结算调用；历史和加杯在同一次原子保存里写入。
   * 稳定 endedAt 由首次结算生成，禁止重试时换成当前时间。
   * 最近 512 个结算支持乱序；早于永久淘汰水位的首次迟到结算也拒绝，不能冒重复加杯的风险。
   */
  recordAccountOutcome(accountId, record, max) {
    if (!this.getProfile(accountId) || !validMatchId(record.matchId) || !validTime(record.endedAt)) return false;
    if (this.historyOf(accountId).some(row => row.matchId === record.matchId)) return false;
    const previous = this.db.trophies[accountId] || { totalHalfUnits: 0, settledThrough: 0, recent: [] };
    if (record.endedAt <= previous.settledThrough || previous.recent.some(row => row.matchId === record.matchId)) return false;
    const totalHalfUnits = previous.totalHalfUnits + trophyHalfUnits(record.trophies);
    if (!Number.isSafeInteger(totalHalfUnits)) throw new RangeError('Trophy total exceeds safe integer range');
    let recent = [...previous.recent, { matchId: record.matchId, endedAt: record.endedAt }];
    let settledThrough = previous.settledThrough;
    if (recent.length > TROPHY_RECEIPT_MAX) {
      recent.sort((a, b) => a.endedAt - b.endedAt || a.matchId.localeCompare(b.matchId));
      settledThrough = Math.max(settledThrough, recent[recent.length - TROPHY_RECEIPT_MAX - 1].endedAt);
      // 同毫秒的结算作为一组淘汰；避免保存无限多的同时间键，也不让其重送绕过去重。
      recent = recent.filter(row => row.endedAt > settledThrough);
    }
    this.db.trophies[accountId] = { totalHalfUnits, settledThrough, recent };
    this.pushHistory(accountId, record, max);
    return true;
  }

  // ── 统计 / 备份 ────────────────────────────────────────────────────────────────────────────────

  stats() {
    const db = this.db;
    return {
      accounts: Object.keys(db.accounts).length,
      users: Object.keys(db.users).length,
      nicknames: Object.keys(db.names).length,
      sessions: Object.keys(db.sessions).length,
      friendPairs: Math.round(Object.values(db.friends).reduce((n, r) => n + Object.keys(r).length, 0) / 2),
      historyRows: Object.values(db.history).reduce((n, l) => n + l.length, 0),
      bytes: Buffer.byteLength(JSON.stringify(db)),
    };
  }

  /** 整库快照（备份用）。 */
  snapshot() { return JSON.parse(JSON.stringify(this.db)); }

  /** 用一份快照替换整库（恢复用）。调用方负责校验快照的形状。 */
  restore(snapshot) {
    if (!validTrophyTable(snapshot?.trophies)) throw new Error('Invalid trophy ledger');
    const base = emptyDb();
    for (const k of Object.keys(base)) if (snapshot?.[k] && typeof snapshot[k] === 'object') base[k] = snapshot[k];
    this.db = base;
    this.markDirty();
    return this;
  }
}
