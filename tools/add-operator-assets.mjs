// Incremental import through the normal asset planner/parser; preserves every existing manifest entry.
// Usage: node tools/add-operator-assets.mjs char_4231_clemnt
// Files must already be in public/assets. Missing optional art (e.g. E2 avatar) uses the client's normal fallback.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from './assets/plan.mjs';
import { indexAudio } from './assets/audio.mjs';
import { processModels } from './assets/spine.mjs';
import { resolveTemplate, totalBytes, contentHash, droppedEntries } from './assets/manifest.mjs';
import { dataExtras } from './fetch-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!/^char_\d+_[a-z0-9]+$/.test(id ?? '')) throw new Error('Expected a character ID');
const load = async (f) => JSON.parse(await readFile(resolve(root, `data/${f}.json`), 'utf8'));
const [backups, chess, previous] = await Promise.all([load('backups'), load('chess'), load('assets')]);
const op = dataExtras(backups, chess).extraOperators[id];
if (!op) throw new Error('Character missing from backups');
const plan = buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData: {}, extraOperators: { [id]: op } });
const assetRoot = resolve(root, 'public/assets');
const spine = await processModels(plan.models, { root: assetRoot, cachePath: resolve(root, `.cache/spine-${id}.json`), download: false });
if (spine.problems.length) throw new Error(spine.problems.join('\n'));
const template = { chars: { [id]: plan.template.chars[id] }, skills: plan.template.skills, skillsById: plan.template.skillsById,
  prof: { sub: { [op.subProfessionId]: plan.template.prof.sub[op.subProfessionId] } } };
const resolved = resolveTemplate(template, { root: assetRoot, spine: spine.entries });
const char = resolved.value.chars[id];
if (!char?.avatar || !char?.portrait || !char?.spine?.front || !char?.spine?.back) throw new Error('Required character art missing');
if (op.skills.some((s) => !resolved.value.skills?.[s.iconId || s.skillId])) throw new Error('Required skill icon missing');
const next = structuredClone(previous);
for (const [group, entries] of Object.entries(resolved.value)) {
  if (group === 'prof') Object.assign(next.prof.sub, entries.sub);
  else Object.assign(next[group] ??= {}, entries);
}
const body = Object.fromEntries(Object.entries(next).filter(([k]) => !['version', 'hash', 'generator', 'stats'].includes(k)));
next.hash = contentHash(body);
const urls = new Set();
const walk = (v) => {
  if (typeof v === 'string' && v.startsWith('/assets/')) urls.add(v.slice(8));
  else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
};
walk(previous);
const added = [...resolved.files].filter((f) => !urls.has(f));
const modelPaths = (value) => {
  const paths = new Set();
  const walkModels = (v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.skel === 'string') paths.add(v.skel);
    for (const x of Object.values(v)) walkModels(x);
  };
  walkModels(value);
  return paths;
};
const previousModels = modelPaths(previous);
const addedModels = [...modelPaths(next)].filter((p) => !previousModels.has(p)).length;
next.stats = { ...next.stats, files: next.stats.files + added.length, bytes: next.stats.bytes + totalBytes(assetRoot, added),
  chars: Object.keys(next.chars).length, charsWithBack: Object.values(next.chars).filter((c) => c.spine?.back).length,
  spineModels: next.stats.spineModels + addedModels, skills: Object.keys(next.skills).length };
if (droppedEntries(previous, next).length) throw new Error('Import would drop existing art');
await copyFile(resolve(root, 'data/assets.json'), resolve(root, `.cache/assets-before-${id}.json`));
await writeFile(resolve(root, 'data/assets.json'), JSON.stringify(next) + '\n');
console.log(JSON.stringify({ character: id, files: resolved.files.size, bytes: totalBytes(assetRoot, resolved.files), missingOptional: resolved.misses, hash: next.hash }));
