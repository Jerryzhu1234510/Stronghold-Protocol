// Inventory this local candidate after building; no art, account DB or deployment credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inManifest,parseManifest} from '../server/update.js';
const root=path.resolve(import.meta.dirname,'..'),files={};
async function walk(relative){
 const file=path.join(root,relative);let stat;try{stat=await fs.lstat(file);}catch{return;}
 if(stat.isSymbolicLink())return;
 if(stat.isDirectory()){
  if(relative==='public/assets'||relative==='public/fonts')return;
  for(const name of (await fs.readdir(file)).sort())await walk(relative+'/'+name);
 }else if(stat.isFile()&&inManifest(relative)){
  const body=await fs.readFile(file);files[relative]={size:body.length,sha256:createHash('sha256').update(body).digest('hex')};
 }
}
for(const relative of ['server','shared','data','public','scripts','tools','docs','node_modules','runtime','package.json','package-lock.json','LICENSE','NOTICE.md','THIRD-PARTY-NOTICES.md','README.md','HOT-RELEASE.json','启动0.3.0本地测试服.cmd'])await walk(relative);
const text=JSON.stringify({format:1,app:'0.3.0',files})+'\n';parseManifest(text);
await fs.writeFile(path.join(root,'MANIFEST.json'),text);
console.log(JSON.stringify({app:'0.3.0',files:Object.keys(files).length,sha256:createHash('sha256').update(text).digest('hex')}));
