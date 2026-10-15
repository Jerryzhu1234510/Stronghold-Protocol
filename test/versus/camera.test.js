import {test} from 'node:test';
import assert from 'node:assert/strict';
import {versusCameraOptions} from '../../shared/versusCamera.js';
import {presetCamera} from '../../public/js/render/projection.js';
const rect={r0:0,r1:5,c0:2,c1:18};
test('phone local camera keeps both bench and heads clear with the native short-screen fallback',()=>{
 for(const [width,height] of [[568,216],[844,256],[756,260]])for(const side of ['L','R']){
  const options=versusCameraOptions({width,rect,side});
  const camera=presetCamera('boss',{width,height,padding:options.padding},options);
  assert.ok(camera.scale>=(width===568?30:36)&&camera.scale<=60);assert.equal(options.half,true);
  const col=side==='R'?14:6;
  assert.ok(camera.project(col,5,1.4).y>=0,'back-row heads must remain visible');
  assert.ok(camera.project(col,0,0).y<height-12,'the bench must remain above the open shop');
  const folded=presetCamera('boss',{width,height:height+74,padding:options.padding},options);
  assert.ok(folded.scale>=36&&folded.scale<=60,'folded local view keeps its existing zoom bounds');
  const full=versusCameraOptions({width,rect,side,overview:true});assert.equal(full.half,false);assert.equal(full.minTilePx,undefined);
 }
 const desktop=versusCameraOptions({width:1440,rect});assert.equal(desktop.margin,.3);assert.equal(desktop.headroom,.65);assert.equal(desktop.minTilePx,undefined);
});

test('native top-left bonds clear defender heads and bench in local and full-map preparation views',()=>{
 for(const [width,height,hudTop] of [[1440,708,132],[844,256,74],[568,216,76]])for(const side of ['L','R'])for(const overview of [false,true]){
  const options=versusCameraOptions({width,rect,side,overview,hudTop});
  const camera=presetCamera('boss',{width,height,padding:options.padding},options);
  const col=side==='R'?14:6;
  assert.ok(camera.project(col,5,1.4).y>=hudTop-1,'deployed defender heads must remain below expanded bonds');
  assert.ok(camera.project(col,-.5,.16).y<=height-11,'the bench stays above the shop');
  const collapsed=versusCameraOptions({width,rect,side,overview:false,hudTop:0});
  const normal=presetCamera('boss',{width,height,padding:collapsed.padding},collapsed);
  if(width<=1000)assert.ok(normal.scale>=(width===568?30:36)&&normal.scale<=60,'collapsed bonds preserve the existing phone zoom bounds and short-screen fallback');
 }
});
