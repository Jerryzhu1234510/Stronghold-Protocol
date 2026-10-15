import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, '.cache/v026-integration');
const local = a => a, next = (a,b) => b, both = (a,b) => a + b;
// Explicit conflict decisions; the candidate contains all other clean upstream hunks.
const choices = {
  'public/i18n/ko.json': [next],
  'public/js/audio.js': [both, next, (a,b) => b.replace(/    this.voiceGate = new VoiceGate\(\);\n    this.voiceNode[^\n]*\n    this.voiceToken[^\n]*\n/, ''), both, local],
  'public/js/main.js': [next, both],
  'public/js/render/app.js': [next, (a,b) => b.replace("quality: 'high',", "quality: 'high', frameRate: 60,"), next, both],
  'public/js/render/spine.js': [next,next,next,next],
  'public/js/render/units.js': [next,next,next,next,next,next,next],
  'public/js/screens/game.js': [next],
  'public/js/screens/bandDraft.js': [(a) => a.replace('draft.order.length > 1', 'draft.order.filter(pid => !draft.picks.has(pid)).length > 1')],
  'public/js/ui/gameLogic/settings.js': [(a) => a.replace('officialDamageNumbers: false,', 'officialDamageNumbers: false, ammoCount: false,'), (a) => a.replace('officialDamageNumbers: boolean,', 'officialDamageNumbers: boolean, ammoCount: boolean,')],
  'public/js/ui/settings.js': [local,local,(a,b) => b.slice(b.indexOf('      <${Toggle} label=${t(\'弹药数量\')}'))],
  'server/http/routes.js': [(a,b) => b.replace('lobby, traffic,', 'lobby, matchWorkerPool, assetTraffic: traffic,'), local],
  'server/http/static.js': [(a) => a.replace('new GzipCache()', 'new CompressCache()'), (a,b) => b + a],
  'server/http/websocket.js': [local, (a,b) => b.replace('{ ...WS_DEFLATE }', 'websocketCompression()')],
  'server/index.js': [(a,b) => b.replace('bindCandidates, ', ''), local,both,both, (a) => a.replace('packs, traffic,', 'packs, assetIndex, views, assetTraffic, traffic,')],
  'server/sim/content/kits/ops/op-wisdel.js': [(a) => a.replace('!battle.grid.inRect(r, c) ||', '!battle.grid.inRect(r, c) || !battle.onFieldBoard(r, c) ||')],
  'test/render/browser.test.js': [next],
  'test/ui/gameLogic.test.js': [(a) => a.replace('damageNumbers: false,', 'damageNumbers: false, officialDamageNumbers: false, ammoCount: false,')],
};
for (const [path, transforms] of Object.entries(choices)) {
  let i = 0;
  const src = readFileSync(resolve(dir, 'candidate', path), 'utf8');
  const text = src.replace(/<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n/g, (_, a, b) => {
    const transform = transforms[i++];
    if (!transform) throw new Error(`unreviewed conflict ${path} ${i}`);
    return transform(a,b);
  });
  if (i !== transforms.length || text.includes('<<<<<<<')) throw new Error(`unexpected conflicts in ${path}`);
  writeFileSync(resolve(root,path), text);
  console.log(`${path}: ${i} reviewed conflicts`);
}
for (const path of ['test/diag.test.js', 'test/render/hud-readouts.test.js']) {
  const dest = resolve(root,path);
  if (existsSync(dest)) throw new Error(`refusing to replace ${path}`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(root,'.cache/upstream-v026',path),dest);
}
