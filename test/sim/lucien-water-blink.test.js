import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Grid} from '../../server/sim/grid.js';
import {getDefaultSource} from '../../server/sim/simdata.js';
import {GEO} from '../../shared/constants.js';
import {blinkForward} from '../../server/sim/content/enemies/archetypes.js';
for(const side of ['L','R'])test(`water-map Lucien blink rebuilds cleared route on ${side} and avoids crossing the fence`,()=>{
 const grid=new Grid(getDefaultSource().getStage('act2autochess_m04'),GEO.BOSS_RECT);
 const mirror=x=>side==='R'?20-x:x;
 const e={x:mirror(5.6),y:2,motion:'WALK',id:1,route:{legs:[{t:'move',r:1,c:mirror(3)}],legIdx:0,pts:null,ptIdx:0}};
 const b={grid,addBuff(){},fx(){}};
 assert.deepEqual(blinkForward(b,e,1.5),{x:mirror(5.6),y:2});
 assert.equal(e.x,mirror(6),'first follows the vertical passage rather than blinking across column 5/15 fence');
 assert.ok(e.y>2&&e.y<4);
 assert.ok(grid.groundPassable(Math.round(e.y),Math.round(e.x)));
 assert.equal(e.route.pts,null);
 assert.ok(blinkForward(b,e,1.5),'a second blink also rebuilds its path');
 assert.ok(grid.groundPassable(Math.round(e.y),Math.round(e.x)));
});
