// server/accounts/applications.js — 房间的「加入申请」队列（房主审批制）。
// (i18n-ignore-file: 这个文件里的中文只有一处 —— 申请人在没给名字时的**回退名** `博士`（真实的博士代号由 lobby 从会话带进来）。它是数据不是界面文案，界面上的名字直接显示玩家自己的代号，不走 t()。)
//
// 移植自 fork 的 `worker/rooms/applications.js`（**逐条照抄语义**），但换成单进程的普通对象：fork 把它放在每个
// 房间的 Durable Object 里，本移植是自建 Node 服务器，房间本来就在内存里，所以直接挂上去。
//
// 为什么要有这个：0.2.0 原来的加入方式是**同盟密钥**（谁知道密钥谁能进）。要「公开的房间列表 + 房主同意」就得有
// 一层申请：陌生人看到你的房间、申请加入，你决定放不放。仓库里的 `room.join` 不变（密钥仍然是直接进入的路），
// 申请只是**多一条**入口。
//
// 状态机（与 fork 一致）：
//   pending ──房主批准──▶ approved（带一张一次性 ticket，120 s 内有效）──带着 ticket join──▶ joined
//      │                     │
//      ├──房主拒绝──▶ rejected
//      ├──申请人取消─▶ cancelled
//      └──超时（120 s）▶ expired
// 结束的状态还留 10 分钟再消失 —— 申请人得看得到「我被拒了 / 过期了」，而不是列表里凭空少一条。
//
// 几个刻意的规则：
//   · **一个账号在同一房间只有一条申请**：取消、被拒之后重新申请是**替换**那条结束的，列表不会越滚越长；
//   · **批准时就要扣座位**（`room.freeSeats > reservedCount()`）：否则同时批准 5 个人会超卖，最后一个进不来；
//   · 待处理申请每个房间最多 20 条（防刷）；
//   · ticket 是一次性的（`consume` 之后变 joined），所以批准的那个链接转发给别人也没用。

import { randomBytes } from 'node:crypto';

/** 一条申请的有效期（与 account-protocol 的 ACCOUNT_LIMITS.applicationMs 一致）。 */
export const APPLICATION_MS = 120000;
/** 批准之后那张 ticket 的有效期。 */
export const APPROVAL_MS = 120000;
/** 结束的申请在列表里再留这么久（让申请人看得到结果）。 */
export const KEEP_ENDED_MS = 600000;
/** 一个房间最多有多少条待处理申请。 */
export const MAX_PENDING = 20;

/** 结束状态（会按 KEEP_ENDED_MS 清理）。 */
const ENDED = new Set(['rejected', 'cancelled', 'expired', 'joined']);

export class ApplicationQueue {
  /**
   * @param {{ snapshot?: object[], now?: () => number }} [opts]
   */
  constructor({ snapshot = [], now = Date.now } = {}) {
    this.items = (Array.isArray(snapshot) ? snapshot : []).map(({ released, ...item }) => ({ ...item }));
    this.now = typeof now === 'function' ? now : () => now;
  }

  /** 过期的 pending/approved 标记为 expired；结束太久的删掉。 */
  expire() {
    const now = this.now();
    for (const item of this.items) {
      if ((item.status === 'pending' || item.status === 'approved') && item.expiresAt <= now) {
        item.status = 'expired';
        delete item.ticket;
      }
    }
    this.items = this.items.filter((item) => item.expiresAt > now - KEEP_ENDED_MS);
    return this;
  }

  /** 列表。给 `accountId` 就只看那个人的（申请人视角）。 */
  list(accountId = null) {
    this.expire();
    return this.items
      .filter((x) => !accountId || x.accountId === accountId)
      .map((x) => ({ ...x }));
  }

  /** 已经批准但还没进房的数量（用来算座位）。 */
  reservedCount() {
    return this.list().filter((x) => x.status === 'approved').length;
  }

  /** 还等着房主决定的申请（房主视角要显示的）。 */
  pending() {
    return this.list().filter((x) => x.status === 'pending');
  }

  /**
   * 申请加入。**幂等**：已经有 pending/approved 的直接返回那一条；否则新建（并替换掉自己那些已结束的）。
   * @param {{ accountId: string, name?: string }} who
   */
  apply({ accountId, name = '' }) {
    if (typeof accountId !== 'string' || !accountId) throw new Error('apply needs accountId');
    this.expire();
    const previous = this.items.find((x) => x.accountId === accountId && (x.status === 'pending' || x.status === 'approved'));
    if (previous) return { ...previous };
    if (this.items.filter((x) => x.status === 'pending').length >= MAX_PENDING) {
      const e = new Error('TOO_MANY_APPLICATIONS');
      e.code = 'TOO_MANY_APPLICATIONS';
      e.status = 429;
      throw e;
    }
    this.items = this.items.filter((x) => x.accountId !== accountId);
    const now = this.now();
    const item = {
      id: randomBytes(16).toString('hex'),
      accountId,
      name: String(name || '博士').slice(0, 80),
      status: 'pending',
      createdAt: now,
      expiresAt: now + APPLICATION_MS,
    };
    this.items.push(item);
    return { ...item };
  }

  /**
   * 房主决定。
   * @param {string} actor 操作者（必须是房主）
   * @param {string} id 申请 id
   * @param {'approved'|'rejected'} decision
   * @param {{ hostId: string, inMatch: boolean, freeSeats: number }} room
   */
  decide(actor, id, decision, room) {
    this.expire();
    const bad = (code, status) => { const e = new Error(code); e.code = code; e.status = status; return e; };
    if (actor !== room.hostId) throw bad('NOT_HOST', 403);
    if (room.inMatch) throw bad('ROOM_STARTED', 409);
    const item = this.items.find((x) => x.id === id);
    if (!item || item.status !== 'pending') throw bad('APPLICATION_EXPIRED', 409);
    if (decision !== 'approved' && decision !== 'rejected') throw bad('INVALID_DECISION', 400);
    if (decision === 'approved') {
      // 座位在**批准时**就占住：否则同时批准多人会超卖
      if (room.freeSeats <= this.reservedCount()) throw bad('ROOM_FULL', 409);
      item.ticket = randomBytes(16).toString('hex');
      item.expiresAt = this.now() + APPROVAL_MS;
    }
    item.status = decision;
    return { ...item };
  }

  /** 申请人取消（或撤回）。 */
  cancel(accountId, id) {
    const item = this.items.find((x) => x.id === id && x.accountId === accountId);
    const bad = (code, status) => { const e = new Error(code); e.code = code; e.status = status; return e; };
    if (!item) throw bad('APPLICATION_NOT_FOUND', 404);
    if (item.status === 'joined') throw bad('ALREADY_JOINED', 409);
    if (item.status === 'pending' || item.status === 'approved') {
      item.status = 'cancelled';
      delete item.ticket;
    }
    return { ...item };
  }

  /** 这条申请再也批不了了（申请人跑去别处了）：标成过期。 */
  drop(id) {
    const item = this.items.find((x) => x.id === id && (x.status === 'pending' || x.status === 'approved'));
    if (item) {
      item.status = 'expired';
      delete item.ticket;
    }
  }

  /**
   * 用 ticket 换入场资格。**一次性**：成功了就变 joined，再用同一个 ticket 无效。
   * @returns {boolean}
   */
  consume(accountId, ticket) {
    this.expire();
    const item = this.items.find((x) => x.accountId === accountId && x.status === 'approved' && x.ticket === ticket);
    if (!item) return false;
    item.status = 'joined';
    delete item.ticket;
    return true;
  }

  /** 房间关了 / 开新一局：把还挂着的申请全部作废。 */
  invalidate() {
    for (const item of this.items) {
      if (item.status === 'pending' || item.status === 'approved') {
        item.status = 'expired';
        delete item.ticket;
      }
    }
    return this;
  }

  /** 存盘/调试用。 */
  snapshot() { return this.expire().list(); }

  /**
   * 申请人的公开视图（**不带 ticket** —— ticket 只发给申请人自己）。
   *
   * **`accountId` 必须带上**：服务端要靠它把「批准 / 拒绝」那一帧发给申请人（`registry.byId(accountId)`）。
   * 一开始漏了这个字段，于是批准时找不到收件人、那一帧**静默发不出去** —— 申请人永远等不到通知（测试抓到的）。
   * 它不是什么秘密（就是会话身份），而且只发给房主与申请人本人。
   */
  static publicView(item, { includeTicket = false } = {}) {
    if (!item) return null;
    const out = {
      id: item.id,
      accountId: item.accountId,
      name: item.name,
      status: item.status,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    };
    if (includeTicket && item.ticket) out.ticket = item.ticket;
    return out;
  }
}

export { ENDED };
