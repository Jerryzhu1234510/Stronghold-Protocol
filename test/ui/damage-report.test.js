import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { damageReportOf } from '../../public/js/battle/damageReport.js';
import { avoidChatControls } from '../../public/js/ui/chatState.js';

test('damage report counts real enemy HP loss, excluding overkill, friendly damage and healing', () => {
  const h=makeBattle({content:'none',autoFinish:false,round:7,defs:{chess:{guard:chessRec({id:'guard',skill:null})},enemies:{dummy:enemyRec({key:'dummy',hp:120})}},units:[{chessId:'guard',row:10,col:5}]});
  h.step();
  const guard=h.unit('guard'), enemy=h.spawn('dummy');
  h.b.dealDamage(guard,enemy,{amount:40,type:'true',canDodge:false});
  assert.equal(damageReportOf(h.b,'p1').total,40);
  h.b.dealDamage(guard,enemy,{amount:10000,type:'true',canDodge:false});
  h.b.dealDamage(guard,guard,{amount:20,type:'true',canDodge:false});
  h.b.heal(guard,guard,20);
  const before=h.b.tickCount, report=damageReportOf(h.b,'p1');
  assert.equal(report.total,120); assert.equal(report.rows.length,1); assert.equal(report.round,7);
  assert.equal(h.b.tickCount,before,'reading reports never advances battle');
  assert.equal(damageReportOf(h.b,'p2').total,0,'teammate counters are separate');
});

test('duplicate copies stay separate while summoned units share their type row; snapshots do not mutate', () => {
  const battle={allyUnits:[
    {ownerId:'p1',kind:'op',uid:'copy1',defId:'guard',name:'Guard',stats:{dmg:30}},
    {ownerId:'p1',kind:'op',uid:'copy2',defId:'guard',name:'Guard',stats:{dmg:20}},
    {ownerId:'p1',kind:'token',defId:'summon',stats:{dmg:40}},
    {ownerId:'p1',kind:'token',defId:'summon',stats:{dmg:10}},
    {ownerId:'p2',kind:'op',uid:'other',stats:{dmg:900}},
  ]};
  const report=damageReportOf(battle,'p1');
  assert.equal(report.total,100); assert.deepEqual(report.rows.map(r=>r.dmg),[50,30,20]);
  battle.allyUnits[0].stats.dmg=100;
  assert.equal(report.total,100); assert.equal(report.rows[1].dmg,30,'settled snapshot stays frozen');
  assert.equal(damageReportOf(null,'p1'),null);
});

test('expanded chat moves away from the result return controls and preserves safe positions', () => {
  const size={width:260,height:210},view={x:0,y:0,width:640,height:360,avoid:[{left:0,right:640,top:290,bottom:360}]};
  const pos=avoidChatControls({x:8,y:142},size,view);
  assert.ok(pos.y+size.height<=290); assert.ok(pos.x>=8&&pos.x+size.width<=632);
  const safe={x:10,y:10};assert.equal(avoidChatControls(safe,size,view),safe);
});
