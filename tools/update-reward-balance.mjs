import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const backup = resolve(root, '.cache/reward-schedule-before-20261014');
mkdirSync(backup, { recursive: true });
for (const name of ['choices.json', 'config.json', 'custom-overlay.json']) {
  if (!existsSync(resolve(backup, name))) copyFileSync(resolve(root, 'data', name), resolve(backup, name));
}
const baseline = JSON.parse(readFileSync(resolve(root, '.cache/reward-balance-before/choices.json'), 'utf8'));
const choices = JSON.parse(readFileSync(resolve(root, 'data/choices.json'), 'utf8'));
const config = JSON.parse(readFileSync(resolve(root, 'data/config.json'), 'utf8'));
const overlay = JSON.parse(readFileSync(resolve(root, 'data/custom-overlay.json'), 'utf8'));
overlay.choices ??= [];
overlay.config ??= [];
const highModes = ['mode_single_hard', 'mode_single_abyss', 'mode_multi_hard', 'mode_multi_abyss'];
// Replace the overly broad family overrides with mode-specific schedules.
overlay.choices = overlay.choices.filter(c => !(c.path[0] === 'schedule' && c.path[2] === 'rounds' && c.path[4] === 'families'));
function persist(file, path, value) {
  const existing = overlay[file].find(c => JSON.stringify(c.path) === JSON.stringify(path));
  if (existing) existing.value = structuredClone(value);
  else overlay[file].push({ path, value: structuredClone(value) });
}
for (const [mode, schedule] of Object.entries(baseline.schedule)) {
  if (highModes.includes(mode)) {
    const rounds = { 3: structuredClone(schedule.rounds['3']), 9: structuredClone(schedule.rounds['9']), 11: structuredClone(schedule.rounds['11']) };
    rounds[3].families = [{ family: 'bounty', weight: 1 }];
    rounds[9].families = [{ family: 'bounty', weight: 1 }];
    rounds[11].families = ['bounty', 'shop', 'tactic'].map(family => ({ family, weight: 1 }));
    choices.schedule[mode].rounds = rounds;
    choices.schedule[mode].spRounds = [3, 9, 11];
    config.modes[mode].spRounds = [3, 9, 11];
    persist('choices', ['schedule', mode, 'rounds'], rounds);
    persist('choices', ['schedule', mode, 'spRounds'], [3, 9, 11]);
    persist('config', ['modes', mode, 'spRounds'], [3, 9, 11]);
  } else {
    for (const [round, node] of Object.entries(schedule.rounds || {})) {
      choices.schedule[mode].rounds[round].families = structuredClone(node.families);
      persist('choices', ['schedule', mode, 'rounds', round, 'families'], node.families);
    }
  }
}
for (const key of ['shopDraft', 'tacticDraft']) {
  choices[key].rounds = [11];
  persist('choices', [key, 'rounds'], [11]);
}
writeFileSync(resolve(root, 'data/choices.json'), JSON.stringify(choices) + '\n');
writeFileSync(resolve(root, 'data/config.json'), JSON.stringify(config) + '\n');
writeFileSync(resolve(root, 'data/custom-overlay.json'), JSON.stringify(overlay) + '\n');
console.log('High difficulty: entering R3/R9 fixed bounties, R11 equal categories; other difficulties restored.');
