import { performance } from 'node:perf_hooks';
import { AssaultRoom } from './assault.js';
import { ERR, PHASE } from '../../shared/constants.js';
import { t } from '../../shared/i18n.js';

// Lobby adapter: use the existing authenticated connection and room lifecycle, not a second player session.
export class VersusMatch {
  constructor(opts) {
    this.opts = opts; this.roomCode = opts.roomCode; this.disposed = false; this.ended = false;
    this.game = new AssaultRoom(opts.roomCode, opts);
    this.players = new Map(); this.watch = new Map(); this.spectators = new Set(opts.spectators || []);
    for (const s of opts.seats) {
      const p = this.game.join(s.name, s.isBot); p.id = s.playerId; p.connected = s.connected;
      p.loadout = s.loadout || {};
      this.players.set(p.id, p);
    }
    this.game.host = opts.seats.find(s => !s.isBot)?.playerId;
  }
  get phase() { return this.game.status === 'info' ? PHASE.INFO_CHECK : this.game.status === 'complete' ? PHASE.RESULT : PHASE.PREP; }
  start() {
    this.game.start(this.game.host); this.flush();
    let last = performance.now(), acc = 0, frames = 0;
    this.timer = setInterval(() => {
      const now = performance.now(); acc += Math.min(1, (now - last) / 1000); last = now;
      try {
        while (acc >= 1 / 30) { this.game.tick(); acc -= 1 / 30; frames++; if (frames % 6 === 0) this.flush(); }
        if (this.game.status === 'complete') {
          this.flush(); this.ended = true; clearInterval(this.timer);
          this.opts.onEnd?.({ gameMode: 'versus', champion: this.game.champion, history: this.game.history });
        }
      } catch (e) { this.opts.log?.error?.('[versus] simulation failed', e); clearInterval(this.timer); }
    }, 16);
    this.timer.unref?.();
  }
  publicView() {
    const room = this.game.publicView();
    return { t: 'm.public', ...room, phase: this.phase, modeId: 'versus', capacity: 4,
      deadline: Date.now() + room.countdown * 1000, serverNow: Date.now(), combatMode: 'server',
      players: room.players.map((p, seat) => ({ ...p, playerId: p.id, seat, isBot: p.bot, alive: !p.eliminated, lp: p.hp, ready: p.infoReady })) };
  }
  flush() {
    if (this.disposed) return;
    this.opts.broadcast(this.publicView());
    const fields = new Map(this.game.duels.map(d => [d.id, this.game.fieldViews(d.id)]));
    for (const id of [...this.players.keys(), ...this.spectators]) this.sendState(id, fields);
  }
  sendState(id, fields) {
    const p = this.players.get(id), pref = this.watch.get(id);
    const duel = this.game.duels.find(d => d.id === pref?.id) || this.game.duels.find(d => d.id === p?.duel) || this.game.duels[0];
    const feeds = duel && (fields?.get(duel.id) || this.game.fieldViews(duel.id));
    const focused = feeds?.[pref?.playerId] ? pref.playerId : feeds?.[id] ? id : duel?.pair[0].id;
    this.opts.send(id, { t: 'm.versus', state: { type: 'state', room: this.game.publicView(),
      me: p ? this.game.privateView(p) : { id, operators: [], monsters: {}, items: [], bonds: {}, shop: {}, coins: 0, level: 1 },
      field: feeds?.[focused] || null, spectator: !p } });
  }
  handle(id, msg) {
    try {
      if (this.disposed || this.ended) throw new Error('本局已结束');
      const command = msg.t === 'g.infoReady' ? { action: 'infoReady' } : msg.t === 'g.watch'
        ? { action: 'watch', id: msg.fieldId, playerId: msg.playerId } : msg.t === 'g.versus' ? msg.command : null;
      if (!command) throw new Error('对抗模式不支持此操作');
      if (command.action === 'watch') {
        const d = this.game.duels.find(d => d.id === command.id);
        if (!d || command.playerId && !d.pair.some(p => p.id === command.playerId)) throw new Error('找不到这个玩家的战场');
        this.watch.set(id, { id: d.id, playerId: command.playerId });
      } else this.game.action(this.players.get(id), command);
      this.flush(); return { ok: true };
    } catch (e) { return { error: ERR.BAD_TARGET, detail: e.message }; }
  }
  onDisconnect(id) { const p = this.players.get(id); if (p) p.connected = false; }
  onReconnect(id) { const p = this.players.get(id); if (p) p.connected = true; this.watch.delete(id); this.flush(); }
  addSpectator(id) { this.spectators.add(id); this.flush(); }
  onLeave(id) {
    const p = this.players.get(id); if (!p) { this.spectators.delete(id); return; }
    p.connected = false;
    const d = this.game.duels.find(d => d.id === p.duel);
    if (d && !d.done) this.game.finishDuel(d, d.pair.find(other => other !== p), t('退出'));
    p.eliminated = true; p.infoReady = true;
  }
  setLoadout(id, loadout) {
    if (this.game.status !== 'info') return { error: ERR.ROOM_STARTED, detail: '已存为下局的调配' };
    const p = this.players.get(id); if (!p) return { error: ERR.BAD_TARGET };
    p.loadout = loadout; return { ok: true };
  }
  dispose() { this.disposed = true; clearInterval(this.timer); }
}
