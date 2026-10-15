import { combatTrackFor } from '../audio.js';

export function versusBgmKey(room) {
  if (room?.status === 'combat') return `combat:${combatTrackFor(room.round) ?? 1}`;
  return room?.status === 'preparation' ? 'prep' : 'lobby';
}

// Commands may flush distinct events at the same simulation time, including while preparing.
export function createVersusAudioSync(audio) {
  let fieldId = null, previous = null;
  const known = new Set();
  return packet => {
    if (!packet?.room || packet === previous) return;
    previous = packet;
    const key = versusBgmKey(packet.room);
    if (audio.wantBgm !== key) audio.playBgm(key);
    const field = packet.field;
    if (!field) return;
    if (field.meta.fieldId !== fieldId) {
      fieldId = field.meta.fieldId; known.clear();
      audio.setFieldUnits(field.meta.units);
      for (const unit of field.meta.units) known.add(unit.id);
    }
    const spawned = new Set(field.events.filter(e => e[0] === 'spawn').map(e => e[1].id));
    const discovered = [];
    for (const unit of field.meta.units) if (!known.has(unit.id)) {
      known.add(unit.id);
      if (!spawned.has(unit.id)) discovered.push(['spawn', unit]);
    }
    if (packet.room.status === 'combat') audio.handleBattleEvents([...discovered, ...field.events], { originalAttacksOnly: true });
    else audio.handleBattleEvents([...discovered, ...field.events.filter(e => e[0] === 'spawn')]);
  };
}

export function playVersusCommandSound(audio, action) {
  const sound = { buy: 'buy', sell: 'sell', refresh: 'refresh', upgrade: 'levelup', equip: 'equip', reward: 'pick',
    deploy: 'drop', move: 'drop', withdraw: 'drop', rotate: 'drop' }[action];
  if (sound) audio.sfx(sound);
}
