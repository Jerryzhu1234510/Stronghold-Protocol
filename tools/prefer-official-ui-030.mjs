// One-time local migration: official duplicate behavior, narrowly retained custom UI.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
const up=path.resolve('../../upstream-v0.3.0-audit-20261016/source');
const backup=path.resolve('../ui-before-official');
const read=f=>fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');
const ours=new Map();
const files=['screens/game.js','screens/briefing.js','ui/hud.js','ui/shopBar.js','ui/fieldHost.js','ui/detailPanel.js','ui/bondStrip.js','ui/watchBonds.js','ui/gameActions.js','ui/gameComponents.js','ui/choiceOverlay.js','ui/combatHud.js','ui/emotes.js','ui/equipReplace.js','ui/diyModel.js','screens/game/early.js'];
for(const file of files){const p='public/js/'+file;ours.set(file,read(p));fs.mkdirSync(path.dirname(path.join(backup,file)),{recursive:true});fs.writeFileSync(path.join(backup,file),ours.get(file));fs.copyFileSync(path.join(up,p),p);}
const fn=(s,name)=>{const ast=parse(s,{ecmaVersion:'latest',sourceType:'module'});const n=ast.body.find(n=>(n.declaration||n).type==='FunctionDeclaration'&&(n.declaration||n).id.name===name);if(!n)throw Error(name);return s.slice(n.start,n.end);};
const edit=(f,change)=>{const p='public/js/'+f;fs.writeFileSync(p,change(read(p)));};
edit('screens/game.js',s=>s.replace("import { ShopBar }", "import { ShopBar, ShopFocusPicker }")
 .replace("// Game screen", "import { DuckWarning } from '../ui/duckWarning.js';\nimport { RoomChatHost } from '../ui/roomChat.js';\nimport { UniteVoteControls } from '../ui/uniteVote.js';\n// Game screen")
 .replace('  return html`<div class="gm', '  return html`<div class="gm')
 .replace('<${TopBar}', '<${TopBar} shopFocus=${priv?.shop?.bonusChessSlots > 0 ? html`<${ShopFocusPicker} priv=${priv} editable=${editable} />` : null}')
 .replace('<${EnemyDrawer}', '<${DuckWarning} field=${field} view=${view} round=${pub.round} /><${UniteVoteControls} pub=${pub} myId=${myId} /><${RoomChatHost} />\n      <${EnemyDrawer}'));
edit('ui/hud.js',s=>"import { PrepVoteControls } from './prepVote.js';\n"+s
 .replace('config = null, frozenAt = null, pause = null, live = null, spectator = false,','config = null, frozenAt = null, pause = null, live = null, spectator = false, shopFocus = null,')
 .replace('<div class="gtop__clock">','<div class="gtop__clock">${shopFocus}')
 .replace('${showReady ? html`<${ReadyToggle}', '${showReady ? html`<${PrepVoteControls} key=${pub.round} pub=${pub} priv=${priv} myId=${myId} /><${ReadyToggle}'));
edit('ui/shopBar.js',s=>s+'\n'+fn(ours.get('ui/shopBar.js'),'ShopFocusPicker')+'\n');
// PvP's local-only screen imports these generic card components.
edit('ui/shopBar.js',s=>s.replace(/^function (PriceHex|SoldCard|LevelCard)\(/gm,'export function $1(')
 .replace("'shopbar', frozen", "'shopbar', shop.bonusChessSlots > 0 && 'shopbar--expanded', frozen"));
edit('ui/fieldHost.js',s=>"import { waitForResourceController } from '../resources/client.js';\n"+s.replace('  checkActive(signal);\n  const pref', '  await waitForResourceController();\n  checkActive(signal);\n  const pref'));
// Restore the official room option controls that the older custom screen lacked.
edit('screens/room.js',s=>s+'\n'+fn(read(path.join(up,'public/js/screens/room.js')),'aiLastOption')+'\n'+fn(read(path.join(up,'public/js/screens/room.js')),'AiLastToggle')+'\n');
edit('screens/room.js',s=>s.replace("const setCapacity =", "const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));\n  const setCapacity =")
 .replace('<${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} />','<${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} /><${AiLastToggle} option=${aiLastOption(room,me.playerId)} busy=${busy} onToggle=${setAiLast} />'));
console.log('Official gameplay UI restored; custom room, resource, chat and extension entry points retained.');
