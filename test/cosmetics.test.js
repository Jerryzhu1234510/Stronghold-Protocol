import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedSkin, sanitizeCosmetics } from '../shared/cosmetics.js';
import { avatarUrl, portraitUrl, spineEntry, createAssets } from '../public/js/assets.js';
import { chessAvatarUrl, chessPortraitUrl } from '../public/js/ui/assetUrls.js';
import { sanitizeSettings } from '../public/js/ui/gameLogic/settings.js';
import { AudioManager } from '../public/js/audio.js';

const id = 'char_010_chen', skinId = id + '@nian#2';
const skin = { avatar: '/assets/skin/avatar.png', portrait: '/assets/skin/portrait.png', spine: { front: { skel: '/assets/skin/front.skel', atlas: '/assets/skin/front.atlas', anims: {} } } };
const base = { avatar: '/assets/base.png', portrait: '/assets/base-portrait.png', spine: { front: { skel: '/assets/base.skel', atlas: '/assets/base.atlas', anims: {} } }, skins: { [skinId]: skin } };
test('selected outfit is shared by shop, loadout and front/back battle render without modifying combat data', () => {
  const manifest = { chars: { [id]: base }, cosmeticChoices: { [id]: skinId } }, chess = { charId: id, assets: { avatar: id + '_2', portrait: id + '_2' }, isGolden: true };
  assert.equal(selectedSkin(manifest, id + '_2'), skin);
  assert.equal(avatarUrl(manifest, id), skin.avatar);
  assert.equal(portraitUrl(manifest, id + '_2'), skin.portrait);
  assert.equal(chessAvatarUrl(manifest, chess), skin.avatar);
  assert.equal(chessPortraitUrl(manifest, chess), skin.portrait);
  assert.equal(spineEntry(manifest, id, { back: true }), skin.spine.front);
  assert.equal(chess.charId, id);
  manifest.cosmeticChoices[id] = 'unknown';
  assert.equal(avatarUrl(manifest, id), base.avatar);
});
test('preferences set before manifest arrival are applied after seeding, and reset restores base model', () => {
  const assets = createAssets(), events = [];
  assets.onChange(what => events.push(what));
  assets.setCosmetics({ [id]: skinId });
  assets.seed({ chars: { [id]: base } });
  assert.equal(assets.spineEntry(id), skin.spine.front);
  assets.setCosmetics({});
  assert.equal(assets.spineEntry(id), base.spine.front);
  assert.ok(events.includes('cosmetics'));
  assert.deepEqual(sanitizeCosmetics({ bad: skinId, [id]: 'http://example.test' }), {});
});
test('voice-language preference survives sanitization; old settings remain Chinese', () => {
  for (const voiceLang of ['cn', 'jp', 'en', 'off']) assert.equal(sanitizeSettings({ voiceLang }).voiceLang, voiceLang);
  assert.equal(sanitizeSettings({ voiceLang: '<script>' }).voiceLang, 'cn');
  assert.equal(sanitizeSettings(null).voiceLang, 'cn');
});

test('the selected voice bank is used, missing languages fall back to Chinese, and off stays silent', () => {
  const manifest = { audio: { voice: { root: '/assets/audio/voice', ext: '.mp3', langs: {
    cn: { [id]: { skill: { 1: 'cn_025' } } }, jp: { [id]: { skill: { 1: 'cn_025' } } },
  }, banks: { cn: { [id]: { resultThree: '/assets/audio/voice/cn/result.mp3' } }, jp: { [id]: { start: '/assets/audio/voice/jp/start.mp3' } } } } } };
  const audio = new AudioManager({ getManifest: () => manifest });
  audio.ctx = {}; audio._play = () => true;
  audio.setVoiceLang('jp');
  assert.equal(audio.voice(id, 'skill', { slot: 1 }), `/assets/audio/voice/jp/${id}/cn_025.mp3`);
  assert.equal(audio.voice(id, 'start'), '/assets/audio/voice/jp/start.mp3');
  assert.equal(audio.voice(id, 'resultThree'), '/assets/audio/voice/cn/result.mp3', 'a missing clip also falls back, even when the language has other clips');
  audio.setVoiceLang('en');
  assert.equal(audio.voice(id, 'skill', { slot: 1 }), `/assets/audio/voice/cn/${id}/cn_025.mp3`);
  audio.setVoiceLang('off'); assert.equal(audio.voice(id, 'skill'), null);
});
