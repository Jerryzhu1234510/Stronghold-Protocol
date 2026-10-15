import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { Downloader } from './assets/downloader.mjs';
import { processModels } from './assets/spine.mjs';
import { RAW, safeName, joinUrl, assetUrl } from './assets/sources.mjs';
import { kindOf } from './assets/formats.mjs';
import { indexVoice, VOICE_DIRS, VOICE_BATTLE_SLOTS } from './assets/audio.mjs';

const root = process.cwd(), assetRoot = resolve(root, 'public/assets');
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await readJson('data/assets.json');
const skinTable = await readJson('.cache/cosmetics-skin-table.json');
const words = await readJson('.cache/cosmetics-charword.json');
const run = promisify(execFile);
// Use the explicitly configured local network proxy without changing any system setting.
const fetchImpl = process.env.SP_HTTP_PROXY ? async (url, options = {}) => {
  const { stdout } = await run('curl.exe', ['--proxy', process.env.SP_HTTP_PROXY, '-L', '--silent', '--show-error', '--max-time', '30', '--write-out', '\n%{http_code}', url],
    { encoding: 'buffer', maxBuffer: 32 * 1048576, signal: options.signal, windowsHide: true });
  const split = stdout.lastIndexOf(10), status = Number(stdout.subarray(split + 1).toString());
  return new Response(stdout.subarray(0, split), { status });
} : globalThis.fetch;
const dl = new Downloader({ root: assetRoot, ledgerPath: resolve(root, '.cache/cosmetics-ledger.json'), concurrency: 16,
  retries: 1, timeoutMs: 35000, fetchImpl });
await dl.loadLedger();
const job = (rel, urls) => ({ rel, urls, kind: kindOf(rel) });
const skins = Object.values(skinTable.charSkins).filter(s => s.isBuySkin && manifest.chars[s.charId]);
const imageJobs = [], models = new Map();
for (const skin of skins) {
  const skinKey = safeName(skin.battleSkin.skinOrPrefabId), dir = `cosmetics/${skinKey}/`;
  for (const [role, folder] of [['avatar', 'avatar'], ['portrait', 'portrait']]) {
    const id = skin[role + 'Id'];
    imageJobs.push(job(dir + role + '.png', [joinUrl(RAW.yuanyan, `${folder}/${id}.png`),
      joinUrl(RAW.aa2, `arts/${role === 'portrait' ? 'charportraits' : folder}/${id}.png`)]));
  }
  for (const side of ['Front', 'Back']) {
    const modelDir = dir + side.toLowerCase() + '/', base = `${RAW.fexli}spine/${skin.charId}/${skinKey}/${side}/`;
    models.set(`${skin.skinId}:${side}`, { key: `op:${skinKey}:${side}`, kind: 'op', dir: modelDir, pma: false, skillIndices: [0, 1, 2], baseUrl: base,
      skel: job(modelDir + skinKey + '.skel', [base + skinKey + '.skel']),
      atlas: { ...job(modelDir + skinKey + '.atlas', [base + skinKey + '.atlas']), mutable: true },
      pngs: [job(modelDir + skinKey + '.png', [base + skinKey + '.png'])] });
  }
}
console.log(`Planning ${skins.length} skins and ${models.size} battle models`);
await dl.run(imageJobs, 'skin art');
const spine = await processModels(models, { root: assetRoot, dl, cachePath: resolve(root, '.cache/cosmetics-spine.json') });
const exists = async rel => { try { await access(resolve(assetRoot, rel)); return true; } catch { return false; } };
const selectedSkins = {};
for (const skin of skins) {
  const key = safeName(skin.battleSkin.skinOrPrefabId), dir = `cosmetics/${key}/`;
  const front = spine.entries.get(`op:${key}:Front`), back = spine.entries.get(`op:${key}:Back`);
  if (!front || !await exists(dir + 'avatar.png') || !await exists(dir + 'portrait.png')) continue;
  (selectedSkins[skin.charId] ??= {})[skin.skinId] = { id: skin.skinId, name: skin.displaySkin.skinName || skin.displaySkin.skinGroupName,
    avatar: assetUrl(dir + 'avatar.png'), portrait: assetUrl(dir + 'portrait.png'), spine: { front, ...(back ? { back } : {}) } };
}
const voiceJobs = [], plans = {};
for (const lang of ['cn', 'jp', 'en']) {
  plans[lang] = {};
  for (const [id, slots] of indexVoice(words, 'CN', VOICE_BATTLE_SLOTS)) {
    if (!manifest.chars[id]) continue;
    plans[lang][id] = {};
    for (const [slot, lines] of Object.entries(slots)) {
      plans[lang][id][slot] = lines.map(line => {
        const file = line.toLowerCase().replace(id.toLowerCase(), id), rel = `audio/voice/${lang}/${file}.mp3`;
        voiceJobs.push(job(rel, [joinUrl(RAW.aa2voice, `${VOICE_DIRS[lang]}/${file}.mp3`)]));
        return rel;
      });
    }
  }
}
await dl.run(voiceJobs, 'battle voices');
// Merge against the latest manifest so other generated asset additions are preserved.
const next = await readJson('data/assets.json');
for (const [id, entries] of Object.entries(selectedSkins)) next.chars[id].skins = { ...next.chars[id].skins, ...entries };
const voice = next.audio.voice;
voice.banks ??= {}; voice.langs ??= {}; voice.root = '/assets/audio/voice'; voice.ext = '.mp3';
for (const [lang, chars] of Object.entries(plans)) {
  voice.banks[lang] ??= {}; voice.langs[lang] ??= {};
  for (const [id, slots] of Object.entries(chars)) {
    const bank = {}, lines = { place: [], select: [], skill: {} };
    for (const [slot, rels] of Object.entries(slots)) {
      const files = [];
      for (const rel of rels) if (await exists(rel)) files.push(rel);
      if (!files.length) continue;
      const urls = files.map(assetUrl);
      bank[slot] = urls.length === 1 ? urls[0] : urls;
      const ids = files.map(path => path.split('/').at(-1).replace('.mp3', ''));
      if (slot === 'place' || slot === 'select') lines[slot] = ids;
      else if (/^skill[1-4]$/.test(slot)) lines.skill[slot.slice(-1)] = ids[0];
    }
    if (Object.keys(bank).length) voice.banks[lang][id] = { ...voice.banks[lang][id], ...bank };
    if (lines.place.length || lines.select.length || Object.keys(lines.skill).length) voice.langs[lang][id] = { ...voice.langs[lang][id], ...lines };
  }
}
next.cosmeticsSources = { skins: 'Kengxxiao/ArknightsGameData', battleModels: 'fexli/ArknightsResource', voices: 'ArknightsAssets/ArknightsAssets2' };
await writeFile(resolve(root, 'data/assets.json.tmp'), JSON.stringify(next));
await rename(resolve(root, 'data/assets.json.tmp'), resolve(root, 'data/assets.json'));
console.log(JSON.stringify({ skins: Object.values(selectedSkins).reduce((sum, entries) => sum + Object.keys(entries).length, 0), operators: Object.keys(selectedSkins).length,
  voices: Object.fromEntries(Object.entries(voice.banks).map(([lang, chars]) => [lang, Object.keys(chars).length])), download: dl.totals, problems: spine.problems.length }));
