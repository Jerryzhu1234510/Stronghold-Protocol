import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceEntry, resourcePath } from '../public/js/resources/policy.js';

const base='https://example.invalid/_build/cache-r06/';
const item={hash:'a'.repeat(64),bytes:64};
const request=path=>new Request(base+path);

test('imported texture identities survive literal brackets and hashed URLs',()=>{
 const manifest={entries:{'/assets/fx/%5Bopt%5Dmerged.png':item}};
 for(const path of ['assets/fx/[opt]merged.png','assets/fx/%5Bopt%5dmerged.png','assets/~0123456789abcdef/fx/[opt]merged.png']){
  assert.equal(resourcePath(request(path),base),'/assets/fx/%5Bopt%5Dmerged.png');
  assert.equal(resourceEntry(request(path),base,manifest),item);
 }
});

test('Windows voice case aliases reuse imported audio, including extensionless media',()=>{
 const manifest={entries:{'/assets/audio/voice/CN_022.mp3':item},aliases:{'/media/voice/CN_022':'/assets/audio/voice/CN_022.mp3'}};
 assert.equal(resourceEntry(request('assets/audio/voice/cn_022.mp3'),base,manifest),item);
 assert.equal(resourceEntry(request('media/~0123456789abcdef/voice/cn_022'),base,manifest),item);
});

test('case aliases cannot select a different file from an ambiguous manifest',()=>{
 const other={hash:'b'.repeat(64),bytes:64};
 const manifest={entries:{'/assets/ABC.png':item,'/assets/abc.png':other}};
 assert.equal(resourceEntry(request('assets/ABC.png'),base,manifest),item);
 assert.equal(resourceEntry(request('assets/abc.png'),base,manifest),other);
 assert.equal(resourceEntry(request('assets/aBc.png'),base,manifest),null);
});

test('normalization preserves scope, malformed escapes and encoded separators',()=>{
 assert.equal(resourcePath(new Request('https://other.invalid/assets/x.png'),base),null);
 assert.equal(resourcePath(new Request('https://example.invalid/assets/x.png'),base),null);
 assert.equal(resourcePath(request('assets/%notvalid.png'),base),null);
 assert.equal(resourcePath(request('assets/a%2fb.png'),base),'/assets/a%2Fb.png');
 assert.equal(resourceEntry(request('assets/a%2fb.png'),base,{entries:{'/assets/a/b.png':item}}),null);
});
