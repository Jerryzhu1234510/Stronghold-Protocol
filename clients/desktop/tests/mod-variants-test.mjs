import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{ModManager,parseMod}=require('../mods.cjs'),{pack}=require('../mod-tool.cjs'),{ResourceLibrary,digest}=require('../resources.cjs');
const root=await fs.mkdtemp(new URL('../test-output/mod-v2-',import.meta.url)),folder=root+'/input';await fs.mkdir(folder);
const fixture={image:Buffer.from('new appearance A'),imageB:Buffer.from('new appearance B'),audio:Buffer.from('new audio')};for(const [name,body]of Object.entries(fixture))await fs.writeFile(folder+'/'+name+(name==='audio'?'.wav':'.png'),body);
const original=digest('original'),soundOriginal=digest('original sound'),item=(file,target='/assets/avatar.png',hash=original)=>({target,originalSha256:hash,path:file});
const v=(id,name,group,category,files)=>({id,name,group,groupName:group,category,files});
const manifest={format:2,id:'test-choices',name:'外观音效测试',version:'1.0',server:'8443',files:[],variants:[v('skin-a','外观A','skin','appearance',[item('image.png')]),v('skin-b','外观B','skin','appearance',[item('imageB.png')]),v('sound-a','音效A','sound','audio',[item('audio.wav','/assets/attack.mp3',soundOriginal)])]};
async function parse(m){await fs.writeFile(folder+'/mod.json',JSON.stringify(m));return parseMod(await pack(folder));}
const parsed=await parse(manifest),mods=await new ModManager(root+'/mods').initialize();await mods.install(parsed);
assert.deepEqual((await mods.replacement('/assets/avatar.png',original)).bytes,fixture.image);
assert.deepEqual((await mods.replacement('/assets/attack.mp3',soundOriginal)).bytes,fixture.audio);
await mods.select(manifest.id,'skin','skin-b');assert.deepEqual((await mods.replacement('/assets/avatar.png',original)).bytes,fixture.imageB);
let reopened=await new ModManager(root+'/mods').initialize();assert.equal(reopened.records[0].selections.skin,'skin-b');await reopened.select(manifest.id,'skin',null);assert.equal(await reopened.replacement('/assets/avatar.png',original),null);assert.ok(await reopened.replacement('/assets/attack.mp3',soundOriginal));
await assert.rejects(()=>reopened.select(manifest.id,'skin','sound-a'));assert.equal(await reopened.replacement('/assets/attack.mp3','0'.repeat(64)),null);
await reopened.setEnabled(manifest.id,false);assert.equal(await reopened.replacement('/assets/attack.mp3',soundOriginal),null);await reopened.setEnabled(manifest.id,true);
await reopened.install(parsed);assert.equal(reopened.records[0].selections.skin,null);
await reopened.select(manifest.id,'skin','skin-b');const updated=structuredClone(manifest);updated.variants.splice(1,1);await reopened.install(await parse(updated));assert.equal(reopened.records[0].selections.skin,'skin-a');
const origin='https://test.example',raw=JSON.stringify({version:1,files:0,bytes:0,entries:{}});await fs.mkdir(root+'/pack');await fs.writeFile(root+'/pack/index.json',raw);await fs.writeFile(root+'/pack/bundle-info.json',JSON.stringify({indexSha256:digest(raw)}));await fs.writeFile(root+'/pack/assets.bin','');
const library=await new ResourceLibrary({directory:root+'/pack',origin,mods:reopened,remote:async r=>r.url.endsWith('resource-cache.json')?Response.json({version:1,entries:{'/assets/avatar.png':{hash:original,bytes:8},'/assets/attack.mp3':{hash:soundOriginal,bytes:14}}}):new Response('original')}).initialize();library.setPage(origin+'/_build/qa/');
const response=await library.handle(new Request(origin+'/assets/attack.mp3',{headers:{range:'bytes=1-3'}}));assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture.audio.subarray(1,4));
await reopened.setEnabled(manifest.id,false);assert.equal(await(await library.handle(new Request(origin+'/assets/avatar.png'))).text(),'original');await library.close();
for(const mutate of [m=>m.variants[0].category='audio',m=>m.variants[0].files[0].target='/js/main.js',m=>m.variants[1].id=m.variants[0].id,m=>m.variants[1].group='other',m=>{m.variants[0].default=true;m.variants[1].default=true}]){const invalid=structuredClone(manifest);mutate(invalid);await assert.rejects(()=>parse(invalid));}
console.log(JSON.stringify({ok:true,checks:['v2 installs and automatically selects each default','independent visual/audio groups and selection persistence','per-group original and global disable','same-ID updates preserve choices and recover removed variants','unknown selections and changed originals skipped','audio variant HTTP MIME and Range; disable restores fallback','invalid groups, scripts, duplicates and defaults rejected']}));
