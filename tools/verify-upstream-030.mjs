import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const upstream=path.resolve('../../upstream-v0.3.0-audit-20261016/source');
const files=execFileSync('git',['ls-files','test'],{cwd:upstream,encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>/\.test\.(js|mjs)$/.test(f)&&fs.existsSync(f));
const folder='../upstream-regression';fs.mkdirSync(folder,{recursive:true});
const summary=[];
for(let i=0;i<files.length;i+=45){const group=files.slice(i,i+45),log=fs.openSync(`${folder}/batch-${i/45}.log`,'w');
 const child=spawn(process.execPath,['--test','--test-concurrency=4',...group],{stdio:['ignore',log,log],env:{...process.env,SP_E2E:'0',SP_REAL_E2E:'0',SIM_E2E:'0',RENDER_E2E:'0',NO_COLOR:'1'}});
 const code=await new Promise(resolve=>child.once('exit',resolve));fs.closeSync(log);const row={batch:i/45,files:group.length,code};summary.push(row);console.log(JSON.stringify(row));fs.writeFileSync(`${folder}/summary.json`,JSON.stringify(summary,null,2));}
process.exitCode=summary.some(s=>s.code!==0)?1:0;
