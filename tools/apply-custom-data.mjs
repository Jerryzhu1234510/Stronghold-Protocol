import fs from 'node:fs/promises';
const root = new URL('../data/', import.meta.url);
const overlay = JSON.parse(await fs.readFile(new URL('custom-overlay.json', root), 'utf8'));
for (const [file, changes] of Object.entries(overlay)) {
  const path = new URL(`${file}.json`, root);
  const previous = await fs.readFile(path, 'utf8');
  const data = JSON.parse(previous);
  for (const change of changes) {
    let parent = data;
    for (const key of change.path.slice(0,-1)) parent = parent[key] ??= {};
    const key = change.path.at(-1);
    if (change.delete) delete parent[key]; else parent[key] = structuredClone(change.value);
  }
  await fs.writeFile(path, JSON.stringify(data, null, previous.startsWith('{\n') ? 2 : undefined)+'\n');
}
console.log('Restored custom collab operators, affiliations and voice/assets overlay.');
