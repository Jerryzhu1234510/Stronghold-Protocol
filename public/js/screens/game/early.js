// public/js/screens/game/early.js — which events are replayed when a field is entered late.

import { fxForm } from '../../../../shared/protocol.js';

export const STATE_EV = new Set(['spawn', 'die', 'deploy', 'status', 'skill']);

/** Event tuples replayed when a field is entered late: the state-bearing kinds and the fx that change an enemy's model
 *  form (shared/protocol.js fxForm — the field meta's UnitInfo `form` predates them). */
export const keepEarly = (e) => Array.isArray(e) && (STATE_EV.has(e[0]) || fxForm(e) !== undefined);

/** A late field entry teaches audio about units without replaying old skill or death sounds. */
export const audioEarly = (early) => Array.isArray(early)
  ? early.filter(e => Array.isArray(e) && e[0] === 'spawn') : [];
