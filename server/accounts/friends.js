// server/accounts/friends.js — 好友列表。**fork 没有这个功能**，所以这一套是本移植的新设计（见 docs/ACCOUNT-PLAN 说明）。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 设计取舍（都是刻意的）：
//   · **请求/接受两步**，不是「直接加」—— 单方面的加好友等于骚扰开关，两步让被加的人有决定权；
//   · **对称存两份**（A→B 与 B→A 各一条，内容相同）：查一个人的好友表是一次 O(1) 查找，不用扫全库；
//   · **状态只有两个**：`pending`（等对方接受）与 `accepted`。没有「拉黑」（那是另一件事，规模也不一样）；
//   · **不用用户名加好友**：用户名是登录标识、从不外露（见 account-protocol.js），所以按**「代号#编号」**或**代号**加；
//   · **上限 200 个好友**：好友列表是内存里的，一个账号塞十万个好友会把 JSON 库撑爆；
//   · **请求 14 天过期**：挂着不管的请求不会永远占着列表（读的时候顺手判过期，不跑定时器）。
//
// 客户端需要的是「谁在线」—— 在线状态**不在这个模块**：那是房间/会话层的事（`/api/friends` 只回关系，
// 在线的部分由客户端对着房间列表自己判断，或者在后续的在线大厅一轮里补）。

import {
  AccountError, FRIEND_MAX, FRIEND_REQUEST_MS,
} from '../../shared/account-protocol.js';

export class Friends {
  constructor(accounts, { now = Date.now } = {}) {
    this.accounts = accounts;
    this.store = accounts.store;
    this.now = now;
  }

  /** 一条关系是否已经过期（pending 挂太久）。 */
  #expired(row) {
    return row?.state === 'pending' && this.now() - row.since > FRIEND_REQUEST_MS;
  }

  /**
   * 把一个目标解析成账号 id。
   * 接受账号 id 本身，也接受「代号」或「代号#编号」（显示名）—— 客户端从搜索结果里拿到 id 直接用，
   * 手输的时候用显示名。
   */
  #resolve(target) {
    const raw = String(target ?? '').trim();
    if (!raw) throw new AccountError('INVALID_TARGET');
    const profile = this.store.getProfile(raw);          // 直接给了账号 id
    if (profile) return profile.accountId;
    const found = this.accounts.find(raw);
    if (found.length === 1) return found[0].accountId;
    if (found.length > 1) throw new AccountError('AMBIGUOUS_TARGET', 409);
    throw new AccountError('NO_ACCOUNT', 404);
  }

  /** 一个账号的好友表，已清掉过期项。 */
  #table(accountId) {
    const table = this.store.friendsOf(accountId);
    for (const [peer, row] of Object.entries(table)) {
      if (this.#expired(row)) this.store.dropFriendship(accountId, peer);
    }
    return this.store.friendsOf(accountId);
  }

  /**
   * `/api/friends` 的答复：`{ friends, incoming, outgoing }`。
   *   friends   已接受（双方都在这里）
   *   incoming  别人发给我、等我接受
   *   outgoing  我发出去、等对方接受
   * 每一项都带上对方的公开资料（客户端要显示名字）—— **只有公开资料**，没有用户名。
   */
  view(accountId) {
    const table = this.#table(accountId);
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const [peer, row] of Object.entries(table)) {
      const profile = this.accounts.profileOf(peer);
      if (!profile) continue;                              // 对方账号没了：跳过（不清理，留给移除逻辑）
      const item = { ...profile, state: row.state, since: row.since, by: row.by };
      if (row.state === 'accepted') out.friends.push(item);
      else if (row.by === accountId) out.outgoing.push(item);
      else out.incoming.push(item);
    }
    const byName = (a, b) => a.name.localeCompare(b.name, 'zh');
    out.friends.sort(byName);
    out.incoming.sort(byName);
    out.outgoing.sort(byName);
    return out;
  }

  /** 已接受的好友数。 */
  acceptedCount(accountId) {
    return Object.values(this.#table(accountId)).filter((r) => r.state === 'accepted').length;
  }

  /**
   * 发一条好友请求。
   * 幂等：已经发出去了再点一次不算错（返回现有那条）；对方已经发给我了 ⇒ **直接成为好友**（互相加 = 同意）。
   */
  request(accountId, target) {
    const peer = this.#resolve(target);
    if (peer === accountId) throw new AccountError('SELF_FRIEND', 400);
    const existing = this.store.friendship(accountId, peer);
    if (existing && !this.#expired(existing)) {
      if (existing.state === 'accepted') return { ...this.accounts.profileOf(peer), state: 'accepted', mutual: false };
      // 对方先发给我的 ⇒ 我这一发等于接受
      if (existing.by !== accountId) return this.accept(accountId, peer);
      return { ...this.accounts.profileOf(peer), state: 'pending', by: accountId };
    }
    if (this.acceptedCount(accountId) >= FRIEND_MAX) throw new AccountError('FRIEND_LIST_FULL', 409);
    if (this.acceptedCount(peer) >= FRIEND_MAX) throw new AccountError('PEER_LIST_FULL', 409);
    const row = { state: 'pending', since: this.now(), by: accountId };
    this.store.setFriendship(accountId, peer, row);
    this.store.flush();
    return { ...this.accounts.profileOf(peer), ...row };
  }

  /** 接受一条别人发来的请求。 */
  accept(accountId, target) {
    const peer = this.#resolve(target);
    const existing = this.store.friendship(accountId, peer);
    if (!existing || this.#expired(existing)) throw new AccountError('NO_REQUEST', 404);
    if (existing.state === 'accepted') return { ...this.accounts.profileOf(peer), state: 'accepted' };
    if (existing.by === accountId) throw new AccountError('NOT_YOUR_REQUEST', 400);   // 自己发的不算
    if (this.acceptedCount(accountId) >= FRIEND_MAX) throw new AccountError('FRIEND_LIST_FULL', 409);
    const row = { state: 'accepted', since: this.now(), by: existing.by, acceptedAt: this.now() };
    this.store.setFriendship(accountId, peer, row);
    this.store.flush();
    return { ...this.accounts.profileOf(peer), ...row };
  }

  /** 移除好友，或撤回自己发出的请求，或拒绝别人发来的请求 —— 三件事都是「删掉这条关系」。 */
  remove(accountId, target) {
    const peer = this.#resolve(target);
    return this.store.dropFriendship(accountId, peer);
  }
}
