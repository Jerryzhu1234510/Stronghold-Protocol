import { randomBytes } from 'node:crypto';
import { MAX_SPECTATORS } from '../shared/constants.js';

// Ephemeral, release-local room tickets. Never persist account tokens, expose
// private room codes to non-friends, or move a player without their final click.
export class FriendRooms {
  constructor(lobby, { send, fail, OK, ERR }) {
    Object.assign(this, { lobby, send, fail, OK, ERR });
    this.tickets = new Map();
    this.sentAt = new Map();
  }
  prune() {
    const now = this.lobby.now();
    for (const [id, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(id);
    for (const [id, at] of this.sentAt) if (now - at > 120000) this.sentAt.delete(id);
  }
  async friends(session) {
    if (!session.accountId || !this.lobby.accounts?.friendIds) throw new Error('请登录账号；好友房间需要新版账号网关');
    const accountId = session.accountId;
    const ids = await this.lobby.accounts.friendIds(accountId);
    if (!session.connected || session.accountId !== accountId) throw new Error('账号连接已变更');
    return new Set(ids);
  }
  current(ticket) {
    const l = this.lobby, room = l.getRoom(ticket.code);
    if (!room || room.disposed || room.createdAt !== ticket.roomCreatedAt || room.matchmaking) return null;
    const host = l.registry.byId(room.hostId);
    const friend = l.registry.byAccountId(ticket.friendId);
    if (!host || host.accountId !== ticket.hostId || !friend?.connected || friend.roomCode !== room.code) return null;
    if (ticket.mode === 'join' && room.match) return null;
    return room;
  }
  notify(id, text) {
    const s = this.lobby.registry.byAccountId(id);
    if (s?.connected) this.send(s, { t: 'friends.notice', text });
  }
  pushState(session, ids) {
    const l = this.lobby;
    this.send(session, { t: 'friends.state',
      friends: [...ids].map(accountId => {
        const target = l.registry.byAccountId(accountId), online = !!target?.connected;
        const room = online ? l.roomOf(target) : null;
        return { accountId, online, room: room && !room.matchmaking && room.mode === 'coop'
          ? { code: room.code, inMatch: !!room.match, freeSeats: room.seats.filter(s => !s).length,
            canJoin: !room.match && room.freeSeat() >= 0,
            canSpectate: room.spectators.length < MAX_SPECTATORS } : null };
      }),
      tickets: [...this.tickets.values()].filter(t => t.fromId === session.accountId || t.toId === session.accountId)
        .filter(t => this.current(t)).map(t => ({ id: t.id, kind: t.kind, mode: t.mode, name: t.name, code: t.code,
          status: t.status, expiresAt: t.expiresAt, incoming: t.toId === session.accountId,
          enter: t.status === 'approved' && t.enterId === session.accountId })),
    });
    return this.OK;
  }
  async handle(session, msg) {
    this.prune();
    const { lobby: l, ERR, fail, OK } = this;
    if (l.draining && msg.t !== 'friends.state') return fail(ERR.WRONG_PHASE, '此版本正在退场，请完成旧局后从最新大厅进入');
    let ids;
    try { ids = await this.friends(session); }
    catch (e) { return fail(ERR.WRONG_PHASE, e.message); }
    if (msg.t === 'friends.state') return this.pushState(session, ids);
    if (msg.t === 'friends.send') {
      if (!ids.has(msg.accountId)) return fail(ERR.BAD_TARGET, '只能向已接受的好友发送');
      const target = l.registry.byAccountId(msg.accountId);
      if (!target?.connected) return fail(ERR.BAD_TARGET, '好友不在当前版本大厅，可能离线或正在旧版本对局');
      const inviting = msg.kind === 'invite';
      const room = l.roomOf(inviting ? session : target);
      if (!room || room.mode !== 'coop' || room.matchmaking || (msg.kind !== 'spectate' && room.match)) return fail(ERR.WRONG_PHASE, '当前房间不能加入');
      if (inviting && !room.seatOf(session.playerId)) return fail(ERR.SPECTATOR);
      const mode = msg.kind === 'spectate' ? 'spectate' : 'join';
      const own = l.roomOf(inviting ? target : session);
      if (own === room) return fail(ERR.BAD_TARGET, '已在这个房间');
      const host = l.registry.byId(room.hostId);
      if (!host?.connected || !host.accountId) return fail(ERR.NOT_HOST, '房主需要在线并登录账号后才能批准申请');
      if (mode === 'join' && room.freeSeat() < 0) return fail(ERR.ROOM_FULL);
      if (mode === 'spectate' && room.spectators.length >= MAX_SPECTATORS) return fail(ERR.ROOM_FULL);
      const duplicate = [...this.tickets.values()].find(t => t.fromId === session.accountId && t.targetId === msg.accountId && t.kind === msg.kind && this.current(t));
      if (duplicate) return OK;
      if (l.now() - (this.sentAt.get(session.accountId) ?? -Infinity) < 3000
        || [...this.tickets.values()].filter(t => t.fromId === session.accountId || t.toId === (inviting ? target.accountId : host.accountId)).length >= 20
        || this.tickets.size >= 2000) return fail(ERR.RATE, '请求过多，请稍后再试');
      const t = { id: randomBytes(12).toString('hex'), code: room.code, roomCreatedAt: room.createdAt,
        targetId: msg.accountId, kind: msg.kind, mode, status: 'pending', hostId: host.accountId, friendId: msg.accountId,
        fromId: session.accountId, toId: inviting ? target.accountId : host.accountId,
        enterId: inviting ? target.accountId : session.accountId,
        name: session.name, expiresAt: l.now() + 120000 };
      // An invitation refers to the inviter staying in the room, not its recipient.
      if (inviting) t.friendId = session.accountId;
      this.tickets.set(t.id, t); this.sentAt.set(session.accountId, l.now());
      this.notify(t.toId, `${session.name}${inviting ? '邀请你加入房间' : mode === 'join' ? '申请加入好友房间' : '申请观战好友房间'}，请打开好友面板处理`);
      return this.pushState(session, ids);
    }
    const t = this.tickets.get(msg.id);
    if (!t || !this.current(t)) return fail(ERR.BAD_TARGET, '申请已过期、房间已变化或好友已离开');
    const otherFriend = t.kind === 'invite' ? t.enterId : t.friendId;
    const relationAccount = t.fromId;
    const stillFriends = await l.accounts.friendIds(relationAccount);
    if (!stillFriends.includes(otherFriend)) { this.tickets.delete(t.id); return fail(ERR.BAD_TARGET, '好友关系已解除'); }
    if (!session.connected || this.tickets.get(t.id) !== t || t.expiresAt <= l.now() || !this.current(t)) return fail(ERR.BAD_TARGET, '房间请求已失效');
    if (msg.t === 'friends.decide') {
      if (t.toId !== session.accountId || t.status !== 'pending') return fail(ERR.BAD_TARGET);
      if (!msg.accept) { this.tickets.delete(t.id); this.notify(t.fromId, '对方已拒绝房间请求'); return this.pushState(session, ids); }
      t.status = 'approved'; t.expiresAt = l.now() + 120000;
      this.notify(t.enterId, '房间请求已通过，请在好友面板点击进入');
      return this.pushState(session, ids);
    }
    if (msg.t === 'friends.enter') {
      if (t.enterId !== session.accountId || t.status !== 'approved') return fail(ERR.BAD_TARGET);
      const cur = l.roomOf(session);
      if (cur?.match) return fail(ERR.ROOM_STARTED, '请先打完当前对局再进入好友房间');
      // Recheck after the await, and use the normal capacity, spectator and join
      // handlers: two accepted tickets never overfill the last seat.
      const room = this.current(t);
      if (!room) return fail(ERR.BAD_TARGET, '房间已变化');
      const result = t.mode === 'spectate' ? l.spectate(session, { code: room.code }) : l.join(session, { code: room.code });
      if (!result?.error) this.tickets.delete(t.id);
      return result;
    }
    return fail(ERR.BAD_MSG);
  }
}
