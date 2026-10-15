// Restore board discovery from an existing extracted-art manifest; never invent asset paths.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const source = process.argv[2];
assert.ok(source, 'Pass the existing local-assets.json to recover board entries');
const root = process.cwd(), target = path.join(root, 'data/local-assets.json');
const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { version: 1, source: 'local-client', groups: {} };
const original = JSON.parse(fs.readFileSync(source, 'utf8'));
let added = 0;
for (const [group, entries] of Object.entries(original.groups)) {
  if (!group.startsWith('map/') && !group.startsWith('mesh/')) continue;
  for (const [name, entry] of Object.entries(entries)) {
    const asset = typeof entry.path === 'string' && entry.path.startsWith('/assets/local/') ? path.join(root, 'public', entry.path) : null;
    if (!asset || !fs.existsSync(asset)) continue;
    existing.groups[group] ||= {};
    if (existing.groups[group][name]) continue;
    existing.groups[group][name] = entry; added++;
  }
}
assert.ok(existing.groups['map/autochess']?.TX_autochessi_D, 'Board diffuse atlas must exist');
existing.count = Object.values(existing.groups).reduce((n, entries) => n + Object.keys(entries).length, 0);
fs.writeFileSync(target, JSON.stringify(existing) + '\n');
console.log(JSON.stringify({ restoredBoardEntries: added, totalEntries: existing.count }));
