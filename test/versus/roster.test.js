import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VersusRoom, ownCol } from '../../server/versus/engine.js';
import { OPERATORS, EQUIPMENT, data } from '../../server/versus/catalog.js';
import { versusCanStand } from '../../shared/versusPlacement.js';
import { createDragController, isLegal, resolveDrop } from '../../public/js/render/drag.js';

test('withdrawal legality uses configured bench geometry, leaving normal-mode row seven unchanged', () => {
  const piece = { uid: 1, kind: 'operator', row: 3, col: 4 }, canPlace = (_, row) => row < 2;
  const geo = { HAND_ROW: 0, HAND_SIZE: 21, TEMP_ROW: -1, TEMP_C0: 0, TEMP_SIZE: 0, FIELD: { r0: 1, r1: 5, c0: 2, c1: 18 } };
  for (const row of [0, 1]) {
    const result = resolveDrop({ piece, from: { area: 'board', row: 3, col: 4 }, tile: { row, col: 7 }, overCanvas: true, canPlace, geo });
    assert.equal(result.kind, 'drop');
  }
  assert.equal(isLegal(canPlace, piece, { area: 'hand', idx: 1 }), false);
  assert.equal(isLegal(canPlace, piece, { area: 'hand', idx: 1 }, geo), true);
});

function setup() {
  const room = new VersusRoom('ROSTER', { seed: 81, prepSeconds: 0, infoSeconds: 0 });
  for (let i = 0; i < 8; i++) room.join(`Player ${i}`);
  room.start(room.host); room.tick();
  const p = room.players[0], b = room.battleOf(p);
  const card = OPERATORS.find(c => !c.isGolden && data.chess[c.id].goldenId && !room.bannedChess.has(c.id));
  const tiles = [];
  for (let row = 2; row <= 5; row++) for (let col = 3; col <= 9; col++) if (versusCanStand(b.grid, room.stage, row, ownCol(p,col), data.chess[card.id])) tiles.push({row,col:ownCol(p,col)});
  const buy = () => { p.coins = 100; p.shop.operator = [card.id]; room.action(p,{action:'buy',kind:'operator',index:0}); return p.operators.at(-1); };
  const deploy = (o, tile) => room.action(p,{action:'deploy',uid:o.uid,...tile});
  return { room, p, b, card, tiles, buy, deploy };
}

test('moving and swapping reuse relocation without resetting HP, SP or firing death', () => {
  const {room,p,b,tiles,buy,deploy} = setup();
  const a=buy(), c=buy(); deploy(a,tiles[0]); deploy(c,tiles[1]);
  const u=b.allyUnits.find(u=>u.uid===a.uid), v=b.allyUnits.find(u=>u.uid===c.uid);
  u.hp=123;const sp=u.sp;v.hp=111;let deaths=0;b.on('death',()=>deaths++);
  room.action(p,{action:'move',uid:a.uid,...tiles[1]});
  assert.equal(u.hp,123);assert.equal(u.sp,sp);assert.equal(v.hp,111);assert.equal(deaths,0);
  assert.equal(u.tileC,tiles[1].col);assert.equal(v.tileC,tiles[0].col);
  room.action(p,{action:'move',uid:a.uid,...tiles[2]});assert.equal(u.hp,123);
  room.action(p,{action:'withdraw',uid:a.uid});assert.equal(a.row,null);assert.equal(deaths,0);
  deploy(a,tiles[0]);
  deploy(c,tiles[0]);assert.equal(a.row,null);assert.equal(deaths,0);
});

test('merge never fires death hooks, returns all equipment and queues the original free pick-one reward', () => {
  const {room,p,b,tiles,buy,deploy} = setup();
  const a=buy();deploy(a,tiles[0]);const c=buy();deploy(c,tiles[1]);
  a.items.push(EQUIPMENT[0].id);c.items.push(EQUIPMENT[1].id);
  let deaths=0;b.on('death',()=>deaths++);buy();
  assert.equal(deaths,0);assert.equal(p.operators.length,1);assert.equal(p.operators[0].items.length,0);
  assert.equal(p.items.length,2);assert.equal(p.stats.merges,1);
  const offer=room.privateView(p).rewardOffer;
  assert.equal(offer.source,'merge');assert.equal(offer.slots.length,3);
  assert.equal(new Set(offer.slots.map(s=>s.id)).size,3);
  assert.ok(offer.slots.every(s=>s.price===0&&!room.bannedChess.has(s.id)));
  const coins=p.coins;room.action(p,{action:'reward',index:0});assert.equal(p.coins,coins);assert.equal(p.offers.length,0);
  assert.throws(()=>room.action(p,{action:'reward',index:0}));
});

test('equipment equips both bench and deployed operators, then explicitly replaces a full slot', () => {
  const {room,p,b,tiles,buy,deploy} = setup();const o=buy();
  const equip = (id,extra={}) => { const it={uid:room.nextUid++,id};p.items.push(it);room.action(p,{action:'equip',uid:o.uid,itemUid:it.uid,...extra}); };
  equip(EQUIPMENT[0].id);assert.deepEqual(o.items,[EQUIPMENT[0].id]);deploy(o,tiles[0]);
  equip(EQUIPMENT[1].id);const u=b.allyUnits.find(u=>u.uid===o.uid);
  assert.equal(u.items.length,2);
  equip(EQUIPMENT[2].id,{replaceIndex:0});assert.deepEqual(o.items,[EQUIPMENT[1].id,EQUIPMENT[2].id]);assert.deepEqual(u.items,o.items);
});

test('each opponent monster killed pays one coin exactly once, never for a leak, with cap 100', () => {
  const {p,b} = setup();p.operators=[];p.coins=0;
  const victim={side:'enemy',mem:{},versusPurchased:true,versusPrice:2};
  b.emit('kill',{victim});b.emit('kill',{victim});assert.equal(p.coins,1);
  b.emit('kill',{victim:{side:'enemy',mem:{}}});assert.equal(p.coins,1);
  p.coins=100;b.emit('kill',{victim:{...victim,versusRewarded:false}});assert.equal(p.coins,100);
});

test('original drag controller accepts Boss geometry without changing normal-mode defaults', () => {
  const events=[], piece={uid:1,kind:'operator',row:null,col:null};
  const controller=createDragController({geo:{HAND_ROW:0,HAND_SIZE:21,TEMP_ROW:-1,TEMP_C0:0,TEMP_SIZE:0,FIELD:{r0:2,r1:5,c0:2,c1:18}},
    hitPiece:()=>piece,pickTile:()=>({row:2,col:3}),emit:(type,event)=>events.push({type,event})});
  controller.setEditable(true);
  const pointer={pointerId:1,button:0,pointerType:'mouse',x:0,y:0,clientX:0,clientY:0};
  controller.pointerDown(pointer);controller.pointerMove({...pointer,x:20,clientX:20});controller.pointerUp({...pointer,x:20,clientX:20});
  assert.deepEqual(events.find(e=>e.type==='pieceDrop').event.target,{area:'board',row:2,col:3});
});
