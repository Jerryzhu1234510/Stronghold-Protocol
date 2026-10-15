import { parentPort, workerData } from 'node:worker_threads';
import { getData } from '../../data.js';
import { ERR } from '../../../shared/constants.js';

const publish = event => parentPort.postMessage(event);
const report = (level, args) => publish({ op: 'log', level,
  message: args.map(v => String(v?.stack || v)).join(' ').slice(0, 4096) });
const log = { info() {}, debug() {}, warn(...args) { report('warn', args); }, error(...args) { report('error', args); } };
// Initialise the data singleton before importing engines that also access it.
const data = getData({ dir: workerData.dataDir, log });
const { Match } = await import(workerData.matchModule || '../Match.js');
const { VersusMatch } = await import('../../versus/match.js');
const matches = new Map();
const fatal = (id, e) => publish({ op: 'fatal', id, error: String(e?.message || e).slice(0, 512) });
const dispose = id => {
  const match = matches.get(id); matches.delete(id);
  try { match?.dispose(); } catch (e) { fatal(id, e); }
};
parentPort.on('message', event => {
  const { op, id, rid } = event;
  try {
    if (op === 'create') {
      const Engine = event.opts.gameMode === 'versus' ? VersusMatch : Match;
      const live = payload => { if (matches.has(id)) publish({ ...payload, id }); };
      const match = new Engine({ ...event.opts, data, log, now: Date.now,
        send: (playerId, msg) => { live({ op: 'send', playerId, msg }); return true; },
        sendMany: (playerIds, msg) => { live({ op: 'sendMany', playerIds, msg }); return playerIds.length; },
        broadcast: msg => live({ op: 'broadcast', msg }),
        // ACK an end-producing command before publishing the end/disposal callback.
        onEnd: summary => queueMicrotask(() => live({ op: 'end', summary })),
        onAfk: playerId => live({ op: 'afk', playerId }),
      });
      matches.set(id, match); return;
    }
    if (op === 'dispose') { dispose(id); return; }
    if (op !== 'call') return;
    const match = matches.get(id);
    let result = { error: ERR.WRONG_PHASE, detail: 'match already disposed' };
    if (match) {
      const method = event.method === 'onLeave' && typeof match.onLeave !== 'function' ? 'onDisconnect' : event.method;
      if (typeof match[method] === 'function') {
        result = match[method](...event.args) || { ok: true };
        if (typeof result.then === 'function') throw new Error('match engine methods must be synchronous');
      } else result = method === 'setLoadout' ? { error: ERR.ROOM_STARTED } : { ok: true };
    }
    if (rid != null) publish({ op: 'reply', id, rid, result });
  } catch (e) {
    if (rid != null) publish({ op: 'reply', id, rid, result: { error: ERR.INTERNAL } });
    fatal(id, e); dispose(id);
  }
});
publish({ op: 'ready' });
