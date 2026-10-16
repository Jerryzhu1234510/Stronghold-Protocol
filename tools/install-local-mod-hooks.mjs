import fs from 'node:fs/promises';
import { parse } from 'acorn';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const plan = JSON.parse(await fs.readFile(new URL('clients/desktop/unit-motion-observer-plan.json', root)));
// Hooks ship in the source before the server computes its official content hash.
// Clients never rewrite verified simulation code. Observers have no gameplay authority.
for (const [url, entry] of Object.entries(plan.files)) {
  const file = new URL('public' + url, root);
  let text = await fs.readFile(file, 'utf8');
  if (text.includes('__SPDesktopUnitMotion')) continue;
  const variant = entry.variants.find(v => v.variant === 'canonical');
  assert.ok(variant);
  for (const edit of variant.edits) text = text.slice(0, edit.offset) + edit.text + text.slice(edit.offset);
  parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  await fs.writeFile(file, text);
}
function walk(node, ancestors, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, ancestors);
  const next = node.type ? [...ancestors, node] : ancestors;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(child)) child.forEach(x => walk(x, next, visit));
    else if (child && typeof child === 'object') walk(child, next, visit);
  }
}
for (const [relative, kind] of [['server/sim/battle/status.js', 'freeze'], ['server/sim/content/devices.js', 'wind']]) {
  const file = new URL(relative, root);
  let text = await fs.readFile(file, 'utf8');
  if (text.includes('__SPDesktopMusicBridge')) continue;
  const edits = [];
  walk(parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), [], (node, ancestors) => {
    if (kind === 'freeze' && node.type === 'MethodDefinition' && node.key.name === 'applyStatus') {
      const fn = node.value, [target, key, opts] = fn.params.map(p => p.name || p.left?.name);
      assert.ok(target && key && opts);
      edits.push({ offset: fn.body.start + 1, text: `;let __spBefore=false;try{__spBefore=!!${target}?.findBuff?.('freeze');}catch{}try{` },
        { offset: fn.body.end - 1, text: `}finally{try{if(!__spBefore&&${key}==='freeze'&&${target}?.findBuff?.('freeze'))globalThis.__SPDesktopMusicBridge?.freeze?.(this,${target},${opts}?.source);}catch{}}` });
    }
    if (kind === 'wind' && node.type === 'CallExpression' && node.callee?.property?.name === 'fx' && node.arguments[0]?.value === 'coldWind') {
      const prop = node.arguments[1]?.properties?.find(p => p.key?.name === 'playerId');
      if (!prop) return;
      const scope = [...ancestors].reverse().find(x => x.type === 'ArrowFunctionExpression');
      assert.equal(scope?.body?.type, 'BlockStatement');
      const battle = text.slice(node.callee.object.start, node.callee.object.end), pid = text.slice(prop.value.start, prop.value.end);
      edits.push({ offset: scope.body.start + 1, text: `;let __spWind;try{__spWind=globalThis.__SPDesktopMusicBridge?.enterWind?.(${battle},${pid});}catch{}try{` },
        { offset: scope.body.end - 1, text: '}finally{try{globalThis.__SPDesktopMusicBridge?.exitWind?.(__spWind);}catch{}}' });
    }
  });
  assert.equal(edits.length, 2, relative);
  for (const edit of edits.sort((a, b) => b.offset - a.offset)) text = text.slice(0, edit.offset) + edit.text + text.slice(edit.offset);
  parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  await fs.writeFile(file, text);
}
console.log('Local cosmetic hooks installed before content identity generation.');
