import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pinText } from '../server/hot/gateway.mjs';
import assert from 'node:assert/strict';
const out = 'C:/Users/34775/Documents/Codex/2026-10-10/a/outputs/clone-r22-deploy';
const deployment = JSON.parse(await readFile(`${out}/deployment.json`, 'utf8'));
const files = [
  ['public/js/main.js', 'js/main-clone-ui1.js', "from './screens/game.js'", "from './screens/game-clone-ui1.js'"],
  ['public/js/screens/game.js', 'js/screens/game-clone-ui1.js', "from '../ui/hud.js'", "from '../ui/hud-clone-ui1.js'"],
  ['public/js/ui/hud.js', 'js/ui/hud-clone-ui1.js'],
];
for (const [source, target, before, after] of files) {
  let body = await readFile(source, 'utf8');
  if (before) { assert.ok(body.includes(before)); body = body.replace(before, after); }
  body = pinText(body, 'application/javascript', '/' + source.slice(7), deployment.generation);
  await mkdir(`${out}/ui-hotfix/${target.slice(0, target.lastIndexOf('/'))}`, { recursive: true });
  await writeFile(`${out}/ui-hotfix/${target}`, body);
}
console.log('Prepared versioned frontend aliases; original cached files and running matches are unchanged.');
