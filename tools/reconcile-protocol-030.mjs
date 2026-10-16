import fs from 'node:fs/promises';
import { parse } from 'acorn';
const root = new URL('../', import.meta.url), file = new URL('shared/protocol.js', root);
const custom = await fs.readFile(file, 'utf8');
let official = await fs.readFile(new URL('../../upstream-v0.3.0-audit-20261016/source/shared/protocol.js', root), 'utf8');
const declaration = (text, name) => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .flatMap(node => node.declaration?.declarations || []).find(node => node.id.name === name).init;
const key = prop => prop.key.name ?? prop.key.value;
const oldRows = declaration(custom, 'C2S'), newRows = declaration(official, 'C2S');
const rows = new Map(newRows.properties.map(prop => [key(prop), { node: prop.value, text: official }]));
for (const prop of oldRows.properties) {
  const name = key(prop), prior = rows.get(name);
  if (!prior) { rows.set(name, { node: prop.value, text: custom }); continue; }
  const fields = new Map(prop.value.properties.map(p => [key(p), custom.slice(p.value.start, p.value.end)]));
  for (const p of prior.node.properties) fields.set(key(p), prior.text.slice(p.value.start, p.value.end));
  const optional = [...new Set([...prop.value.properties, ...prior.node.properties]
    .filter(p => key(p) === '$optional').flatMap(p => p.value.elements.map(e => e.value)))];
  if (optional.length) fields.set('$optional', JSON.stringify(optional));
  if (name === 'g.choice') fields.set('idx', '(v) => isInt(v, 0, 11)');
  rows.set(name, { code: '{ ' + [...fields].map(([k, v]) => JSON.stringify(k) + ': ' + v).join(', ') + ' }' });
}
const body = '{\n' + [...rows].map(([name, row]) => '  ' + JSON.stringify(name) + ': ' + (row.code || row.text.slice(row.node.start, row.node.end))).join(',\n') + '\n}';
official = official.slice(0, newRows.start) + body + official.slice(newRows.end);
official = `import { DEFAULT_SEATS } from './constants.js';
import { extensionEnvelope } from './roomExtensions.js';
import { validChat } from './chat.js';
import { validVisibility, validMapVersion, validRecruitment } from './roomDirectory.js';
import { validGameMode } from './cloneMode.js';
` + official.replace('players: 4, leaked:', 'players: MAX_SEATS, leaked:');
parse(official, { ecmaVersion: 'latest', sourceType: 'module' });
await fs.writeFile(file, official);
console.log('Official validators and stat views retained; custom RPC fields merged explicitly.');
