// Reproducible 8443 roster additions, applied after the official build-data pass.
// Existing official records win; only the explicitly retained shop pair and extra DIY roster are added.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(import.meta.dirname, '..');
export async function applyCompatOperators(directory = path.join(root, 'data')) {
  const source = JSON.parse(await fs.readFile(path.join(root, 'tools/compat/extra-operators.json'), 'utf8'));
  const additions = new Set(['char_4182_oblvns', 'char_4217_makoto']);
  const chessIds = new Set(source.chess.map(c => c.path[0]));
  const receipt = {};
  for (const [file, changes] of Object.entries(source)) {
    const filename = path.join(directory, file + '.json');
    const current = JSON.parse(await fs.readFile(filename, 'utf8'));
    let n = 0;
    for (const change of changes) {
      const keys = change.path.slice();
      if (file === 'assets' && keys[0] === 'audio') {
        const charId = keys.at(-1);
        if (!additions.has(charId)) continue;
        if (keys[2] !== 'langs' || keys[3] !== 'jp') continue;
        const toUrl = line => `/assets/audio/voice/jp/${charId}/${line}.mp3`;
        const bank = {};
        for (const [key, value] of Object.entries(change.value)) {
          if (key === 'skill') for (const [slot, line] of Object.entries(value)) bank[`skill${slot}`] = toUrl(line);
          else bank[key] = Array.isArray(value) ? value.map(toUrl) : toUrl(value);
        }
        for (const [slot, num] of Object.entries({ start: 19, faceEnemy: 20, resultFour: 29, resultThree: 30, resultTwo: 31, resultLose: 32 })) bank[slot] ??= toUrl(`cn_0${num}`);
        // These retained operators have JP audio only; use those actual files as the Chinese fallback as before.
        current.audio.voiceJp[charId] = bank;
        current.audio.voice[charId] = bank;
        n++;
        continue;
      }
      if (file === 'backups' && keys.join('.') === 'diy.ownedPool') {
        current.diy.ownedPool = [...new Set([...current.diy.ownedPool, ...additions])]; n++; continue;
      }
      if (file === 'backups' && keys.join('.') === 'diy.excluded') {
        current.diy.excluded = current.diy.excluded.filter(v => !additions.has(typeof v === 'string' ? v : v.charId)); n++; continue;
      }
      if (file === 'backups' && keys.length > 2 && keys[0] === 'diy' && !additions.has(keys[2])) continue;
      let parent = current;
      for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
      const key = keys.at(-1);
      if (file === 'bonds') {
        const extra = change.value.filter(id => chessIds.has(id));
        parent[key] = [...new Set([...(parent[key] || []), ...extra])]; n += extra.length; continue;
      }
      if (parent[key] == null && !change.delete) { parent[key] = structuredClone(change.value); n++; }
    }
    if (file === 'backups') for (const id of additions) {
      const unit = current.units[id];
      if (unit) { unit.subProfessionName ||= { lord: '领主', dollkeeper: '傀儡师' }[unit.subProfessionId]; unit.assets.avatarGolden = `${id}_2`; unit.assets.portraitGolden = `${id}_2`; }
    }
    if (file === 'assets' && current.stats) {
      current.stats.chars = Object.keys(current.chars).length;
      current.stats.charsWithBack = Object.values(current.chars).filter(c => c.spine?.back).length;
      current.stats.skills = Object.keys(current.skills).length;
      for (const [key, bank] of [['voiceChars', 'voice'], ['voiceJpChars', 'voiceJp']]) current.stats[key] = Object.keys(current.audio[bank] || {}).length;
      const models = new Set();
      for (const c of Object.values(current.chars)) for (const s of Object.values(c.spine || {})) if (s?.skel) models.add(s.skel);
      for (const c of [...Object.values(current.enemies), ...Object.values(current.tokens)]) if (c.spine?.skel) models.add(c.spine.skel);
      current.stats.spineModels = models.size;
    }
    await fs.writeFile(filename, JSON.stringify(current) + '\n');
    receipt[file] = n;
  }
  console.log('8443 retained operators: ' + JSON.stringify(receipt));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await applyCompatOperators();
