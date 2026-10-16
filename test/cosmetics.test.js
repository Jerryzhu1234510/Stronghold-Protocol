// 0.3.0 uses official cosmetic layers and voice banks, superseding cosmeticChoices and audio.langs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCosmeticLayers, loadVisual } from '../public/js/cosmetics.js';
import { createAssets, avatarUrl, portraitUrl, spineEntry } from '../public/js/assets.js';
import { chessAvatarUrl, chessPortraitUrl } from '../public/js/ui/assetUrls.js';
import { sanitizeSettings } from '../public/js/ui/gameLogic/settings.js';
import { voiceLine } from '../public/js/audio.js';
await loadVisual();
const id = 'char_010_chen';
const base = { chars: { [id]: { avatar: '/assets/base.png', portrait: '/assets/base-portrait.png',
  spine: { front: { skel: '/assets/base.skel', atlas: '/assets/base.atlas', png: '/assets/base.png', anims: {} } } } } };
test('shop, detail and field use the same composed official art without changing chess data', () => {
  const m = structuredClone(base), chess = { charId: id, assets: { avatar: id, portrait: id } };
  m.chars[id] = { avatar: '/assets/skin.png', portrait: '/assets/portrait.png',
    spine: { front: { skel: '/assets/skin.skel', atlas: '/assets/skin.atlas', png: '/assets/skin.png', anims: {} } } };
  assert.equal(avatarUrl(m, id), chessAvatarUrl(m, chess));
  assert.equal(portraitUrl(m, id), chessPortraitUrl(m, chess));
  assert.equal(spineEntry(m, id).skel, '/assets/skin.skel');
  assert.equal(base.chars[id].avatar, '/assets/base.png');
  assert.equal(chess.charId, id);
});
test('official cosmetic layer reset restores the base manifest', () => {
  const layers = createCosmeticLayers(), assets = createAssets({ manifest: base, cosmetics: layers });
  layers.setPersonal([]); layers.setRoom(null);
  assert.equal(layers.active, false); assert.equal(layers.apply(base), base);
  assert.equal(assets.spineEntry(id).skel, '/assets/base.skel');
});
test('official voice preferences retain four languages, using volume as the mute control', () => {
  for (const voiceLang of ['cn', 'jp', 'en', 'kr']) assert.equal(sanitizeSettings({ voiceLang }).voiceLang, voiceLang);
  assert.equal(sanitizeSettings({ voiceLang: 'off' }).voiceLang, 'cn');
  assert.equal(sanitizeSettings(null).voiceLang, 'cn');
  assert.equal(sanitizeSettings({ voice: 0 }).voice, 0);
});
test('official voice banks fall back one clip at a time', () => {
  const audio = { voice: { [id]: { start: '/assets/start.mp3', skill1: '/assets/cn.mp3' } },
    voiceJp: { [id]: { skill1: '/assets/jp.mp3' } } };
  assert.equal(voiceLine(audio, id, 'skill1', 'jp').url, '/assets/jp.mp3');
  assert.equal(voiceLine(audio, id, 'start', 'jp').url, '/assets/start.mp3');
  assert.equal(voiceLine(audio, id, 'skill1', 'en').url, '/assets/cn.mp3');
});
