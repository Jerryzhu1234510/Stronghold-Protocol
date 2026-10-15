import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { MAX_SPECTATORS } from '../shared/constants.js';

async function fixture(run) {
  const links = new Map([['account_A', new Set(['account_B'])], ['account_B', new Set(['account_A'])], ['account_C', new Set()]]);
  const accounts = {
    async resolve(token) { const id = 'account_' + token.at(-1); return { accountId: id, profile: { accountId: id, name: id } }; },
    async friendIds(id) { return [...(links.get(id) || [])]; },
    async begin() {}, async finish() {}, async release() {},
  };
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, accounts, MatchClass: StubMatch });
  const clients = [];
  try {
    for (const letter of ['A', 'B', 'C']) {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
      c.id = (await c.hello(letter, null, { account: 'synthetic_token_' + letter })).playerId;
      c.session = srv.registry.byId(c.id);
    }
    const [a,b,c] = clients;
    const ok = async (client, msg) => { const r = await client.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
    const denied = async (client, msg) => { const r = await client.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); return r; };
    const roomOf = client => srv.lobby.roomOf(client.session);
    const create = async client => { await ok(client, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }); return roomOf(client); };
    const social = async client => { client.clearInbox(); await ok(client, { t: 'friends.state' }); return client.waitFor('friends.state'); };
    await run({ srv, a,b,c, ok,denied,roomOf,create,social,links });
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
}

test('friend invite requires consent and explicit entry, preserves account/seat identity and is one-shot', () => fixture(async ({ a,b,c,ok,denied,create,social,roomOf }) => {
  const room = await create(a);
  assert.equal((await social(b)).friends[0].room.code, room.code);
  await denied(c, { t:'friends.send', accountId:'account_A', kind:'join' });
  await ok(a, { t:'friends.send', accountId:'account_B', kind:'invite' });
  const t = (await social(b)).tickets[0]; assert.ok(t.incoming); assert.equal(t.enter, false);
  await denied(c, { t:'friends.decide', id:t.id, accept:true });
  await denied(b, { t:'friends.enter', id:t.id });
  await ok(b, { t:'friends.decide', id:t.id, accept:true });
  assert.equal(roomOf(b), null);
  await ok(b, { t:'friends.enter', id:t.id });
  assert.equal(roomOf(b), room); assert.equal(b.session.accountId,'account_B');
  assert.equal(room.seatOf(b.id).accountId,'account_B');
  await denied(b, { t:'friends.enter', id:t.id });
}));

test('join application goes to room host even when friend is not host, rejects unapproved entry', () => fixture(async ({ a,b,c,ok,denied,create,social,roomOf }) => {
  const room = await create(c); await ok(a, { t:'room.join', code:room.code });
  await ok(b, { t:'friends.send', accountId:'account_A', kind:'join' });
  const t = (await social(c)).tickets[0]; assert.ok(t.incoming);
  await denied(a, { t:'friends.decide', id:t.id, accept:true });
  await ok(c, { t:'friends.decide', id:t.id, accept:true });
  assert.ok((await social(b)).tickets[0].enter);
  await ok(b, { t:'friends.enter', id:t.id }); assert.equal(roomOf(b),room);
}));

test('spectating a running friend match uses spectator seats, never player seats', () => fixture(async ({ a,b,ok,create,social,roomOf }) => {
  const room = await create(a); await ok(a, { t:'room.start' });
  await ok(b, { t:'friends.send', accountId:'account_A', kind:'spectate' });
  const t = (await social(a)).tickets[0]; await ok(a, { t:'friends.decide', id:t.id, accept:true });
  await ok(b, { t:'friends.enter', id:t.id });
  assert.equal(roomOf(b),room); assert.equal(room.seatOf(b.id),null); assert.ok(room.spectatorOf(b.id));
}));

test('starting a match invalidates join invitations; expired invitations and removed friends cannot enter', () => fixture(async ({ srv,a,b,ok,denied,create,social,links }) => {
  await create(a); await ok(a, { t:'friends.send', accountId:'account_B', kind:'invite' });
  const t = (await social(b)).tickets[0]; await ok(b, { t:'friends.decide', id:t.id, accept:true });
  links.get('account_A').clear(); links.get('account_B').clear();
  await denied(b, { t:'friends.enter', id:t.id });
  links.get('account_A').add('account_B'); links.get('account_B').add('account_A');
  srv.lobby.social.sentAt.clear();
  await ok(a, { t:'friends.send', accountId:'account_B', kind:'invite' });
  const t2 = (await social(b)).tickets[0]; await ok(a, { t:'room.start' });
  await denied(b, { t:'friends.decide', id:t2.id, accept:true });
}));

test('last seat capacity and spectator cap are checked again at entry; no forced departure on failure', () => fixture(async ({ a,b,c,ok,denied,create,social,roomOf,srv }) => {
  const room = await create(a), own = await create(b);
  await ok(a, { t:'friends.send', accountId:'account_B', kind:'invite' });
  const t = (await social(b)).tickets[0]; await ok(b, { t:'friends.decide', id:t.id, accept:true });
  for (let i=0;i<3;i++) await ok(a,{t:'room.addBot'});
  await denied(b, {t:'friends.enter',id:t.id}); assert.equal(roomOf(b),own);
  room.spectators = Array.from({length:MAX_SPECTATORS},(_,i)=>({playerId:'spec'+i,name:'Spec',connected:false}));
  srv.lobby.social.sentAt.clear();
  await denied(b,{t:'friends.send',accountId:'account_A',kind:'spectate'});
  assert.equal(room.seats.filter(Boolean).length,4);
}));

test('inbox expiry, duplicate sends and host migration are bounded and revalidated', () => fixture(async ({ a,b,c,ok,denied,create,social,srv }) => {
  const room=await create(a);
  const msg={t:'friends.send',accountId:'account_B',kind:'invite'};
  await ok(a,msg); await ok(a,msg); assert.equal(srv.lobby.social.tickets.size,1);
  const t=(await social(b)).tickets[0];
  srv.lobby.social.tickets.get(t.id).expiresAt=0;
  await denied(b,{t:'friends.decide',id:t.id,accept:true}); assert.equal(srv.lobby.social.tickets.size,0);
  srv.lobby.social.sentAt.clear(); await ok(a,msg);
  const t2=(await social(b)).tickets[0]; await ok(c,{t:'room.join',code:room.code});
  await ok(a,{t:'room.leave'});
  await denied(b,{t:'friends.decide',id:t2.id,accept:true});
}));
