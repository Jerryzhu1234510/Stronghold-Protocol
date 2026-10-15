import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

for (const skillIndex of [0, 1, 2]) for (const elite of [false, true]) {
  test(`Sakiko S${skillIndex + 1} ${elite ? 'elite' : 'normal'} attacks and recovers SP with no enemies`, () => {
    const h = makeBattle({ units: [{ diy: { slot: 5, charId: 'char_4182_oblvns', skillIndex }, elite, row: 10, col: 4 }],
      autoFinish: false, timeLimit: 120 });
    h.step();
    const u = h.unit(`chess_char_5_diy1_${elite ? 'b' : 'a'}`);
    u.skill.setSpTotal(0);
    const attacks = u.stats.attacks;
    h.run(u.s.interval * 2.1);
    assert.ok(u.stats.attacks > attacks);
    assert.ok(u.skill.sp > 0 || u.skill.charges > 0);
    assert.ok(h.eventsOf('atk').some(e => e[1] === u.id && e[2] === 0));
    assert.ok(h.b.projectiles.list.some(p => p.source === u && p.data?.idleNote));
    const before = u.stats.attacks;
    h.b.addBuff(u, { key: 'test:disarm', duration: 5, flags: { disarm: true } });
    h.run(3);
    assert.equal(u.stats.attacks, before, 'disarm still prevents empty attacks');
    checkInvariants(h.b);
  });
}
