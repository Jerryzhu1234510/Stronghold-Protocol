import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestForNative } from '../public/js/resources/manifest.js';
import { resourcePath, resourceEntry } from '../public/js/resources/policy.js';

test('hashed assets reuse plain-path caches across hot versions, including media aliases', () => {
  const base = 'https://weishuxieyi.icu/_build/next/';
  const hash = '0'.repeat(64), h='0123456789abcdef';
  const manifest={entries:{'/assets/x.png':{hash,bytes:32},'/assets/audio/x.mp3':{hash,bytes:32}},aliases:{'/media/x':'/assets/audio/x.mp3'}};
  for (const [input,path] of [[`assets/~${h}/x.png`,'/assets/x.png'],[`media/~${h}/x`,'/media/x']]) {
    const req=new Request(base+input);
    assert.equal(resourcePath(req,base),path);
    assert.equal(resourceEntry(req,base,manifest).hash,hash);
  }
  assert.equal(resourcePath(new Request(`https://elsewhere.invalid/assets/~${h}/x.png`),base),null);
});

test('native hot pages keep plain bundled paths; normal browsers retain immutable hashed URLs', () => {
  const source={spine:{skel:'/assets/~0123456789abcdef/a/x.skel',textures:['/assets/~0123456789abcdef/a/x.png']},other:'https://assets.weishuxieyi.icu/pilot/x.png'};
  assert.equal(manifestForNative(source,false),source);
  const native=manifestForNative(source,true);
  assert.equal(native.spine.skel,'/assets/a/x.skel');
  assert.deepEqual(native.spine.textures,['/assets/a/x.png']);
  assert.equal(native.other,source.other);
  assert.match(source.spine.skel,/~0123456789abcdef/);
});
