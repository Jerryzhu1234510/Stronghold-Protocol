import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixedShopOffers } from '../../public/js/versus/shop.js';

test('mixed shop fixes five operators, five monsters and one equipment slot with original indices', () => {
  const shop={operator:['a',null,'c'],monster:['m','n'],equipment:['e']};
  const offers = mixedShopOffers(shop);
  assert.equal(offers.length,11);
  assert.deepEqual(offers.map(o=>o.kind),[...Array(5).fill('operator'),...Array(5).fill('monster'),'equipment']);
  assert.deepEqual(offers.slice(0,3),[{kind:'operator',index:0,id:'a'},{kind:'operator',index:1,id:null},{kind:'operator',index:2,id:'c'}]);
  assert.deepEqual(offers[5],{kind:'monster',index:0,id:'m'});
  assert.deepEqual(offers[10],{kind:'equipment',index:0,id:'e'});
  assert.equal(mixedShopOffers().length,11);
  assert.ok(mixedShopOffers({}).every(o=>o.id===null));
  assert.equal(mixedShopOffers({operator:Array(12).fill('a'),equipment:['e','f']}).length,11);
  assert.deepEqual(shop,{operator:['a',null,'c'],monster:['m','n'],equipment:['e']});
});
