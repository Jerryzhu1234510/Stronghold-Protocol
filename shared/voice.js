// Battle-voice resolution shared by the client and the asset pipeline (server-side tools).
//
// The official voice table (`charword_table.json`, Kengxxiao/ArknightsGameData) names every battle line by
// `placeType`, which is exactly what the client triggers on:
//   BATTLE_PLACE       部署1 / 部署2      → the operator is deployed
//   BATTLE_SELECT      选中干员1 / 2      → the operator is picked
//   BATTLE_SKILL_1..4  作战中1..4         → a skill is activated
// `BATTLE_SKILL_n` counts the operator's skill slots (1-based) and matches the trailing number of its
// skill id (`skchr_<name>_3` = slot 3 = S3), which is how a chess `skillIndex` maps to a line.
//
// Pure: no I/O, so the browser (public/js/audio.js) and the build (tools/assets/voice.mjs) share it.
// The manifest shape it feeds is `audio.voice = { root, langs: { [lang]: { [charId]: { place?, select?,
// skill?: { [slot]: voiceId } } } } }` — voice *ids*, from which the client builds the clip URL.

/** Voice languages the pipeline knows, in menu order. */
export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en']);

/** placeType → role in the client's `audio.voice[lang][charId]` entry. */
const ROLE_OF_PLACE = Object.freeze({
  BATTLE_PLACE: 'place',
  BATTLE_SELECT: 'select',
});

/** `BATTLE_SKILL_<n>` → the 1-based skill slot it voices. */
const SKILL_PLACE_RE = /^BATTLE_SKILL_(\d+)$/;

/**
 * Skill slot (1-based) an operator skill id voices: the trailing number of `skchr_<name>_<n>`
 * (`skchr_excu2_2` → 2), the official `BATTLE_SKILL_n` numbering. Anything else falls back to
 * slot 1 — the line every operator with battle voices has.
 * @param {string} skillId e.g. 'skchr_excu2_2'
 * @returns {number} 1..4
 */
export function skillSlotOf(skillId) {
  const m = /_(\d+)$/.exec(String(skillId || ''));
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
}

/**
 * Battle voice ids of one operator, from its `charword_table.json` records.
 * A record with an unknown `placeType` is ignored; several records of one placeType (部署1 /
 * 部署2, 选中干员1 / 2) are kept in `voiceIndex` order.
 * @param {Array<{charId?:string, placeType?:string, voiceId?:string, voiceIndex?:number}>} records
 * @returns {{ place: string[], select: string[], skill: Record<string,string> }}
 */
export function battleLines(records) {
  const place = [];
  const select = [];
  const skill = {};
  for (const r of Array.isArray(records) ? records : []) {
    const id = r?.voiceId;
    if (typeof id !== 'string' || !id) continue;
    const role = ROLE_OF_PLACE[r.placeType];
    // one id once: an alternate set can repeat a voice id across its own records
    if (role === 'place') { if (!place.includes(id)) place.push(id); }
    else if (role === 'select') { if (!select.includes(id)) select.push(id); }
    else {
      const m = SKILL_PLACE_RE.exec(String(r.placeType || ''));
      if (m && !skill[m[1]]) skill[m[1]] = id;
    }
  }
  return { place, select, skill };
}

/**
 * Battle lines of every operator in `charword`, keyed by charId.
 *
 * A record belongs to the operator's own voice set only when its `wordKey` is the charId itself:
 * a skin or alternate set (`wordKey` `char_4064_mlynar_epoque#28`, records whose `voiceAsset` sits
 * under `char_4064_mlynar_epoque#28/`) has its own bundle and must not be mixed in — a skin set
 * carries different texts under the same voice ids, and reading several sets at once repeated every
 * deploy / select line once per set. Records are ordered by `voiceIndex`, so 部署1 precedes 部署2.
 * @param {Record<string, any>} charWords `charword_table.json` charWords (charWordId → record)
 * @param {Iterable<string>} [charIds] restrict to these (the roster)
 * @returns {Map<string, { place: string[], select: string[], skill: Record<string,string> }>}
 */
export function voiceLinesOf(charWords, charIds) {
  const want = charIds ? new Set(charIds) : null;
  const byChar = new Map();
  for (const rec of Object.values(charWords || {})) {
    const charId = rec?.charId;
    if (typeof charId !== 'string' || !charId) continue;
    if (want && !want.has(charId)) continue;
    // the operator's own set only: a skin set has another wordKey (char_4064_mlynar_epoque#28)
    if (rec?.wordKey !== charId) continue;
    if (!byChar.has(charId)) byChar.set(charId, []);
    byChar.get(charId).push(rec);
  }
  const out = new Map();
  for (const [charId, recs] of byChar) {
    recs.sort((a, b) => (a.voiceIndex ?? 0) - (b.voiceIndex ?? 0));
    const lines = battleLines(recs);
    if (lines.place.length || lines.select.length || Object.keys(lines.skill).length) out.set(charId, lines);
  }
  return out;
}

/**
 * The roster the game actually fields: every distinct `charId` of data/chess.json. Skin-variant
 * chess (`_b` golden, `#N` skins) share their base charId, so the roster is one entry per operator.
 * @param {Record<string, any>} chess parsed data/chess.json
 * @returns {string[]} sorted charIds
 */
export function rosterCharIds(chess) {
  const ids = new Set();
  for (const c of Object.values(chess || {})) if (typeof c?.charId === 'string' && c.charId) ids.add(c.charId);
  return [...ids].sort();
}

/**
 * Pick the voice clip for a skill activation: the operator's skill slot (`skillSlotOf`), else its
 * first slot (the line every voiced operator has), else null.
 * @param {{ place?: string[], select?: string[], skill?: Record<string,string> }|null|undefined} lines
 * @param {string} skillId
 * @returns {string|null}
 */
export function skillVoiceId(lines, skillId) {
  const skill = lines?.skill;
  if (!skill) return null;
  const slot = String(skillSlotOf(skillId));
  if (skill[slot]) return skill[slot];
  const first = Object.keys(skill).sort((a, b) => Number(a) - Number(b))[0];
  return first ? skill[first] : null;
}
