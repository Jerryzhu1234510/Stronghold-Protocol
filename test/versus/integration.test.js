import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { VersusMatch } from '../../server/versus/match.js';
import { VersusRoom, ownCol } from '../../server/versus/engine.js';
import { MONSTERS, data } from '../../server/versus/catalog.js';
import { gameModeName } from '../../shared/cloneMode.js';
import { renderInfo } from '../../public/js/render/app/info.js';

test('versus creation and switching default to HARD, while later difficulty edits remain available', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  try {
    const { playerId } = await c.hello('难度验收');
    const ok = async (t, args = {}) => assert.equal((await c.request({ t, ...args })).t, 'ok');
    await ok('room.create', { mode: 'coop', difficulty: 'NORMAL', gameMode: 'versus', capacity: 4 });
    const room = server.lobby.roomOf(server.registry.byId(playerId));
    assert.equal(room.difficulty, 'HARD');
    await ok('room.setDifficulty', { difficulty: 'NORMAL' });
    await ok('room.setGameMode', { gameMode: 'versus' });
    assert.equal(room.difficulty, 'NORMAL', 'unchanged mode must not reset an explicit choice');
    await ok('room.setGameMode', { gameMode: 'normal' });
    assert.equal(room.difficulty, 'NORMAL');
    await ok('room.setGameMode', { gameMode: 'versus' });
    assert.equal(room.difficulty, 'HARD');
  } finally { await c.terminate(); await server.close(); }
});

test('native lobby: host switching, exact four, Ban page, authenticated watch/actions, completion and reconnect', async () => {
  const server = await startServer({ port:0, quiet:true, seedFn:()=>81 }), clients=[];
  const client = async name => {
    const c=await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`); clients.push(c);
    const welcome=await c.hello(name); c.id=welcome.playerId;c.token=welcome.token;return c;
  };
  const ok=async(c,t,args={})=>assert.equal((await c.request({t,...args})).t,'ok');
  try {
    const a=await client('房主'), b=await client('成员'), viewer=await client('观战');
    await ok(a,'room.create',{mode:'coop',difficulty:'NORMAL',capacity:4,mapVersion:'classic',visibility:'public',description:'对抗模式测试'});
    const room=server.lobby.roomOf(server.registry.byId(a.id));
    await ok(a,'room.setGameMode',{gameMode:'versus'});
    assert.equal(room.difficulty,'HARD');
    await ok(b,'room.join',{code:room.code}); // Joining an incomplete versus room must remain possible.
    assert.equal((await b.waitFor('room.state',s=>s.code===room.code)).difficulty,'HARD');
    assert.equal((await b.request({t:'room.setGameMode',gameMode:'normal'})).code,'NOT_HOST');
    assert.equal((await a.request({t:'room.start'})).code,'NOT_READY');
    assert.equal((await a.request({t:'room.setCapacity',capacity:8,experimentalAccepted:true})).t,'error');
    for(let i=0;i<2;i++)await ok(a,'room.addBot');
    await ok(viewer,'room.list'); const directory=await viewer.waitFor('room.directory');
    assert.equal(directory.rooms.find(r=>r.code===room.code).gameMode,'versus');
    assert.equal(directory.rooms.find(r=>r.code===room.code).difficulty,'HARD');
    assert.equal(gameModeName('versus'),'对抗模式（测试）');
    await ok(viewer,'room.spectate',{code:room.code});
    await ok(b,'room.ready',{ready:true}); await ok(a,'room.start');
    const match=room.match; assert.ok(match instanceof VersusMatch);
    assert.equal(match.phase,'INFO_CHECK');assert.equal(match.game.mapVersion,'classic');
    assert.equal(match.game.gd.largeRoomBonus,0);assert.equal(match.game.publicView().players.length,4);
    assert.ok(match.game.bans.drawn.length>0); assert.ok(match.game.players.every(p=>p.strategy===null));
    await ok(a,'g.infoReady');assert.equal(match.phase,'INFO_CHECK');await ok(b,'g.infoReady');
    assert.equal(match.phase,'PREP');
    const state=await a.waitFor('m.versus',m=>!!m.state.field);
    assert.equal(state.state.field.playerId,a.id);
    const d=match.game.duels.find(d=>d.id===state.state.field.duelId), other=d.pair.find(p=>p.id!==a.id);
    await ok(a,'g.watch',{fieldId:d.id,playerId:other.id});
    assert.equal((await a.waitFor('m.versus',m=>m.state.field?.playerId===other.id)).state.field.playerId,other.id);
    await ok(viewer,'g.watch',{fieldId:d.id,playerId:other.id});
    assert.equal((await viewer.request({t:'g.versus',command:{action:'refresh'}})).code,'SPECTATOR');
    assert.equal((await a.request({t:'g.versus',command:{action:'buy',kind:'__proto__',index:0}})).t,'error');
    assert.equal((await a.request({t:'g.versus',command:{action:'strategy',id:'band_amiya'}})).t,'error');
    // Returning players reset to their own half, not the last scouted player.
    await a.close(); const resumed=await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);clients.push(resumed);
    await resumed.hello('房主',a.token);
    assert.equal((await resumed.waitFor('m.versus',m=>!!m.state.field)).state.field.playerId,a.id);
    clearInterval(match.timer);
    while(match.game.status!=='complete') {
      for(const duel of match.game.duels)if(!duel.done)match.game.finishDuel(duel,duel.pair[0],'测试');
      match.game.tick();
    }
    match.flush();server.lobby.onMatchEnd(room,room.matchCtx,{champion:match.game.champion});
    assert.equal(room.match,null);assert.equal(room.replay.frames.size,3);
    assert.equal(JSON.parse(room.replay.frames.get(a.id)).state.room.status,'complete');
  } finally { for(const c of clients) await c.terminate();await server.close(); }
});

test('every enabled original map keeps real blue gates and bidirectional monster routes, and feed hides foreign operators', () => {
  const stages=Object.values(data.stages).filter(s=>s.active&&s.weight>0);
  assert.equal(stages.length,8);
  for(const stage of stages) {
    const r=new VersusRoom('TEST',{seed:81,stageId:stage.id,prepSeconds:0,infoSeconds:0});r.join('博士');r.start(r.host,true);r.tick();
    const d=r.duels[0];
    for(const p of d.pair) {
      const b=r.battleOf(p);assert.equal(b.grid.tile(2,ownCol(p,2)).key,'tile_end',stage.id);
      let tile;
      for(let row=2;row<=5&&!tile;row++)for(const c of [8,9]) {
        const col=ownCol(p,c);if(b.grid.groundPassable(row,col)){tile={row,col};break;}
      }
      assert.ok(tile,stage.id);p.monsters[MONSTERS[0].id]=1;
      r.action(p,{action:'launch',id:MONSTERS[0].id,...tile});
    }
    const feeds=r.fieldViews(d.id);
    for(const p of d.pair) {
      const field=feeds[p.id];assert.equal(field.meta.stageId,stage.id);
      const outgoing=field.meta.units.find(u=>u.outgoing);assert.equal(outgoing.sourcePlayerId,p.id);
      assert.equal(field.meta.units.filter(u=>u.versusPurchased).length,0);
      assert.ok(field.routes[0].cells.length>1,stage.id);
      assert.deepEqual(field.routes[0].cells.at(-1),[2,p.side==='L'?18:2]);
      assert.ok(field.events.some(e=>e[0]==='spawn'&&e[1].sourcePlayerId===p.id));
      assert.ok(field.meta.units.filter(u=>u.kind==='op').every(u=>u.ownerId===p.id));
    }
  }
});

test('renderer preserves explicit viewer-relative outline color without adding one to co-op units', () => {
  assert.equal(renderInfo({id:1,outlineColor:0x54baff}).outlineColor,0x54baff);
  assert.equal(Object.hasOwn(renderInfo({id:2}),'outlineColor'),false);
});
