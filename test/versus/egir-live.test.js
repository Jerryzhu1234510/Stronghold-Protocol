import test from 'node:test';
import assert from 'node:assert/strict';
import { AssaultRoom } from '../../server/versus/assault.js';
import { ownCol } from '../../server/versus/engine.js';
import { data, MONSTERS } from '../../server/versus/catalog.js';
import { tickEgirLayers, installEgirRevives } from '../../server/versus/traits.js';
import { versusBondRecord } from '../../shared/versusBonds.js';
import { VERSUS_RULES } from '../../shared/versusRules.js';
import { detailUnit, monsterPreview } from '../../public/js/versus/details.js';
import { formatBondEffect } from '../../public/js/ui/richText.js';
import { versusCanStand } from '../../shared/versusPlacement.js';

function timerFixture() {
  const p = { layers: {}, operators: [1, 2, 3].map(uid => ({ uid, id: 'chess_char_1_04_a', row: 3 })) };
  const b = { allyUnits: p.operators.map(o => ({ uid: o.uid, alive: true, deployed: true })) };
  return { p, b };
}

test('each fielded Egir member independently gains a layer every five seconds, capped at 200', () => {
  const { p, b } = timerFixture();
  tickEgirLayers(b, p, 4.9); assert.equal(p.layers.egirShip, undefined);
  tickEgirLayers(b, p, .1); assert.equal(p.layers.egirShip, 3);
  tickEgirLayers(b, p, 10); assert.equal(p.layers.egirShip, 9);
  p.layers.egirShip = 199; tickEgirLayers(b, p, 5); assert.equal(p.layers.egirShip, 200);
  assert.ok(p.operators.every(o => o.egirSeconds < 1e-8));
});

test('bench, dead, removed and isolated members do not count; withdrawal resets partial progress', () => {
  const { p, b } = timerFixture();
  tickEgirLayers(b, p, 4);
  p.operators[0].row = null; b.allyUnits[1].alive = false; b.allyUnits[2].hidden = true;
  tickEgirLayers(b, p, 5); assert.equal(p.layers.egirShip, undefined);
  assert.ok(p.operators.every(o => o.egirSeconds === 0));
  p.operators[0].row = 4; b.allyUnits[1].alive = true; b.allyUnits[2].hidden = false;
  tickEgirLayers(b, p, 1); assert.equal(p.layers.egirShip, undefined);
  b.allyUnits[2].removed = true;
  tickEgirLayers(b, p, 4); assert.equal(p.layers.egirShip, 2);
  p.operators.push({ uid: 9, id: 'chess_char_1_01_a', row: 3 });
  b.allyUnits.push({ uid: 9, alive: true, deployed: true });
  tickEgirLayers(b, p, 5); assert.equal(p.layers.egirShip, 4, 'nonmembers never add layers');
});

test('real room clock gains at five real seconds, applies HP/ATK immediately, and publishes native live stats', () => {
  const room = new AssaultRoom('TEST', { seed: 81, stageId: 'act1autochess_m01', prepSeconds: 0, infoSeconds: 0 });
  for (let i = 0; i < 4; i++) room.join(`Player ${i}`);
  room.start(room.host); room.tick();
  const d = room.duels[0], p = d.pair.find(p => p.role === 'defend'), b = room.battleOf(p);
  room.gd.modeInactiveBonds.delete('egirShip');
  for (const id of ['chess_char_1_04_a', 'chess_char_3_05_a', 'chess_char_4_09_a']) {
    const o = room.acquireOperator(p, id);
    let tile;
    for (let row = 2; row <= 5 && !tile; row++) for (let col = 3; col <= 9; col++) {
      const c = ownCol(p, col);
      if (!b.isReservedTile(row, c) && versusCanStand(b.grid, room.stage, row, c, data.chess[id])) { tile = { row, col: c }; break; }
    }
    assert.ok(tile);
    room.action(p, { action: 'deploy', uid: o.uid, ...tile, dir: 'RIGHT' });
  }
  assert.equal(p.bonds.egirShip.active, true);
  const u = b.allyUnits.find(u => u.uid === p.operators[0].uid && u.kind === 'op'), initial = { hp: u.s.maxHp, atk: u.s.atk };
  room.tick(2.5); assert.equal(p.layers.egirShip || 0, 0);
  room.tick(2.5); assert.equal(p.layers.egirShip, 3);
  assert.ok(u.s.maxHp > initial.hp && u.s.atk > initial.atk, JSON.stringify({ initial, hp: u.s.maxHp, atk: u.s.atk, raw: u.def.raw?.bonds, state: p.bonds.egirShip, buffs: [...u.buffs.values()] }));
  assert.ok(b.allyUnits.filter(u => u.kind === 'op').every(u => u.alive), 'no devour damage');
  const field = room.fieldViews(d.id)[p.id], packet = { field, me: { id: p.id } };
  const entry = detailUnit(packet, { uid: u.uid, id: u.defId });
  assert.equal(entry.live.src, 'battle');
  assert.equal(entry.live.atk, Math.round(u.s.atk));
  assert.equal(entry.live.maxHp, Math.round(u.s.maxHp));
  const enemy = b.spawnEnemy(MONSTERS[0].id, { sourcePlayerId: d.pair.find(p => p.role === 'attack').id });
  enemy.hp = 17;
  const next = room.fieldViews(d.id)[p.id];
  const enemyInfo = next.meta.units.find(u => u.kind === 'enemy');
  assert.equal(detailUnit({ ...packet, field: next }, { unitId: enemyInfo.id }).live.hp, 17);
  assert.equal(detailUnit({ ...packet, field: next }, { unitId: enemyInfo.id, fieldId: 'stale' }), null);
});

test('five-member tier revives the first three different members once without devour and resets death timers', () => {
  let death; const revived = [];
  const p = { id: 'defend', bonds: { egirShip: { active: true, count: 5 } }, operators: [] };
  const b = { on: (name, fn) => { if (name === 'death') death = fn; },
    redeploy: u => { revived.push(u.uid); u.alive = true; return true; }, fx: () => {} };
  installEgirRevives(b, p);
  for (let uid = 1; uid <= 4; uid++) {
    const u = { uid, ownerId: p.id, kind: 'op', mem: {}, alive: false, def: { raw: { bonds: ['egirShip'] } } };
    p.operators.push({ uid, egirSeconds: 4 });
    death({ unit: u, reason: 'killed' }); u.alive = false;
    death({ unit: u, reason: 'killed' });
    death({ unit: { ...u, mem: {} }, reason: 'killed' });
    assert.equal(p.operators.at(-1).egirSeconds, 0);
  }
  assert.deepEqual(revived, [1, 2, 3]);
});

test('native immediate Egir revival preserves later knockout rewards and ignores duplicate live death events', () => {
  const room = new AssaultRoom('TEST', { seed: 81, stageId: 'act1autochess_m03', prepSeconds: 0, infoSeconds: 0 });
  for (let i = 0; i < 4; i++) room.join(`Player ${i}`);
  room.start(room.host); room.tick(); room.gd.modeInactiveBonds.delete('egirShip');
  const d = room.duels[0], p = d.pair.find(p => p.role === 'defend'), attacker = d.pair.find(p => p.role === 'attack'), b = room.battleOf(p);
  const members = ['chess_char_1_04_a', 'chess_char_3_05_a', 'chess_char_4_09_a', 'chess_char_4_12_a', 'chess_char_5_05_a'];
  for (const [i, id] of members.entries()) {
    const o = room.acquireOperator(p, id);
    room.action(p, { action: 'deploy', uid: o.uid, row: 2, col: ownCol(p, 3 + i) });
  }
  const unit = b.allyUnits.find(u => u.uid === p.operators[0].uid && u.kind === 'op');
  assert.equal(p.bonds.egirShip.count, 5); attacker.coins = 0;
  p.operators[0].egirSeconds = 4;
  b.kill(unit, null); assert.equal(unit.alive, true); assert.equal(attacker.coins, 5);
  assert.equal(p.operators[0].egirSeconds, 0);
  b.emit('death', { unit, reason: 'killed' }); assert.equal(attacker.coins, 5);
  room.action(p, { action: 'withdraw', uid: unit.uid });
  room.action(p, { action: 'deploy', uid: unit.uid, row: 2, col: ownCol(p, 3) });
  const redeployed = b.allyUnits.find(u => u.uid === unit.uid && !u.removed);
  b.kill(redeployed, null); assert.equal(redeployed.alive, false); assert.equal(attacker.coins, 10);
  b.emit('death', { unit: redeployed, reason: 'killed' }); assert.equal(attacker.coins, 10);
  assert.deepEqual(b.errors, []);
});

test('native bond description reports current bonuses and independent timers without changing other modes', () => {
  const original = structuredClone(data.bonds.egirShip), converted = versusBondRecord(data.bonds.egirShip);
  const text = formatBondEffect(converted, 20);
  assert.match(text, /生命值\+65%/); assert.match(text, /攻击力\+10%/);
  assert.match(text, /每5秒增加1层/); assert.match(text, /独立触发/);
  assert.doesNotMatch(text, /5000|基础攻击力和阻挡数/);
  assert.deepEqual(data.bonds.egirShip, original);
  assert.equal(versusBondRecord(data.bonds.yanShip), data.bonds.yanShip);
  assert.match(VERSUS_RULES.find(([title]) => title === '金币')[1], /扣血\+5/);
  const card = MONSTERS[0], preview = monsterPreview(card, { hp: .7, atk: .7 });
  assert.equal(preview.src, 'prep'); assert.equal(preview.atk, Math.round(card.stats.atk * .7));
});
