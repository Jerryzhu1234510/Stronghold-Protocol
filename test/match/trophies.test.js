import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTrophyPolicy, resultTrophies } from '../../shared/trophies.js';
import { roomExtensions } from '../../shared/roomExtensions.js';
import { buildResult } from '../../server/match/results.js';
import { normalizeResult } from '../../public/js/ui/gameLogic/result.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch } from './harness.js';

test('HP-only challenge increases retain full cups; clone, no-limit and Ducklord changes halve once', () => {
  for (const input of [{}, {extensions:roomExtensions.defaults()}, {diy:{a:'custom'},mods:['music']}, {extensions:{bossHp:1,duckEnhanced:0}}, {extensions:{duckEnhanced:false}},
    {extensions:{bossHp:2}}, {extensions:{enemyHp:96}}, {extensions:{bossHp:96,enemyHp:96}}]) {
    assert.equal(matchTrophyPolicy(input).custom,false);
  }
  for (const input of [{gameMode:'clone'}, {gameMode:'clone',extensions:{bossHp:96,enemyHp:96}},
    {extensions:{bossNoDamageLimit:true}}, {extensions:{duckEnhanced:1}},
    {gameMode:'clone',extensions:{bossHp:96,enemyHp:96,bossNoDamageLimit:true,duckEnhanced:2}}]) {
    assert.deepEqual(matchTrophyPolicy(input),{version:1,custom:true,multiplier:.5,reason:'custom'});
  }
});

test('four through eight seat ABYSS clears earn eight total, custom four, including optional Hidden Core', () => {
  const gd=new GameData(DATA,'mode_multi_abyss');
  for(let capacity=4;capacity<=8;capacity++)for(const hiddenCleared of [false,true]) {
    const opts={capacity,roundsPassed:hiddenCleared?15:14,cleared:true,hiddenCleared};
    assert.equal(resultTrophies(gd,opts),8);
    assert.equal(resultTrophies(gd,{...opts,policy:matchTrophyPolicy({extensions:{bossHp:96,enemyHp:96}})}),8);
    assert.equal(resultTrophies(gd,{...opts,policy:matchTrophyPolicy({gameMode:'clone',extensions:{bossHp:96}})}),4);
  }
});

test('real normal-mode Match with increased Boss and enemy HP still awards eight', () => {
  const h=makeMatch({mode:'coop',difficulty:'ABYSS',humans:1,capacity:4,fake:true,extensions:{bossHp:96,enemyHp:96}}).start();
  h.toPrep(1);h.m.round=14;
  const result=buildResult(h.m,{victory:true,hiddenReached:false,hiddenCleared:false,reason:'victory'});
  assert.equal(result.trophyPolicy.custom,false);
  assert.equal(result.players.find(p=>p.playerId==='p_0').trophies,8);
  h.m.dispose();
});

test('earlier progress and other difficulties retain table awards; custom odd cups keep exact halves; solo is zero', () => {
  const gd=new GameData(DATA,'mode_multi_abyss');
  assert.equal(resultTrophies(gd,{roundsPassed:5,cleared:false}),1);
  assert.equal(resultTrophies(gd,{roundsPassed:5,cleared:false,policy:matchTrophyPolicy({extensions:{duckEnhanced:2}})}),.5);
  const hard=new GameData(DATA,'mode_multi_hard');
  assert.equal(resultTrophies(hard,{roundsPassed:15,cleared:true,hiddenCleared:true}),hard.config.trophies.hiddenCore.HARD);
  assert.equal(resultTrophies(new GameData(DATA,'mode_single_abyss'),{roundsPassed:15,cleared:true,hiddenCleared:true}),0);
});

test('real match results keep personal elimination progress, immutable settings and one final custom award', () => {
  const h=makeMatch({mode:'coop',difficulty:'ABYSS',humans:2,capacity:8,fake:true,extensions:{bossNoDamageLimit:true,duckEnhanced:2}}).start();
  const m=h.m;h.toPrep(6);h.ps('p_1').eliminate(6);m.round=15;
  const result=buildResult(m,{victory:true,hiddenReached:true,hiddenCleared:true,reason:'victory'});
  const winner=result.players.find(p=>p.playerId==='p_0'),out=result.players.find(p=>p.playerId==='p_1');
  assert.equal(winner.victory,true);assert.equal(winner.trophies,4);
  assert.equal(out.victory,false);assert.equal(out.trophies,.5);
  assert.notEqual(result.extensions,m.extensions);assert.deepEqual(result.extensions,m.extensions);
  const normalized=normalizeResult(result,{});
  assert.equal(normalized.trophyPolicy.multiplier,.5);assert.equal(normalized.players.find(p=>p.playerId==='p_0').trophies,4);
  assert.equal(normalizeResult({players:[]},{}).trophyPolicy,null,'legacy records do not claim a scoring policy');
  m.dispose();
});
