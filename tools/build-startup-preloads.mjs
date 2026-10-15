import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const htmlPath=path.join(root,'public/index.html');let html=await fs.readFile(htmlPath,'utf8');
const importMap=/<script type="importmap">([\s\S]*?)<\/script>/;
const imports=JSON.parse(html.match(importMap)[1]).imports;
const seen=new Set(),files=[];
const filename=url=>{const p=new URL(url,'https://local').pathname;return p.startsWith('/shared/')?path.join(root,p.slice(1))
 :p.startsWith('/sim/')?path.join(root,'server',p.slice(1)):path.join(root,'public',p.slice(1));};
async function walk(url){
 if(seen.has(url))return;seen.add(url);
 const text=await fs.readFile(filename(url),'utf8');files.push({url,bytes:Buffer.byteLength(text)});
 const parsed=ts.createSourceFile(url,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 for(const node of parsed.statements){
  if(!(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))||!node.moduleSpecifier)continue;
  const spec=node.moduleSpecifier.text;
  let target=imports[spec]??(spec.startsWith('.')||spec.startsWith('/')?new URL(spec,'https://local'+url).pathname:null);
  target=imports[target]??target;
  if(!target)throw new Error('Unresolved startup module: '+spec);
  await walk(target);
 }
}
await walk('/js/main.js');
const marker=/\n  <!-- startup-preloads:start -->[\s\S]*?<!-- startup-preloads:end -->\n/g;
html=html.replace(marker,'');
html=html.replace(/\s*<link rel="modulepreload"[^>]*\/>/g,'');
const links='\n  <!-- startup-preloads:start -->\n'+files.map(x=>`  <link rel="modulepreload" href="${x.url}" />`).join('\n')+'\n  <!-- startup-preloads:end -->\n';
html=html.replace(importMap,(match)=>match+links);
await fs.writeFile(htmlPath,html);
console.log(JSON.stringify({modules:files.length,bytes:files.reduce((n,x)=>n+x.bytes,0),largest:files.sort((a,b)=>b.bytes-a.bytes).slice(0,4)}));
