import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const allowed=['public/css/room-directory.css','public/css/lobby-toolbar.css'];
const pages=['public/index.html','public/js/browser/game.html'];
export async function applyClientStyles(root,payload){
 root=await fs.realpath(root);
 const recipe=JSON.parse(await fs.readFile(path.join(payload,'style-manifest.json'),'utf8'));
 if(Object.keys(recipe.styles).sort().join()!==allowed.slice().sort().join())throw Error('Expected the complete approved lobby style group');
 const original={},styles={};
 for(const name of [...allowed,...pages]){
  const bytes=await fs.readFile(path.join(root,name)),expected=recipe.before[name];
  if(!expected||hash(bytes)!==expected)throw Error('Unexpected published base: '+name);
  if(pages.includes(name))original[name]=bytes;
 }
 for(const name of allowed){
  const item=recipe.styles[name];if(!/^[a-z.-]+$/.test(item.file))throw Error('Unsafe payload path');
  const bytes=await fs.readFile(path.join(payload,item.file));if(hash(bytes)!==item.sha256)throw Error('Payload mismatch');
  const alias=name.replace(/\.css$/,`.profile-${item.sha256.slice(0,16)}.css`);
  styles[name]={alias,bytes,sha256:item.sha256};
 }
 const revision='profile-'+hash(JSON.stringify(allowed.map(name=>styles[name].sha256))).slice(0,16),next={};
 for(const name of pages){
  let html=original[name].toString('utf8');
  for(const css of allowed){const from='/'+css.slice(7),to='/'+styles[css].alias.slice(7);if(html.split(from).length!==2)throw Error('Expected one style reference: '+css);html=html.replace(from,to);}
  next[name]=html.replace('</head>',`<meta name="sp-profile-style" content="${revision}">\n</head>`);
 }
 for(const {alias,bytes,sha256}of Object.values(styles)){
  const file=path.join(root,alias);try{await fs.writeFile(file,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST'||hash(await fs.readFile(file))!==sha256)throw e}
 }
 const backup=path.join(root,'.ui-backups',revision);await fs.mkdir(backup,{recursive:true});
 for(const name of pages){const file=path.join(backup,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,original[name],{flag:'wx'});await fs.writeFile(path.join(root,name)+'.profile.tmp',next[name]);}
 const activated=[];
 try{
  for(const name of pages){const file=path.join(root,name);if(hash(await fs.readFile(file))!==recipe.before[name])throw Error('Concurrent entry update');await fs.rename(file+'.profile.tmp',file);activated.push(name);}
 }catch(e){for(const name of activated.reverse()){const file=path.join(root,name);await fs.writeFile(file+'.profile.rollback',original[name]);await fs.rename(file+'.profile.rollback',file)}throw e}
 const receipt={ok:true,revision,styles:Object.fromEntries(allowed.map(name=>[name,{alias:styles[name].alias,sha256:styles[name].sha256}])),pages:Object.fromEntries(pages.map(name=>[name,hash(next[name])])),backup,backendRestarted:false};
 await fs.writeFile(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2));return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await applyClientStyles(process.argv[2],process.argv[3])));
