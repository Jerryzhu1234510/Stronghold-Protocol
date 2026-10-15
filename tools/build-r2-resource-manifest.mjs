// Bind an already-uploaded immutable asset release to the matching game resource manifest.
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { writeResourceRoutes } from './build-resource-routes.mjs';
const [sourceFile,uploadedFile,outputFile]=process.argv.slice(2);
if(!sourceFile||!uploadedFile||!outputFile)throw new Error('Usage: node tools/build-r2-resource-manifest.mjs <game-resource-cache.json> <uploaded-manifest.json> <output-resource-cache.json>');
const source=JSON.parse(await fs.readFile(sourceFile,'utf8'));
const uploaded=JSON.parse(await fs.readFile(uploadedFile,'utf8'));
if(source.version!==1||!source.entries||uploaded.version!==1||!Array.isArray(uploaded.entries))throw new Error('Invalid input manifests');
if(uploaded.base!=='https://assets.weishuxieyi.icu/'||!/^[a-f0-9]{64}$/.test(uploaded.id))throw new Error('Unexpected asset release');
const lookup=new Map(uploaded.entries.map(item=>[item.path,item]));
let mapped=0;
for(const [url,item] of Object.entries(source.entries)) {
 const remote=lookup.get(decodeURIComponent(url));
 if(!remote||remote.hash!==item.hash||remote.bytes!==item.bytes)throw new Error('Uploaded content does not match game resource: '+url);
 if(!/^pilot\/[a-zA-Z0-9_./-]+$/.test(remote.key)||remote.key.includes('..'))throw new Error('Invalid object key: '+url);
 item.cdn=uploaded.base+remote.key;mapped++;
}
source.cdn={provider:'r2',manifestId:uploaded.id,mappedResources:mapped};
const body=JSON.stringify(source);await fs.mkdir(path.dirname(path.resolve(outputFile)),{recursive:true});
await fs.writeFile(outputFile,body);await fs.writeFile(outputFile+'.gz',gzipSync(body,{level:6}));
const routingDir=path.join(path.dirname(path.resolve(outputFile)),'resource-routes');
await writeResourceRoutes(source,routingDir);
console.log(JSON.stringify({mapped,bytes:Buffer.byteLength(body),output:path.resolve(outputFile),routingDir}));
