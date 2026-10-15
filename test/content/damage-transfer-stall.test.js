import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

test('Skadi S1 and stead sharing cannot bounce transferred damage between multiple bards and defenders', () => {
  for (const form of ['a', 'b']) {
    const id = `chess_char_6_04_${form}`;
    const skillIndex = getDefaultSource().rawChess(id).skills.find(s => s.skillId === 'skchr_skadi2_1').index;
    const h = makeBattle({
      autoFinish: false,
      defs: { chess: {
        defender: chessRec({ id: 'defender', bonds: ['steadShip'], skill: null }),
        victim: chessRec({ id: 'victim', skill: null }),
      }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, speed: 0 }) } },
      units: [
        { uid: 1, chessId: id, row: 10, col: 4, skillIndex, carryState: { sp: 999 } },
        { uid: 2, chessId: id, row: 11, col: 4, skillIndex, carryState: { sp: 999 } },
        { uid: 3, chessId: 'defender', row: 10, col: 5 },
        { uid: 4, chessId: 'defender', row: 11, col: 5 },
        { uid: 5, chessId: 'victim', row: 10, col: 6 },
      ],
      bonds: { steadShip: { active: true, tier: 2, layers: 0, count: 3 } },
    });
    h.step(2);
    assert.ok(h.unit(1).skill.active && h.unit(2).skill.active);
    const enemy = h.spawn('dummy', { pos: [9, 9] });
    let events = 0;
    h.b.on('damaged', () => {
      // Keep an unfixed implementation bounded so this regression itself cannot hang the test runner.
      if (++events > 1000) { h.b.off('hit'); h.b.off('damaged'); }
    }, { priority: 1000 });
    h.b.dealDamage(enemy, h.unit(3), { amount: 100, type: 'true' });
    assert.ok(events <= 8, `one hit caused ${events} damage events (${form})`);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors[0]));
    h.b.dealDamage(enemy, h.unit(5), { amount: 100, type: 'true' });
    assert.ok(events <= 16, 'subsequent independent hits keep working without recursion');
    checkInvariants(h.b);
  }
});
