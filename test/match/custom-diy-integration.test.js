import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { migrateLegacyDiy } from '../../shared/legacyDiy.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';
import { diySlotIds, checkDiyPick } from '../../shared/diy.js';
import { supportChessId } from '../../shared/supports.js';

const slots = diySlotIds(DATA);
const ids = ['char_4182_oblvns', 'char_4217_makoto', 'char_1042_phatm2', 'char_1035_wisdel'];
test('legacy support preferences migrate all four slots with selected skills and do not overwrite DIY edits', () => {
  const entries = Object.fromEntries(ids.map((id,i) => [supportChessId(id,i<2?5:6),{skill:i%3}]));
  const picks = migrateLegacyDiy({ legacy: ids, entries, data: DATA, kitted: KITTED_CHARS });
  assert.equal(Object.keys(picks).length,4);
  slots.forEach((slot,i) => { assert.equal(picks[slot].charId,ids[i]); assert.equal(picks[slot].skillIndex,i%3); });
  assert.equal(migrateLegacyDiy({ legacy:ids, existing:picks, data:DATA }),picks);
});
test('one stale legacy choice does not discard the other three', () => {
  const picks = migrateLegacyDiy({ legacy:[ids[0],'invalid',ids[2],ids[3]], data:DATA, kitted:KITTED_CHARS });
  assert.equal(Object.keys(picks).length,3);
});
for (const charId of ids.slice(0,2)) for (const slot of slots) for (let skillIndex=0;skillIndex<3;skillIndex++) {
  test(`${charId}/${slot}/S${skillIndex+1} is a valid production DIY pick`, () => {
    assert.equal(checkDiyPick(slot,{charId,skillIndex},DATA).ok,true);
    assert.ok(KITTED_CHARS.includes(charId));
  });
}
for (const capacity of [4,5,6,7,8]) test(`${capacity} seats keep scaled DIY inventory personal and include it in promotion rewards`, () => {
  const picks = { [slots[0]]:{charId:ids[0],skillIndex:2}, [slots[1]]:{charId:ids[1],skillIndex:2},
    [slots[2]]:{charId:ids[2],skillIndex:2}, [slots[3]]:{charId:ids[3],skillIndex:2} };
  const h = makeMatch({capacity,seats:[{seat:0,playerId:'p_0',name:'DIY',isBot:false,connected:true,diy:picks},
    {seat:1,playerId:'p_1',name:'None',isBot:false,connected:true}],fake:true}).start();
  h.toPrep(1);
  const ps=h.ps('p_0'), other=h.ps('p_1');
  ps.initDiyStock(new Set());
  assert.equal(other.diyStock.entries.size,0);
  for (const tier of [5,6]) {
    const list=[...ps.diyStock.entries.values()].filter(e=>e.tier===tier);
    assert.equal(list.reduce((n,e)=>n+e.cap,0),Math.round((tier===5?16:10)*capacity/4));
  }
  slots.forEach(id=>assert.equal(h.m.pool.has(id),false));
  ps.shop.level=6; other.shop.level=6;
  let own=0;
  for(let i=0;i<250;i++) {
    const offer=ps.pushRewardOffer('merge');
    own+=offer.slots.some(s=>s.id===slots[2]||s.id===slots[3]);
    assert.ok(other.pushRewardOffer('merge').slots.every(s=>!slots.includes(s.id)));
    ps.offers=[]; other.offers=[];
  }
  assert.ok(own>0);
  h.m.dispose();
});
