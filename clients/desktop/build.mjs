import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const output=path.join(root,`export/卫戍协议-PC内置资源版-v${version}`);
const pack=path.join(output,'resources/pack');
const source=path.resolve(root,'../../public');
const manifest=JSON.parse((await fs.readFile(path.resolve(root,'resource-baseline.json'),'utf8')).replace(/^\uFEFF/,''));
const extras={};
async function walkExtras(dir){for(const ent of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isDirectory())await walkExtras(file);else if(ent.isFile()&&/\.(obj|json)$/i.test(ent.name)){const bytes=await fs.readFile(file),url='/'+path.relative(source,file).split(path.sep).map(encodeURIComponent).join('/');if(!manifest.entries[url])extras[url]={hash:sha(bytes),bytes:bytes.length};}}}
await walkExtras(path.join(source,'assets/local'));
if(!manifest.entries['/fonts/fonts.css']){const fontCss=await fs.readFile(path.join(source,'fonts/fonts.css'));extras['/fonts/fonts.css']={hash:sha(fontCss),bytes:fontCss.length};}
const runtime=process.env.SP_ELECTRON_RUNTIME || path.join(root,'tools/electron-44.7.0');
await fs.access(path.join(runtime,'electron.exe'));
await fs.mkdir(pack,{recursive:true});
const index={version:1,files:Object.keys(manifest.entries).length+Object.keys(extras).length,bytes:0,extraBuilds:['8edb310885ef-1'],extras,extrasByBuild:manifest.extrasByBuild||{},entries:{}};
const file=await fs.open(path.join(pack,'assets.bin'),'w');
try{
 for(const [url,item]of Object.entries({...manifest.entries,...extras})){
  const absolute=path.resolve(source,decodeURIComponent(url.slice(1)));
  if(!absolute.startsWith(source+path.sep))throw Error('Unsafe resource path');
  const bytes=await fs.readFile(absolute);if(bytes.length!==item.bytes||sha(bytes)!==item.hash)throw Error('Source hash mismatch '+url);
  const core=!extras[url]&&!/\.(mp3|ogg|wav|m4a|aac|flac|opus|mp4|webm)$/i.test(url);
  if(index.entries[item.hash]){if(core)index.entries[item.hash].core=true;continue}
  index.entries[item.hash]={offset:index.bytes,bytes:item.bytes,core};
  let written=0;while(written<bytes.length){const result=await file.write(bytes,written,bytes.length-written,index.bytes+written);written+=result.bytesWritten}index.bytes+=bytes.length;
 }
}finally{await file.close()}
const indexBytes=Buffer.from(JSON.stringify(index));await fs.writeFile(path.join(pack,'index.json'),indexBytes);
await fs.writeFile(path.join(pack,'bundle-info.json'),JSON.stringify({version:1,files:index.files,unique:Object.keys(index.entries).length,bytes:index.bytes,indexSha256:sha(indexBytes)},null,2));
await fs.cp(runtime,output,{recursive:true});
await fs.rename(path.join(output,'electron.exe'),path.join(output,'卫戍协议.exe'));
const appDir=path.join(output,'resources/app');await fs.mkdir(appDir,{recursive:true});
for(const name of ['package.json','main.cjs','client.cjs','program-cache.cjs','preload.cjs','mod-preview.cjs','mod-preview.html','mod-preview.css','mod-preview.js','resources.cjs','mods.cjs','music-events.cjs','session-music.cjs','unit-motion.cjs','unit-motion-observer.cjs','unit-motion-observer-plan.json','battle-music-events.cjs','sim-music-observer.cjs','sim-music-observer-plan.json','patches.cjs','MODS.md','Mod使用指南.md','Mod制作指南-AI.md','Mod目标素材清单-0.2.5.json','Mod目标素材清单-0.2.6.json','Mod目标素材清单-0.3.0.json','mod-tool.cjs','launcher.html','launcher.js','servers.json'])await fs.copyFile(path.join(root,name),path.join(appDir,name));
await fs.copyFile(path.resolve(root,'LICENSE'),path.join(output,'LICENSE.game.txt'));
await fs.copyFile(path.join(root,'README.md'),path.join(output,'使用说明.md'));
await fs.copyFile(path.join(root,'启动并检查.cmd'),path.join(output,'启动并检查.cmd'));
try{await fs.copyFile(path.join(root,'export/示例Mod-外观与音效候选.zip'),path.join(output,'示例Mod-外观与音效候选.zip'));}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.copyFile(path.join(root,'本地0.3.0测试.cmd'),path.join(output,'本地0.3.0测试.cmd'));
await fs.mkdir(path.join(output,'Mods'),{recursive:true});
try{await fs.copyFile(path.join(root,'export/雨爱-队友生命归零-Mod.zip'),path.join(output,'Mods/雨爱-队友生命归零-Mod.zip'));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const name of ['Mod使用指南.md','Mod制作指南-AI.md'])await fs.copyFile(path.join(root,name),path.join(output,name));
await fs.copyFile(path.join(root,'THIRD-PARTY-NOTICES.txt'),path.join(output,'THIRD-PARTY-NOTICES.txt'));
const receipt={ok:true,version,platform:'win32-x64',electron:'44.7.0',directory:output,files:index.files,unique:Object.keys(index.entries).length,resourceBytes:index.bytes,indexSha256:sha(indexBytes),sourceHashesVerified:true};
await fs.writeFile(path.join(root,'export/build-result.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

