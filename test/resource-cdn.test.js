import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createResourceTransport, resourceCdnUrl } from '../public/js/resources/transport.js';
const body = 'verified media bytes';
const hash = createHash('sha256').update(body).digest('hex');
const item = { hash, bytes: Buffer.byteLength(body), cdn: `https://assets.weishuxieyi.icu/pilot/content/${hash}.skel` };
const request = () => new Request('https://weishuxieyi.icu/_build/new/assets/operator.skel', {
  cache: 'reload', headers: { Authorization: 'private-game-token', Cookie: 'private-game-cookie', Range: 'bytes=0-3' },
});
test('verified CDN bytes retain the game URL semantics without sending credentials or Range', async () => {
  let captured;
  const t = createResourceTransport({ fetchImpl: async r => { captured=r; return new Response(body, { headers: { 'content-encoding':'br' } }); } });
  const result = await t.fetch(request(), item);
  assert.equal(captured.url,item.cdn);assert.equal(captured.mode,'cors');assert.equal(captured.credentials,'omit');
  assert.equal(captured.headers.get('authorization'),null);assert.equal(captured.headers.get('cookie'),null);
  assert.equal(captured.headers.get('range'),null);assert.equal(captured.redirect,'error');
  assert.equal(result.verified,true);assert.equal(await result.response.text(),body);
  assert.equal(result.response.url,'');assert.equal(result.response.headers.get('content-encoding'),null);
  assert.equal(result.response.headers.get('x-sp-resource-source'),'r2');
});
for (const failure of ['network','status','size','hash','timeout']) test(`${failure} failure falls back and pauses only the failed resource`, async () => {
  let clock=0;const calls=[];
  const t=createResourceTransport({ now:()=>clock,timeoutMs:5,fetchImpl:async r=>{
    calls.push(r.url);
    if (r.url!==item.cdn)return new Response('tencent media');
    if (failure==='network')throw new TypeError('blocked');
    if (failure==='status')return new Response('no',{status:403});
    if (failure==='size')return new Response('truncated');
    if (failure==='hash')return new Response('x'.repeat(item.bytes));
    return new Promise((resolve,reject)=>r.signal.addEventListener('abort',()=>reject(r.signal.reason),{once:true}));
  }});
  const result=await t.fetch(request(),item);
  assert.equal(result.verified,false);assert.equal(await result.response.text(),'tencent media');
  assert.equal(calls[1],request().url);
  await t.fetch(request(),item);assert.equal(calls.filter(x=>x===item.cdn).length,1);
  const other = { ...item, cdn: item.cdn.replace('.skel', '.png') };
  await t.fetch(request(), other);
  assert.equal(calls.includes(other.cdn), true, 'one failed file never disables CDN for other files');
  clock=30001;await t.fetch(request(),item);assert.equal(calls.filter(x=>x===item.cdn).length,2);
});
test('foreign origins, credentials in URLs, queries and invalid content identities never redirect media', async () => {
  for(const cdn of ['https://other.test/pilot/a','http://assets.weishuxieyi.icu/pilot/a',
    'https://user:pass@assets.weishuxieyi.icu/pilot/a',item.cdn+'?token=private',item.cdn+'#a'])assert.equal(resourceCdnUrl({...item,cdn}),null);
  assert.equal(resourceCdnUrl({...item,hash:'bad'}),null);
  assert.equal(resourceCdnUrl({...item,bytes:33*1024*1024}),null);
});
test('caller cancellation does not trigger a second network request', async () => {
  const controller=new AbortController();let calls=0;
  const t=createResourceTransport({fetchImpl:async r=>{calls++;controller.abort(new Error('user cancelled'));throw r.signal.reason;}});
  await assert.rejects(t.fetch(new Request(request(),{signal:controller.signal}),item),/user cancelled/);
  assert.equal(calls,1);
});
