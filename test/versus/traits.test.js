import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metaTrait} from '../../server/versus/traits.js';
import {OPERATORS,data} from '../../server/versus/catalog.js';
import {GameData} from '../../server/match/gamedata.js';
test('converted kill gains only active bonds, gain-time unconditional traits remain unconditional',()=>{
 const p={room:{gd:new GameData(data,'NORMAL')},layers:{},bonds:{yanShip:{active:true,layers:2},miraShip:{active:false,layers:0}},operators:[]},piece={id:OPERATORS[0].id};
 const g={effectKey:'SERVER_ADD_BOND',desc:'使已激活盟约增加',bb:{count:2},bbStr:{bond:'yanShip,miraShip'}};
 metaTrait(p,piece,g,'kill');assert.equal(p.layers.yanShip,2);assert.equal(p.layers.miraShip,undefined);
 metaTrait(p,piece,{...g,desc:'获得时，无需激活盟约'},'gain');assert.equal(p.layers.miraShip,2);
});
test('most-layer and multiple-bond gains preserve each amount and cap200',()=>{
 const p={layers:{yanShip:199},bonds:{yanShip:{active:true,layers:199},miraShip:{active:true,layers:20}},operators:[]},piece={id:OPERATORS[0].id};
 metaTrait(p,piece,{effectKey:'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER',bb:{count:3},bbStr:{}},'kill');assert.equal(p.layers.yanShip,200);
 metaTrait(p,piece,{effectKey:'SERVER_ADD_MULTIPLE_BOND',bb:{},bbStr:{bond:'yanShip,miraShip',count:'6,3'}},'gain');assert.equal(p.layers.miraShip,3);
});
