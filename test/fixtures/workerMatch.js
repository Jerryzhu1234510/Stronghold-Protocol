import { threadId } from 'node:worker_threads';
import { StubMatch } from '../../server/match/StubMatch.js';
import { ERR } from '../../shared/constants.js';

export class Match extends StubMatch {
  handle(id, msg) {
    if (msg.t === 'g.pause') {
      if (msg.on) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      return { error: ERR.WRONG_PHASE, detail: `worker ${threadId}` };
    }
    return super.handle(id, msg);
  }
  setLoadout() { return { error: ERR.WRONG_PHASE, detail: 'loadout locked in test engine' }; }
}
