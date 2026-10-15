import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { largeRoomBonus, roomStartLp } from '../../shared/constants.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';

test('standard multiplayer reduces fixed core and addon bans independently; zero-weight bonds stay off', () => {
  for (const gameMode of ['normal', 'clone']) for (let capacity = 4; capacity <= 8; capacity++) {
    const h = makeMatch({ humans: 1, capacity, difficulty: 'FUNNY', gameMode, seed: 12 });
    try {
      const m = h.m, base = DATA.config.modes.mode_multi_funny.inactiveBondIds;
      const bonus = largeRoomBonus(capacity);
      for (const core of [true, false]) {
        const count = ids => ids.filter(id => !!m.gd.bond(id).isCore === core).length;
        assert.equal(count(m.staticInactiveBonds), count(base) - bonus, `${gameMode} ${capacity} core=${core}`);
      }
      for (const id of base.filter(id => !(m.gd.bond(id).weight > 0))) assert.ok(m.gd.modeInactiveBonds.has(id));
      assert.equal(m.disabledBonds.length, capacity === 4 ? 1 : 0);
      assert.deepEqual(m.publicView().staticInactiveBonds, m.staticInactiveBonds);
      assert.deepEqual([...m.gd.modeInactiveBonds].sort(), m.staticInactiveBonds);
      for (const id of m.gd.visibleChess) {
        const off = new Set([...m.staticInactiveBonds, ...m.disabledBonds]);
        const banned = m.gd.chess(id).bonds.length > 0 && m.gd.chess(id).bonds.every(b => off.has(b));
        assert.equal(m.bannedChess.includes(id), banned, id);
        assert.equal(m.pool.has(id), !banned, id);
      }
      for (const bandId of m.gd.bandIds()) assert.equal(m.gd.startLp(bandId), roomStartLp(m.gd.band(bandId).totalHp, capacity));
    } finally { h.m.dispose(); }
  }
});

test('clone inherits the corresponding capacity rules and adds stock x4 / boss HP x15 in five-to-eight-seat rooms', () => {
  for (let capacity = 5; capacity <= 8; capacity++) for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    const normal = makeMatch({ humans: capacity, capacity, difficulty, fake: true, seed: 50 });
    const clone = makeMatch({ humans: capacity, capacity, difficulty, fake: true, seed: 50, gameMode: 'clone' });
    try {
      assert.deepEqual(clone.m.staticInactiveBonds, normal.m.staticInactiveBonds);
      assert.deepEqual(clone.m.disabledBonds, normal.m.disabledBonds);
      assert.deepEqual(clone.m.bannedChess, normal.m.bannedChess);
      assert.deepEqual(clone.m.roomScale, normal.m.roomScale);
      for (const id of normal.m.gd.bandIds()) assert.equal(clone.m.gd.startLp(id), normal.m.gd.startLp(id));
      for (const [id, entry] of normal.m.pool.entries) assert.equal(clone.m.pool.cap(id), entry.cap * 4);
      normal.m.round = normal.m.gd.bossRound; clone.m.round = clone.m.gd.bossRound;
      normal.m.startFinalAssault(false); clone.m.startFinalAssault(false);
      assert.equal(clone.m.bossPool.maxHp, normal.m.bossPool.maxHp * 15);
      assert.ok(normal.m.bossPool.maxHp > bossPoolHp(normal.m.gd, normal.m.bossId, capacity));
    } finally { normal.m.dispose(); clone.m.dispose(); }
  }
});
