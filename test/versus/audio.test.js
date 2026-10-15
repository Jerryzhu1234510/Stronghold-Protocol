import test from 'node:test';
import assert from 'node:assert/strict';
import { createVersusAudioSync, versusBgmKey, playVersusCommandSound } from '../../public/js/versus/audio.js';
import { AudioManager } from '../../public/js/audio.js';

test('successful shop commands play original UI sounds and unknown commands play nothing', () => {
  const log = [], audio = { sfx: sound => log.push(sound) };
  for (const command of ['buy','sell','refresh','upgrade','equip','reward','launch','move']) playVersusCommandSound(audio, command);
  assert.deepEqual(log, ['buy','sell','refresh','levelup','equip','pick','drop']);
  const manager = new AudioManager({ win: null, getManifest: () => ({ audio: { sfx: { ui: { buy: 'native-buy.mp3' } } } }) });
  const played = []; manager._play = url => played.push(url);
  playVersusCommandSound(manager, 'buy'); assert.deepEqual(played, ['native-buy.mp3']);
});

test('versus attacks use existing unit sounds only while normal-mode fallback is unchanged', () => {
  const a = new AudioManager({ win: null }), log = []; a.ctx = {};
  a.setFieldUnits([{ id: 1, side: 'enemy', kind: 'enemy', spine: 'unknown' }, { id: 2, side: 'ally', kind: 'op' }]);
  a.unit = (def, role) => { log.push(role); return false; }; a.battle = sound => log.push(sound);
  a.handleBattleEvents([['atk', 1, 2]], { originalAttacksOnly: true }); assert.deepEqual(log, ['attack']);
  log.length = 0; a.handleBattleEvents([['atk', 1, 2]]); assert.deepEqual(log, ['attack','enemyHit']);
});

test('versus BGM follows real combat status, not the native PREP shell phase', () => {
  assert.equal(versusBgmKey({ status: 'combat', round: 1 }), 'combat:1');
  assert.equal(versusBgmKey({ status: 'preparation' }), 'prep');
  assert.equal(versusBgmKey({ status: 'complete' }), 'lobby');
});

test('audio tracks new units, preserves same-time command events and forwards skills and leaks once', () => {
  const log = [], units = [];
  const audio = { playBgm(key) { this.wantBgm = key; }, setFieldUnits(u) { units.push(u); }, handleBattleEvents(e) { log.push(...e); } };
  const sync = createVersusAudioSync(audio);
  const packet = { room: { status: 'preparation' }, field: { meta: { fieldId: 'a', units: [] }, snapshot: { t: 0 }, events: [] } };
  sync(packet);
  const added = { ...packet, field: { ...packet.field, meta: { fieldId: 'a', units: [{ id: 1 }] }, events: [['deploy', 1, 'RIGHT']] } };
  sync(added);
  assert.deepEqual(log, [['spawn', { id: 1 }]]);
  const combat = { ...added, room: { status: 'combat', round: 1 }, field: { ...added.field, events: [['skill', 1, true], ['leak', 2]] } };
  sync(combat); sync(combat);
  assert.deepEqual(log.slice(1), [['skill', 1, true], ['leak', 2]]);
  assert.equal(audio.wantBgm, 'combat:1');
  sync({ ...combat, field: { ...combat.field, meta: { fieldId: 'b', units: [{ id: 3 }] }, events: [] } });
  assert.equal(units.length, 2);
});
