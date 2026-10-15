import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VersusRoom, ownCol, powerAt } from '../../server/versus/engine.js';
import { OPERATORS, MONSTERS, STAGE, RECT, data } from '../../server/versus/catalog.js';
import { addLayer, metaTrait, traitNotes } from '../../server/versus/traits.js';
import { versusCanStand } from '../../shared/versusPlacement.js';
import { Battle } from '../../server/sim/Battle.js';
import { versusUpgradeState, VERSUS_UPGRADE_COSTS } from '../../shared/versusEconomy.js';

function game(options = {}) {
  const room = new VersusRoom('TEST', { seed: 81, prepSeconds: 0, infoSeconds: 0, stageId: STAGE.id, ...options });
  for (let i = 0; i < 8; i++) room.join(`博士${i}`);
  room.start(room.host); room.tick(); return room;
}
function buy(room, p, card) {
  p.shop[card.kind] = [card.id]; room.action(p, { action: 'buy', kind: card.kind, index: 0 });
}
test('host-only start, exactly eight entrants, Ban confirmation and no strategy selection', () => {
  const r = new VersusRoom('TEST'); const a = r.join('A'), b = r.join('B');
  assert.throws(() => r.start(b.id, true), /房主/);
  assert.throws(() => r.start(a.id), /8/);
  r.start(a.id, true); assert.equal(r.status, 'info'); assert.equal(r.players.length, 8);
  assert.ok(r.publicView().disabledBonds.length > 0);
  assert.throws(() => r.action(a, { action: 'buy', kind: 'operator', index: 0 }), /确认/);
  r.action(a, { action: 'infoReady' }); assert.equal(r.status, 'info');
  r.action(b, { action: 'infoReady' }); assert.equal(r.duels.length, 4);
  assert.equal(r.status, 'preparation'); assert.equal(a.strategy, null);
  assert.throws(() => r.action(a, { action: 'strategy', id: 'band_bldsk' }));
  assert.equal(new Set(r.publicView().duels.map(d => d.color)).size, 4);
  assert.throws(() => r.action(a, { action: 'buy', kind: '__proto__', index: 0 }));
  a.coins = 0; assert.throws(() => buy(r, a, MONSTERS[0]), /金币/);
  assert.equal(a.monsters[MONSTERS[0].id], undefined);
});
test('income is exactly one every two seconds; eliminated players receive none', () => {
  const r = game(), p = r.players[0], other = r.players[1]; p.coins = other.coins = 0; other.eliminated = true;
  for (let i = 0; i < 119; i++) r.tick();
  assert.equal(p.coins, 2); assert.equal(other.coins, 0);
  for (let i = 0; i < 30; i++) r.tick(); assert.equal(p.coins, 2);
  for (let i = 0; i < 30; i++) r.tick(); assert.equal(p.coins, 3);
});

test('coin cap applies to income, selling and both trait reward paths; spending frees capacity', () => {
  const r = game(), p = r.players[0]; p.coins = 99;
  r.tick(4); assert.equal(p.coins,100);
  r.action(p,{action:'refresh'}); assert.equal(p.coins,99);
  r.tick(2); assert.equal(p.coins,100);
  p.monsters[MONSTERS[0].id] = 3;
  r.action(p,{action:'sell',kind:'monster',id:MONSTERS[0].id});
  assert.equal(p.coins,100); assert.equal(p.monsters[MONSTERS[0].id],1);
  p.items.push({uid:999,id:'test'});
  r.action(p,{action:'sell',kind:'equipment',uid:999}); assert.equal(p.coins,100);
  buy(r,p,OPERATORS.find(o=>!r.bannedChess.has(o.id)));
  p.coins=100; r.action(p,{action:'sell',uid:p.operators[0].uid}); assert.equal(p.coins,100);
  const g = {effectKey:'SERVER_ONCE_GOLD',bb:{},bbStr:{}};
  p.economyNext=0; metaTrait(p,{id:OPERATORS[0].id},g,'kill'); assert.equal(p.coins,100);
  p.economyNext=0; assert.equal(r.battleOf(p).addCoins(p.id,3),0); assert.equal(p.coins,100);
  p.coins=99;p.economyNext=0;r.battleOf(p).addCoins(p.id,3);assert.equal(p.coins,100);
  r.refresh(p,false);
  assert.equal(p.shop.operator.length,5);assert.equal(p.shop.monster.length,5);assert.equal(p.shop.equipment.length,1);
});

test('upgrades require defense investment, use progressive prices and enforce a server-side 20-second cooldown', () => {
  const r = game(), p = r.players[0]; p.coins = 1000;
  r.action(p, { action: 'upgrade' }); assert.equal(p.level, 2); assert.equal(p.coins, 990);
  assert.throws(() => r.action(p, { action: 'upgrade' }), /冷却/);
  r.time = p.upgradeNext;
  assert.throws(() => r.action(p, { action: 'upgrade' }), /至少2名/);
  const expectedRoster = [2, 3, 4, 4];
  for (let level = 2; level < 6; level++) {
    r.time = p.upgradeNext;
    p.operators = Array.from({ length: expectedRoster[level - 2] - 1 }, (_, i) => ({ id: 'chess_char_1_18_a', uid: i, row: 5, col: 3 + i }));
    p.operators.push({ id: 'chess_char_2_09_a', uid: 10, row: null, col: null });
    assert.throws(() => r.action(p, { action: 'upgrade' }), /需要部署/);
    p.operators.at(-1).row = 4;
    const before = p.coins;
    r.action(p, { action: 'upgrade' });
    assert.equal(p.coins, before - VERSUS_UPGRADE_COSTS[level]); assert.equal(p.level, level + 1);
    assert.equal(p.upgradeNext, r.time + 20);
  }
  assert.equal(p.stats.spent, 151); assert.throws(() => r.action(p, { action: 'upgrade' }), /最高等级/);
});

test('upgrade rejection is atomic; a fallen deployment counts, while bench, monsters and equipment do not', () => {
  const r = game(), p = r.players[0]; p.coins = 9;
  const before = structuredClone(r.privateView(p));
  assert.throws(() => r.action(p, { action: 'upgrade' }), /资金不足/);
  assert.deepEqual(r.privateView(p), before);
  p.level = 2; p.coins = 18;
  p.operators = [{ row: 5, uid: 1 }, { row: 5, uid: 2, alive: false }, { row: null, uid: 3 }];
  p.monsters = { someEnemy: 40 }; p.items = [{ uid: 4 }];
  assert.equal(versusUpgradeState(p, r.time).reason, null);
  r.action(p, { action: 'upgrade' }); assert.equal(p.coins, 0);
  p.operators[1].row = null; r.time = p.upgradeNext; p.coins = 1000;
  assert.equal(versusUpgradeState(p, r.time).deployed, 1);
  assert.throws(() => r.action(p, { action: 'upgrade' }), /需要部署/);
});

test('upgrade cooldown survives advancement into another duel', () => {
  const r = game(), p = r.duels[0].pair[0]; p.coins = 1000;
  r.action(p, { action: 'upgrade' }); const next = p.upgradeNext;
  for (const duel of r.duels) r.finishDuel(duel, duel.pair[0], 'test');
  r.tick(); assert.equal(r.round, 2); assert.equal(p.upgradeNext, next);
  assert.throws(() => r.action(p, { action: 'upgrade' }), /冷却/);
  r.time = next;
  assert.throws(() => r.action(p, { action: 'upgrade' }), /需要部署/);
});

test('PvP raid added during combat resumes after normal revival on either half without entering the enemy half', () => {
  const r = game(), duel = r.duels[0];
  r.gd.modeInactiveBonds.delete('raidShip');
  for (const p of duel.pair) {
    const b = r.battleOf(p);
    for (const [i, id] of ['chess_char_1_18_a', 'chess_char_2_09_a'].entries()) {
      const o = { id, uid: `${p.id}:raid:${i}`, row: 5, col: 3 + i, dir: 'UP', items: [] };
      p.operators.push(o); r.addOperator(p, o);
    }
    assert.equal(p.bonds.raidShip.active, true);
    const u = b.allyUnits.find(u => u.uid === p.operators[0].uid);
    u.skill = null; u.base.respawnTime = 4; u.markDirty();
    b.kill(u);
    for (let i = 0; i < 150 && !u.alive; i++) b.step();
    assert.ok(u.alive, 'ordinary automatic revival');
    const seq = u.deploySeq;
    const e = b.spawnEnemy(MONSTERS[0].id, { pos: [2, ownCol(p, 4)], ownerPlayerId: p.id,
      route: { start: [2, ownCol(p, 4)], end: [2, ownCol(p, 2)], checkpoints: [] } });
    e.base.maxHp = 1e9; e.hp = 1e9; e.base.moveSpeed = 0; e.base.atk = 0; e.markDirty();
    for (let i = 0; i < 15 && u.deploySeq === seq; i++) b.step();
    assert.ok(u.deploySeq > seq, `${p.side} revival immediately retries raid`);
    assert.ok(u.tileR >= 2 && u.tileR <= 5);
    assert.ok(ownCol(p, u.tileC) >= 3 && ownCol(p, u.tileC) <= 9);
    assert.equal(u.dir, 'UP'); assert.deepEqual(b.errors, []);
  }
});

test('expanded monster shop includes Deep Pool, TIMES and expensive bounty leaders but no final-assault Boss', () => {
  assert.ok(MONSTERS.length > 100);
  for (const id of ['enemy_1174_duholy','enemy_9010_acpupp','enemy_1199_sfjin','enemy_1050_lslime']) assert.ok(MONSTERS.some(m => m.id === id));
  assert.ok(!MONSTERS.some(m => ['enemy_1200_msfjin','enemy_1196_msfyin','enemy_1204_msfhu'].includes(m.id)));
  assert.ok(!MONSTERS.some(m => ['enemy_2016_csphtm','enemy_9032_aclionk','enemy_9033_acdeer','enemy_9013_acstmk'].includes(m.id)));
  const r = game(), p = r.players[0];
  p.level = 1;
  for (let i=0;i<30;i++) { r.refresh(p,false); assert.ok(p.shop.monster.every(id => MONSTERS.find(m=>m.id===id).tier===1)); }
  p.level = 6; const drawn = new Set();
  for (let i=0;i<500;i++) { r.refresh(p,false); for (const id of p.shop.monster) drawn.add(id); }
  for (const m of MONSTERS) assert.ok(drawn.has(m.id),m.id);
  assert.ok(MONSTERS.filter(m=>m.bounty).every(m=>m.price>=11&&m.price<=16&&m.tier===6&&m.quantity===1));
  assert.ok(MONSTERS.every(m=>m.price>=2&&m.price<=16&&[1,2,3].includes(m.quantity)));
  assert.ok(MONSTERS.every(m => m.quantity === (m.tier <= 3 ? 2 : 1)));
  assert.equal(MONSTERS.find(m=>m.id==='enemy_9010_acpupp').price,8);
});

test('all shop monsters spawn with native kits, hit-count units survive large single hits, and child enemies stay in outgoing feed', () => {
  for (const card of MONSTERS) {
    const r=game(), p=r.players[0], opponent=r.duels.find(d=>d.id===p.duel).pair.find(o=>o!==p), b=r.battleOf(opponent);
    p.monsters[card.id]=1;r.action(p,{action:'launch',id:card.id,row:4,col:ownCol(p,9)});
    const e=b.enemies.find(e=>e.versusPurchased);
    assert.ok(e,card.id);
    for(let i=0;i<3;i++)r.tick();
    assert.deepEqual(b.errors,[],card.id);
    if(card.id==='enemy_1200_msfjin') { const hp=e.hp;b.dealDamage(null,e,{amount:100000,type:'true'}); assert.equal(e.hp,hp-1); }
    if(card.id==='enemy_1195_sfyin') {
      b.dealDamage(null,e,{amount:100000,type:'true'});
      const children=b.aliveEnemies().filter(u=>u.defId==='enemy_1196_msfyin');
      assert.equal(children.length,2);assert.ok(children.every(u=>u.sourcePlayerId===p.id&&u.versusPurchased&&u.versusGoal));
      assert.ok(r.fieldViews(p.duel)[p.id].meta.units.filter(u=>u.outgoing).length>=2);
    }
  }
});

test('settlement freezes each finished duel and produces final rankings and lineup/stat summaries', () => {
  const r=game(); const loser=r.duels[0].pair[1];
  r.finishDuel(r.duels[0],r.duels[0].pair[0],'测试');
  const frozen=r.publicView().history[0].results.find(p=>p.id===loser.id);
  loser.stats.kills++;
  assert.equal(frozen.stats.kills,0);assert.equal(frozen.placement,5);
  while(r.status!=='complete') {for(const d of r.duels)r.finishDuel(d,d.pair[0],'测试');r.tick();}
  const result=r.publicView().results;
  assert.equal(result.length,8);assert.deepEqual(result.map(p=>p.placement),[1,2,3,3,5,5,5,5]);
  assert.ok(result.every(p=>Array.isArray(p.lineup)&&p.stats&&p.bonds));
});
test('only own-half operator deployment, facing is mirrored, no secondary DP cost', () => {
  const r = game(), d = r.duels[0];
  for (const p of d.pair) {
    buy(r, p, OPERATORS[0]); const o = p.operators[0];
    assert.throws(() => r.action(p, { action: 'deploy', uid: o.uid, row: 4, col: ownCol(p, 12) }), /己方/);
    const coins = p.coins;
    assert.throws(() => r.action(p, { action: 'deploy', uid: o.uid, row: 6, col: ownCol(p, 4) }), /己方/);
    assert.throws(() => r.action(p, { action: 'deploy', uid: o.uid, row: 4, col: ownCol(p, 5) }), /占用/);
    r.action(p, { action: 'deploy', uid: o.uid, row: 4, col: ownCol(p, 4) });
    const u = r.battleOf(p).allyUnits.find(u => u.uid === o.uid);
    assert.equal(u.dir, p.side === 'L' ? 'RIGHT' : 'LEFT'); assert.equal(u.base.cost, 0); assert.equal(p.coins, coins);
    for (const dir of ['UP','DOWN','LEFT','RIGHT']) {
      r.action(p,{action:'rotate',uid:o.uid,dir});
      assert.equal(u.dir,p.side==='R'?({LEFT:'RIGHT',RIGHT:'LEFT'}[dir]||dir):dir);
    }
    assert.throws(() => r.action(p, { action: 'deploy', uid: o.uid, row: 4, col: ownCol(p, 4) }), /待部署/);
  }
});
test('monster purchase stacks; deployment consumes once, cooldown/cap/zone are authoritative, destination is opposite gate', () => {
  const r = game(), [a, b] = r.duels[0].pair, card = MONSTERS[0];
  buy(r, a, card); buy(r, a, card); assert.equal(a.monsters[card.id], 4);
  assert.throws(() => r.action(a, { action: 'launch', id: card.id, row: 4, col: ownCol(a, 15) }), /前沿/);
  r.action(a, { action: 'launch', id: card.id, row: 4, col: ownCol(a, 9) });
  assert.equal(a.monsters[card.id], 2); const enemy = r.battleOf(b).enemies[0];
  assert.equal(r.battleOf(b).enemies.length,2); assert.equal(a.stats.launched,2);
  assert.ok(Math.abs(r.battleOf(b).enemies.reduce((sum,e)=>sum+e.versusPrice,0)-card.price)<1e-9);
  assert.equal(enemy.sourcePlayerId, a.id); assert.equal(r.battleOf(a).enemies.length, 0);
  assert.throws(() => r.action(a, { action: 'launch', id: card.id, row: 4, col: ownCol(a, 9) }), /冷却/);
  for (let i = 0; i < 2500 && r.battleOf(b).aliveEnemies().length; i++) r.tick();
  assert.equal(b.hp, 18); assert.equal(a.hp, 20); assert.equal(enemy.removeReason, 'leak');
  a.monsters[card.id] = 5; a.launchNext = 0;
  for (let i = 0; i < 20; i++) { const e = r.battleOf(b).spawnEnemy(card.id); e.versusPurchased = true; }
  assert.throws(() => r.action(a, { action: 'launch', id: card.id, row: 4, col: ownCol(a, 9) }), /20/);
  assert.equal(a.monsters[card.id], 5);
});
test('all layer gains stop at 200 even when a native layerGain hook amplifies them; co-op still caps at 999', () => {
  const r = game(), p = r.players[0]; addLayer(p, 'yanShip', 999); addLayer(p, 'yanShip', 4); assert.equal(p.layers.yanShip, 200);
  const b = r.battleOf(p); b.getPlayer(p.id).bonds.yanShip = { active: true, tier: 1, layers: 199 };
  b.on('layerGain', c => { c.n = 1e5; });
  assert.equal(b.addLayers(p.id, 'yanShip', 1), 1); assert.equal(b.getPlayer(p.id).bonds.yanShip.layers, 200);
  assert.equal(b.addLayers(p.id, 'yanShip', 1), 0);
  const coop = new Battle({ content: 'none', players: [{ playerId: 'c', units: [], bonds: { yanShip: { layers: 998 } } }] });
  assert.equal(coop.addLayers('c', 'yanShip', 100), 1); assert.equal(coop.getPlayer('c').bonds.yanShip.layers, 999);
});
test('two-minute opening reduction restores live enemies without healing their HP ratio, then time scaling grows them', () => {
  const r = game(), d = r.duels[0], [a, b] = d.pair, card = MONSTERS[0];
  buy(r, a, card); r.action(a, { action: 'launch', id: card.id, row: 4, col: ownCol(a, 9) });
  const e = r.battleOf(b).enemies[0], hp = e.s.maxHp; e.hp = hp / 2;
  assert.equal(e.versusPower,-1); assert.ok(Math.abs(hp-card.stats.maxHp*.7)<1e-6);
  d.elapsed = 119.99; r.tick(); assert.equal(e.versusPower, 0); assert.ok(Math.abs(e.s.maxHp - hp / .7) < 1e-6);
  assert.ok(Math.abs(e.hp / e.s.maxHp - 0.5) < 1e-6);
  buy(r, a, card); r.action(a, { action: 'launch', id: card.id, row: 5, col: ownCol(a, 9) });
  assert.ok(Math.abs(r.battleOf(b).enemies.at(-1).s.maxHp-hp/.7)<1e-6);
  assert.deepEqual(powerAt(119.999),{level:-1,hp:.7,atk:.7});
  assert.deepEqual(powerAt(120),{level:0,hp:1,atk:1});
  assert.deepEqual(powerAt(179.999),{level:0,hp:1,atk:1});
  assert.deepEqual(powerAt(180),{level:1,hp:1.35,atk:1.15});
  d.elapsed=179.99;r.tick();assert.equal(e.versusPower,1);
  assert.ok(Math.abs(e.s.maxHp-card.stats.maxHp*1.35)<1e-6);
  assert.deepEqual(powerAt(240), { level: 2, hp: 1.35 ** 2, atk: 1.15 ** 2 });
});

test('single and double batches deploy atomically; legacy remainders still deploy', () => {
  for (const quantity of [1,2]) {
    const r=game(),[p,other]=r.duels[0].pair,card=MONSTERS.find(m=>m.quantity===quantity),b=r.battleOf(other);
    p.monsters[card.id]=quantity;
    for(let i=0;i<20-quantity+1;i++){const e=b.spawnEnemy(card.id);e.versusPurchased=true;}
    const size=b.enemies.length;
    assert.throws(()=>r.action(p,{action:'launch',id:card.id,row:4,col:ownCol(p,9)}),/20/);
    assert.equal(p.monsters[card.id],quantity);assert.equal(p.stats.launched,0);assert.equal(p.launchNext,0);assert.equal(b.enemies.length,size);
    b.enemies[0].versusPurchased=false;
    r.action(p,{action:'launch',id:card.id,row:4,col:ownCol(p,9)});
    assert.equal(p.monsters[card.id],undefined);assert.equal(p.stats.launched,quantity);assert.equal(b.enemies.length,size+quantity);
    p.monsters[card.id]=1;p.launchNext=0;
    for(const e of b.enemies)e.versusPurchased=false;
    r.action(p,{action:'launch',id:card.id,row:4,col:ownCol(p,9)});assert.equal(p.stats.launched,quantity+1);assert.equal(p.monsters[card.id],undefined);
  }
});
test('8 -> 4 -> 2 -> 1 waits for every duel; resets combat state and carries roster, inventory and coins', () => {
  const r = game(), d = r.duels[0], winner = d.pair[0]; buy(r, winner, OPERATORS[0]); winner.layers.yanShip = 99;
  r.finishDuel(d, winner, '测试'); r.tick(); assert.equal(r.round, 1);
  const saved = winner.coins;
  for (const pair of r.duels) if (!pair.done) r.finishDuel(pair, pair.pair[0], '测试'); r.tick();
  assert.equal(r.round, 2); assert.equal(r.duels.length, 2); assert.equal(winner.hp, 20); assert.deepEqual(winner.layers, {});
  assert.equal(winner.operators.length, 1); assert.equal(winner.coins, saved);
  for (const pair of r.duels) r.finishDuel(pair, pair.pair[0], '测试'); r.tick(); assert.equal(r.duels.length, 1);
  r.finishDuel(r.duels[0], r.duels[0].pair[0], '测试'); r.tick(); assert.equal(r.status, 'complete'); assert.equal(r.history.length, 7);
  const loser = r.players.find(p => p.eliminated); assert.throws(() => r.action(loser, { action: 'refresh' }), /观战/);
});
test('AI fills eight seats and plays all seven real-simulation duels without engine errors', () => {
  const r = new VersusRoom('TEST', { seed: 42, prepSeconds: 1, duelSeconds: 40 });
  r.join('AI1', true); r.host = 'p1'; r.start('p1', true);
  const battles = [...r.duels.flatMap(d => d.battles)]; let previousRound = r.round;
  for (let i = 0; i < 5000 && r.status !== 'complete'; i++) {
    r.tick(); if (r.round !== previousRound) { previousRound = r.round; battles.push(...r.duels.flatMap(d => d.battles)); }
  }
  assert.equal(r.status, 'complete'); assert.equal(r.history.length, 7);
  for (const b of battles) assert.deepEqual(b.errors, []);
});
test('three copies merge into a genuine elite, retaining the board tile; selling removes the elite rather than its retired body', () => {
  const r = game(), p = r.players[0], card = OPERATORS[0];
  buy(r, p, card); const first = p.operators[0];
  r.action(p, { action: 'deploy', uid: first.uid, row: 4, col: ownCol(p, 4) });
  buy(r, p, card); buy(r, p, card);
  assert.equal(p.operators.length, 1); assert.ok(p.operators[0].id.endsWith('_b'));
  const b = r.battleOf(p), unit = b.allyUnits.find(u => u.uid === first.uid && !u.removed);
  assert.ok(unit.def.golden && unit.alive); assert.equal(unit.tileC, ownCol(p, 4));
  r.action(p, { action: 'sell', uid: first.uid }); assert.equal(unit.alive, false); assert.equal(p.operators.length, 0);
});
test('delayed gold never refunds purchases or sales and kill reward cannot exceed one per four seconds', () => {
  const r = game(), p = r.players[0], g = { effectKey: 'SERVER_ONCE_GOLD', bb: { count: 20 } };
  const coins = p.coins;
  metaTrait(p, { id: OPERATORS[0].id }, g, 'gain'); metaTrait(p, { id: OPERATORS[0].id }, g, 'sold'); assert.equal(p.coins, coins);
  metaTrait(p, { id: OPERATORS[0].id }, g, 'kill'); assert.equal(p.coins, coins + 1);
  metaTrait(p, { id: OPERATORS[0].id }, g, 'kill'); assert.equal(p.coins, coins + 1);
  p.duelTime += 4; metaTrait(p, { id: OPERATORS[0].id }, g, 'kill'); assert.equal(p.coins, coins + 2);
});

test('real Boss terrain, crates and gates are reused; each focused feed contains only its defender lineup', () => {
  assert.equal(STAGE, data.stages.act1autochess_m01);
  assert.equal(RECT.r1, 5);
  const r = game(), d = r.duels[0];
  for (const p of d.pair) {
    buy(r, p, OPERATORS[0]);
    r.action(p, { action: 'deploy', uid: p.operators[0].uid, row: 4, col: ownCol(p, 4) });
    const b = r.battleOf(p);
    assert.equal(b.grid.tile(2, ownCol(p, 2)).key, 'tile_end');
    assert.ok(b.units.some(u => u.kind === 'device' && u.tileR === 4 && u.tileC === ownCol(p, 5)));
  }
  const views = r.fieldViews(d.id);
  for (const p of d.pair) {
    const field = views[p.id];
    assert.equal(field.playerId, p.id); assert.equal(field.side, p.side);
    assert.equal(field.meta.stageId, STAGE.id);
    assert.equal(field.snapshot.fieldId, field.meta.fieldId);
    const ops = field.meta.units.filter(u => u.kind === 'op');
    assert.equal(ops.length, 1); assert.equal(ops[0].ownerId, p.id);
    assert.ok(field.events.filter(e => e[0] === 'spawn' && e[1].kind === 'op').every(e => e[1].ownerId === p.id));
    const full = field.overview;
    assert.equal(full.meta.units.filter(u=>u.kind==='op').length,2);
    assert.equal(new Set(full.meta.units.map(u=>u.id)).size,full.meta.units.length);
    assert.equal(full.snapshot.fieldId,full.meta.fieldId);
    assert.equal(new Set(full.snapshot.units.map(t=>t[0])).size,full.snapshot.units.length);
  }
});

test('active Boss shooting platforms accept ranged operators on both halves, not ordinary melee', () => {
  const r=game({stageId:'act1autochess_m03'});
  r.bannedChess.delete('chess_char_3_20_a');
  for(const p of r.duels[0].pair) {
    const b=r.battleOf(p), row=3,col=ownCol(p,3), ranged=data.chess.chess_char_3_20_a;
    assert.equal(b.grid.canStand(row,col,{ranged:true}),false);
    assert.equal(versusCanStand(b.grid,r.stage,row,col,ranged),true);
    const melee=OPERATORS.find(o=>o.position==='MELEE'&&!versusCanStand(b.grid,r.stage,row,col,data.chess[o.id]));
    buy(r,p,melee);assert.throws(()=>r.action(p,{action:'deploy',uid:p.operators[0].uid,row,col}),/地块/);
    p.coins=100;buy(r,p,OPERATORS.find(o=>o.id===ranged.chessId));
    r.action(p,{action:'deploy',uid:p.operators.at(-1).uid,row,col});
    assert.ok(b.allyUnits.some(u=>u.defId===ranged.chessId&&u.alive));
    assert.throws(()=>r.action(p,{action:'deploy',uid:p.operators[0].uid,row,col}),/类型不匹配/);
  }
});

test('all inventory types sell; monster bundles respect capacity and cannot mint coins by resale', () => {
  const r=game(),p=r.players[0],card=MONSTERS[0],coins=p.coins;
  buy(r,p,card);r.action(p,{action:'sell',kind:'monster',id:card.id});
  assert.equal(p.coins,coins);assert.equal(p.monsters[card.id],undefined);
  assert.throws(()=>r.action(p,{action:'sell',kind:'monster',id:card.id}),/未知/);
  p.monsters[card.id]=39;p.shop.monster=[card.id];
  assert.throws(()=>r.action(p,{action:'buy',kind:'monster',index:0}),/已满/);
  assert.equal(p.coins,coins);assert.equal(p.shop.monster[0],card.id);
  buy(r,p,OPERATORS[0]);r.action(p,{action:'sell',uid:p.operators[0].uid});assert.equal(p.operators.length,0);
  p.items.push({id:'chess_item_1_01_a',uid:500});r.action(p,{action:'sell',kind:'equipment',uid:500});assert.equal(p.items.length,0);
});

test('trait descriptions include battle abilities and real converted triggers and sale refresh count', () => {
  const converted=OPERATORS.find(o=>traitNotes(o.id).some(t=>t.desc.includes('每击倒')));
  assert.ok(converted);assert.ok(traitNotes(converted.id).some(t=>t.conversion.includes('击杀')));
  const native=OPERATORS.find(o=>(data.chess[o.id].garrisonIds||[]).some(id=>data.garrisons[id].eventType==='IN_BATTLE'));
  assert.ok(traitNotes(native.id).some(t=>t.ready&&t.conversion==='战斗特质'));
  assert.ok(traitNotes('chess_char_3_15_a')[0].desc.includes('售出时获得2次'));
  const r=game(),p=r.players[0];buy(r,p,OPERATORS.find(o=>o.id==='chess_char_3_15_a'));
  r.action(p,{action:'sell',uid:p.operators[0].uid});assert.equal(p.freeRefresh,2);
});

test('both sides launch through the original Boss terrain into the opposite real blue gate', () => {
  const r = game(), [a, b] = r.duels[0].pair, card = MONSTERS[0];
  for (const p of [a, b]) { buy(r, p, card); r.action(p, { action: 'launch', id: card.id, row: 4, col: ownCol(p, 9) }); }
  for (let i = 0; i < 3000 && (a.hp === 20 || b.hp === 20); i++) r.tick();
  assert.equal(a.hp, 19); assert.equal(b.hp, 19);
});
