import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
const upstream=path.resolve('../..','upstream-v0.3.0-audit-20261016/source');
const list=['server/lobby.js',...fs.readdirSync('server/match/match').filter(f=>f.endsWith('.js')).map(f=>'server/match/match/'+f)];
function methods(text){const out=new Map();const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='MethodDefinition'&&n.key.type==='Identifier')out.set(n.key.name,text.slice(n.start,n.end));for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);};walk(parse(text,{ecmaVersion:'latest',sourceType:'module'}));return out;}
for(const file of list){if(!fs.existsSync(path.join(upstream,file)))continue;const official=methods(fs.readFileSync(path.join(upstream,file),'utf8'));const ours=methods(fs.readFileSync(file,'utf8'));const missing=[...official.keys()].filter(k=>!ours.has(k));if(missing.length)console.log(file,missing.join(','));
 if(file==='server/lobby.js'&&process.argv.includes('--repair')){let text=fs.readFileSync(file,'utf8');for(const k of ['setAiPicksLast','rerollSetup'])if(missing.includes(k)){const pos=text.lastIndexOf('\n}');text=text.slice(0,pos)+'\n  '+official.get(k)+'\n'+text.slice(pos);}text=text.replace("case 'room.setDifficulty':", "case 'room.setAiPicksLast': return this.setAiPicksLast(session,msg);\n      case 'room.rerollSetup': return this.rerollSetup(session,msg);\n      case 'room.cancelReroll': return this.rerollSetup(session,msg,true);\n      case 'room.setDifficulty':");fs.writeFileSync(file,text);}
}
