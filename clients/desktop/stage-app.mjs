import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const out=path.join(root,`export/卫戍协议-PC内置资源版-v${version}`),app=path.join(out,'resources/app');
await fs.mkdir(app,{recursive:true});
for(const name of ['package.json','main.cjs','client.cjs','program-cache.cjs','preload.cjs','mod-preview.cjs','mod-preview.html','mod-preview.css','mod-preview.js','resources.cjs','mods.cjs','music-events.cjs','session-music.cjs','unit-motion.cjs','unit-motion-observer.cjs','unit-motion-observer-plan.json','battle-music-events.cjs','sim-music-observer.cjs','sim-music-observer-plan.json','patches.cjs','MODS.md','Mod使用指南.md','Mod制作指南-AI.md','Mod目标素材清单-0.2.5.json','Mod目标素材清单-0.2.6.json','mod-tool.cjs','launcher.html','launcher.js','servers.json'])await fs.copyFile(path.join(root,name),path.join(app,name));
await fs.copyFile(path.join(root,'README.md'),path.join(out,'使用说明.md'));
await fs.copyFile(path.join(root,'启动并检查.cmd'),path.join(out,'启动并检查.cmd'));
await fs.copyFile(path.join(root,'本地0.2.6测试.cmd'),path.join(out,'本地0.2.6测试.cmd'));
try{await fs.copyFile(path.join(root,'export/示例Mod-外观与音效候选.zip'),path.join(out,'示例Mod-外观与音效候选.zip'));}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(path.join(out,'Mods'),{recursive:true});
try{await fs.copyFile(path.join(root,'export/雨爱-队友生命归零-Mod.zip'),path.join(out,'Mods/雨爱-队友生命归零-Mod.zip'));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const name of ['Mod使用指南.md','Mod制作指南-AI.md'])await fs.copyFile(path.join(root,name),path.join(out,name));
await fs.copyFile(path.join(root,'MODS.md'),path.join(root,'export/Mod制作说明.md'));
await fs.copyFile(path.join(root,'test-output/fixtures/sample-mod.zip'),path.join(root,'export/示例Mod-留言图标外观.zip'));
console.log('Staged current app code, instructions and optional sample Mod.');
