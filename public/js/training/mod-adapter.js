// Local training state for the PC's existing, trusted cosmetic observers.
// No socket, account, room service or official game store is imported here.
export function createTrainingModAdapter(scope = globalThis) {
  if (scope.__SP__ || scope.__SP_RUNNER__) throw new Error('训练 Mod 状态不能覆盖已有游戏会话');
  const subscribers = new Set(), feeds = new Set();
  let raw = {}, serial = 0, disposed = false;
  const player = { playerId: 'training', lp: 100, alive: true, isBot: false };
  let state = { connection: { status: 'online' }, me: { playerId: 'training' }, room: { code: 'LOCAL-TRAINING-0', inMatch: false, seats: [player], spectators: [] }, match: { public: { phase: 'LOBBY', round: 0, modeId: 'coop', players: [player] }, private: { board: [] }, field: null, result: null } };
  const facade = Object.freeze({ training: true, store: Object.freeze({ get: () => state, subscribe(fn) { if (typeof fn !== 'function' || disposed) return () => {}; subscribers.add(fn); return () => subscribers.delete(fn); } }), data: Object.freeze({ get: key => raw[key] }) });
  const runner = Object.freeze({ training: true, on(event, callback) { if (event !== 'ev' || typeof callback !== 'function' || disposed) return () => {}; feeds.add(callback); return () => feeds.delete(callback); } });
  scope.__SP__ = facade; scope.__SP_RUNNER__ = runner;
  const publish = next => { if (disposed) return; state = next; for (const fn of subscribers) fn(state); };
  const phase = (name, round = state.match.public.round) => publish({ ...state, match: { ...state.match, public: { ...state.match.public, phase: name, round } } });
  const stop = () => { scope.__SPDesktopMusic?.stop?.(); };
  return Object.freeze({
    setData(value) { raw = value || {}; },
    start(scenario, field) {
      if (disposed) return;
      serial++;
      const room = { code: 'LOCAL-TRAINING-' + serial, inMatch: false, seats: [player], spectators: [] };
      const board = scenario.units.map((u, i) => ({ kind: 'chess', id: u.chessId, uid: i + 1, row: u.row, col: u.col, items: u.items.map(id => ({ id })) }));
      publish({ connection: { status: 'online' }, me: { playerId: 'training' }, room, match: { public: { phase: 'LOBBY', round: 0, modeId: 'coop', players: [player] }, private: { board }, field: { ...field, local: true, live: true }, result: null } });
      publish({ ...state, room: { ...room, inMatch: true }, match: { ...state.match, public: { ...state.match.public, phase: 'INFO_CHECK' } } });
      phase('ROUND_START', scenario.round);
      phase(scenario.kind === 'boss' ? 'FINAL_ASSAULT' : 'COMBAT');
      scope.__SPDesktopMusic?.resume?.();
    },
    feed(events, time) {
      if (disposed || state.connection.status !== 'online' || !state.room.inMatch || !events?.length) return;
      const batch = { t: 'b.ev', fieldId: state.match.field.fieldId, gt: time, ev: events };
      for (const fn of feeds) fn(batch);
    },
    pause() {
      if (disposed || !state.room.inMatch) return;
      publish({ ...state, connection: { status: 'offline' } });
      scope.__SPDesktopMusic?.suspend?.();
    },
    resume() {
      if (disposed || !state.room.inMatch) return;
      publish({ ...state, connection: { status: 'online' }, match: { ...state.match, public: { ...state.match.public } } });
      scope.__SPDesktopMusic?.resume?.();
    },
    finish() {
      if (disposed) return;
      publish({ ...state, room: { ...state.room, inMatch: false }, match: { ...state.match, public: { ...state.match.public, phase: 'RESULT' } } });
      stop();
    },
    reset() {
      if (disposed) return;
      publish({ ...state, connection: { status: 'online' }, room: { ...state.room, inMatch: false }, match: { ...state.match, field: null, public: { ...state.match.public, phase: 'LOBBY' } } });
      stop();
    },
    dispose() {
      if (disposed) return;
      this.reset(); disposed = true;
      scope.__SPDesktopMusic?.dispose?.(); scope.__SPDesktopUnitMotion?.dispose?.();
      subscribers.clear(); feeds.clear();
      if (scope.__SP__ === facade) delete scope.__SP__;
      if (scope.__SP_RUNNER__ === runner) delete scope.__SP_RUNNER__;
    }
  });
}
