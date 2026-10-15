import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avatarUrl, portraitUrl, skillIconUrl } from '../public/js/assets.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('data/assets.json', root), 'utf8'));
const id = 'char_4231_clemnt';
const char = manifest.chars[id];

test('Clementia avatar, portraits, skill icons and all six skill animations are registered for the runtime', () => {
  assert.ok(char);
  assert.equal(avatarUrl(manifest, `${id}_2`), char.avatarE2 || char.avatar);
  assert.equal(portraitUrl(manifest, id, { e2: true }), char.portraitE2);
  assert.notEqual(char.portrait, char.portraitE2);
  for (const side of ['front', 'back']) {
    const model = char.spine[side];
    assert.ok(model.animations[model.anims.idle] > 0);
    for (const index of [0, 1, 2]) {
      const skill = model.anims.skills[index];
      assert.ok(model.animations[skill.loop] > 0, `${side} S${index + 1} loop`);
      for (const name of [skill.begin, skill.end, skill.idle].filter(Boolean)) assert.ok(name in model.animations);
    }
  }
  for (const n of [1, 2, 3]) assert.equal(skillIconUrl(manifest, `skchr_clemnt_${n}`), manifest.skills[`skchr_clemnt_${n}`]);
  assert.ok(manifest.prof.sub.primguard);
});

test('every newly registered Clementia asset exists; PNG files have valid nonzero dimensions', {
  skip: !existsSync(new URL(`public${char.avatar}`, root)) && 'local assets are not installed',
}, () => {
  const paths = [char.avatar, char.portrait, char.portraitE2, manifest.prof.sub.primguard,
    ...[1, 2, 3].map(n => manifest.skills[`skchr_clemnt_${n}`]),
    ...Object.values(char.spine).flatMap(s => [s.skel, s.atlas, ...s.textures])];
  assert.equal(new Set(paths).size, 13);
  for (const path of paths) {
    const abs = new URL(`public${path}`, root);
    assert.ok(existsSync(abs), fileURLToPath(abs));
    const buf = readFileSync(abs);
    assert.ok(buf.length > 0, path);
    if (path.endsWith('.png')) {
      assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
      assert.ok(buf.readUInt32BE(16) > 0 && buf.readUInt32BE(20) > 0, path);
    }
  }
});
