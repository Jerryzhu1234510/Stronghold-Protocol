import test from 'node:test';
import assert from 'node:assert/strict';
import {isBundledClient,manifestForNative} from '../public/js/resources/manifest.js';
test('our PC preload bridge reuses plain paths without disguising its user agent as Android',()=>{
 const before=globalThis.window;
 try{
  globalThis.window={SPAndroidResources:{getManifest:()=>'{"version":1}'}};
  assert.equal(isBundledClient(),true);
  assert.deepEqual(manifestForNative({spine:{skel:'/assets/~0123456789abcdef/x/a.skel',textures:['/assets/~0123456789abcdef/x/a.png']}}),{spine:{skel:'/assets/x/a.skel',textures:['/assets/x/a.png']}});
  globalThis.window={};assert.equal(isBundledClient(),false);
 }finally{globalThis.window=before;}
});
