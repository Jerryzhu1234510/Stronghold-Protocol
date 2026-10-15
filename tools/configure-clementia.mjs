// Five-tier roster placement and allied-kill garrisons selected by the player poll.
// Idempotent; stores the generated records in custom-overlay.json for later data rebuilds.
import { readFile, writeFile } from 'node:fs/promises';
import { composeUnitRecord } from '../shared/standIn.js';

const root = new URL('../data/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, root), 'utf8'));
const [chess, garrisons, bonds, backups, overlay] = await Promise.all(
  ['chess', 'garrisons', 'bonds', 'backups', 'custom-overlay'].map(load));
const charId = 'char_4231_clemnt', base = 'chess_char_4_27_a', golden = 'chess_char_4_27_b';
const affiliations = ['egirShip', 'swiftShip', 'indomShip'];
const effect = 'custom_gar_allied_kills';
const unit = backups.units[charId];
if (!unit) throw new Error('Import the official Clementia forms first');
const firstIdentifier = 1 + Math.max(...Object.values(chess).filter(c => c.baseId !== base).map(c => c.identifier));
const upsert = (file, path, value) => {
  const changes = overlay[file] ??= [];
  const previous = changes.find(c => JSON.stringify(c.path) === JSON.stringify(path));
  if (previous) { previous.value = structuredClone(value); delete previous.delete; }
  else changes.push({ path, value: structuredClone(value) });
};
for (const elite of [false, true]) {
  const id = elite ? golden : base, gid = `garrison_4231_${elite ? 'b' : 'a'}`;
  const status = elite ? { phase: 2, level: 60, skillLevel: 7, equipLevel: 1 }
    : { phase: 2, level: 1, skillLevel: 4, equipLevel: 0 };
  const identity = {
    chessId: id, baseId: base, goldenId: golden, isGolden: elite, tier: 5,
    identifier: firstIdentifier + Number(elite), isHidden: false, isDiy: false, visible: true,
    chessType: 'PRESET', backup: { charId, tmplId: null, skillIndex: 1, uniEquipId: null, potRank: 0 },
    shopSortId: 27, bonds: affiliations, garrisonIds: [gid], price: 4, sellPrice: 1,
    upgradeNum: elite ? 0 : 3, upgradeChessId: elite ? null : golden, status,
  };
  const form = unit.forms[`${status.phase}/${status.level}/${status.skillLevel}/${status.equipLevel}`];
  if (!form) throw new Error('Missing Clementia form for five-tier status');
  const record = composeUnitRecord(identity, unit, form, { skillIndex: 1 });
  if (!record?.skill || record.skills.length !== 3) throw new Error('Incomplete Clementia loadout');
  record.nationId = 'egir';
  const count = elite ? 2 : 3;
  const desc = `<战斗中>克莱门莎在场时，所有友方单位的击杀合并计数；每累计击败${count}个敌人，克莱门莎所属的已激活盟约【阿戈尔】【迅捷】【不屈】各+1层。此特质不授予其他干员，不增加其他干员所属盟约的层数（联防不生效）`;
  const garrison = {
    garrisonId: gid, desc, descRaw: desc, eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', effectKey: effect, battleRuneKey: 'env_gbuff_new_with_verify', charLevel: Number(elite),
    bb: { check_cnt: count, bond_add_count: 1 },
    bbStr: { key: effect, bond_type: 'bond_by_id', bond_id: affiliations.join(','), bond_add_type: 'by_count' },
    owners: [id],
  };
  chess[id] = record; garrisons[gid] = garrison;
  upsert('chess', [id], record); upsert('garrisons', [gid], garrison);
}
// Keep stable chess IDs for saved loadouts, but remove the former raid affiliation.
for (const bond of [...affiliations, 'raidShip']) {
  for (const field of ['members', 'visibleMembers']) {
    const list = bonds[bond][field];
    if (affiliations.includes(bond)) { if (!list.includes(base)) list.push(base); }
    else { const i = list.indexOf(base); if (i >= 0) list.splice(i, 1); }
    upsert('bonds', [bond, field], list);
  }
}
// Preserve the already-tested self-select entry, with the same custom affiliations.
backups.diy.operators[charId].bonds = affiliations;
upsert('backups', ['diy', 'operators', charId, 'bonds'], affiliations);
// Its forms must survive a future build whose upstream chess table predates this custom piece.
upsert('backups', ['units', charId], unit);
for (const [name, value] of Object.entries({ chess, garrisons, bonds, backups, 'custom-overlay': overlay })) {
  const path = new URL(`${name}.json`, root);
  const previous = await readFile(path, 'utf8');
  await writeFile(path, JSON.stringify(value, null, previous.startsWith('{\n') ? 2 : undefined) + '\n');
}
console.log(JSON.stringify({ base, golden, tier: 5, defaultSkill: 2, bonds: affiliations, kills: [3, 2] }));
