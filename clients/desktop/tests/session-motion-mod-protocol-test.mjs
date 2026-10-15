import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{parseMod,ModManager}=require('../mods.cjs'),{pack}=require('../mod-tool.cjs');
const parent=new URL('../test-output/',import.meta.url);await fs.mkdir(parent,{recursive:true});
const root=await fs.mkdtemp(new URL('../test-output/session-motion-protocol-',import.meta.url));
const input=path.join(root,'input');await fs.mkdir(path.join(input,'audio'),{recursive:true});
const audio=Buffer.alloc(844,128);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
await fs.writeFile(path.join(input,'audio/music.wav'),audio);
const base={format:4,id:'format-four-a',name:'常驻音乐与视觉动作',version:'1.0.0',server:'8443',sessionMusic:{path:'audio/music.wav'},motion:{target:'own'}};
async function parse(manifest){await fs.writeFile(path.join(input,'mod.json'),JSON.stringify(manifest));return parseMod(await pack(input));}
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const parsed=await parse(base);eq(parsed.manifest.files,[]);eq(parsed.manifest.events,[]);
eq(Object.fromEntries(['path','volume','startSeconds'].map(k=>[k,parsed.manifest.sessionMusic[k]])),{path:'audio/music.wav',volume:0.8,startSeconds:0});
eq(parsed.manifest.motion,{target:'own',bounceHeight:0.2,bounceHz:1,spinRps:0.5,flipX:false,flipY:false});eq(parsed.payload.size,1);
const onlySession=structuredClone(base);delete onlySession.motion;eq((await parse(onlySession)).manifest.sessionMusic.volume,0.8);
const onlyMotion=structuredClone(base);delete onlyMotion.sessionMusic;const motionParsed=await parse(onlyMotion);eq(motionParsed.payload.size,0);eq(motionParsed.manifest.motion.target,'own');
const motionOnlyFolder=path.join(root,'motion-only');await fs.mkdir(motionOnlyFolder);await fs.writeFile(path.join(motionOnlyFolder,'mod.json'),JSON.stringify(onlyMotion));eq(parseMod(await pack(motionOnlyFolder)).payload.size,0,'motion-only ZIP requires no dummy audio');

const shared=structuredClone(base);shared.events=[{event:'match-start',path:'audio/music.wav'}];eq((await parse(shared)).payload.size,1,'session and event share one content-addressed payload');
const mods=await new ModManager(path.join(root,'mods')).initialize();await mods.install(await parse(shared));
const first=mods.sessionTrack();eq(first.id,base.id);eq(first.volume,0.8);eq((await mods.eventAsset(first.url)).bytes,audio);eq(mods.motionConfig().target,'own');
const other=structuredClone(shared);other.id='format-four-b';other.sessionMusic.volume=0.5;other.motion={target:'allies',bounceHeight:0,spinRps:-2,bounceHz:4};await mods.install(await parse(other));
eq(mods.sessionTrack().id,other.id);eq(mods.motionConfig().id,other.id);eq(mods.eventTracks()[0].id,other.id);eq(await mods.eventAsset(first.url),null,'superseded session route is unavailable');
await mods.setEnabled(base.id,false);await mods.setEnabled(base.id,true);
eq(mods.sessionTrack().id,base.id,'last enabled session wins');eq(mods.motionConfig().id,base.id,'motion has one global winner, no target merging');eq(mods.eventTracks()[0].id,other.id,'existing event priority stays installation-based');
let reopened=await new ModManager(path.join(root,'mods')).initialize();eq(reopened.sessionTrack().id,base.id,'activation priority survives restart');eq(reopened.motionConfig().id,base.id);eq((await reopened.eventAsset(reopened.sessionTrack().url)).bytes,audio);
await reopened.setEnabled(base.id,false);eq(reopened.sessionTrack().id,other.id);eq(reopened.motionConfig().id,other.id);
await reopened.setEnabled(other.id,false);eq(reopened.sessionTrack(),null);eq(reopened.motionConfig(),null);eq(await reopened.eventAsset(first.url),null);
await reopened.setEnabled(base.id,true);
const track=reopened.sessionTrack(),folder=reopened.records.find(r=>r.manifest.id===base.id).folder;
await fs.writeFile(path.join(root,'mods',folder,track.hash+'.bin'),'corrupt');eq(await reopened.eventAsset(track.url),null,'damaged local session audio fails integrity verification');
await fs.writeFile(path.join(root,'mods',folder,track.hash+'.bin'),audio);eq((await reopened.eventAsset(track.url)).bytes,audio);

for(const motion of [{target:'own',bounceHeight:0,spinRps:2,bounceHz:0.1},{target:'allies',bounceHeight:0.75,spinRps:0,bounceHz:4}])eq((await parse({...base,motion})).manifest.motion,{...motion,flipX:false,flipY:false});
for(const key of ['flipX','flipY']){const motion={target:'own',bounceHeight:0,spinRps:0,[key]:true};const value=(await parse({...base,motion})).manifest.motion;eq(value[key],true);eq(value[key==='flipX'?'flipY':'flipX'],false);}
const combined={target:'allies',bounceHeight:0.3,bounceHz:1,spinRps:1,flipX:true,flipY:true};eq((await parse({...base,motion:combined})).manifest.motion,combined,'bounce, synchronized spin and both static flips can coexist');
const boundary=structuredClone(base);boundary.sessionMusic.volume=0;boundary.sessionMusic.startSeconds=3600;eq((await parse(boundary)).manifest.sessionMusic.startSeconds,3600);
const invalid=[
 ['legacy format with new fields',m=>m.format=3],['unknown root field',m=>m.script='alert(1)'],
 ['null session',m=>m.sessionMusic=null],['array session',m=>m.sessionMusic=[]],['unknown session field',m=>m.sessionMusic.loop=true],
 ['session hash injection',m=>m.sessionMusic.hash='0'.repeat(64)],['remote session path',m=>m.sessionMusic.path='https://example.com/music.wav'],
 ['absolute session path',m=>m.sessionMusic.path='/audio/music.wav'],['Windows session path',m=>m.sessionMusic.path='C:/music.wav'],
 ['traversal session path',m=>m.sessionMusic.path='../music.wav'],['backslash session path',m=>m.sessionMusic.path='audio\\music.wav'],
 ['NUL session path',m=>m.sessionMusic.path='audio/music\0.wav'],['script session path',m=>m.sessionMusic.path='audio/music.js'],
 ['missing session audio',m=>m.sessionMusic.path='audio/absent.wav'],
 ...['volume','startSeconds'].flatMap(k=>[[k+' null',m=>m.sessionMusic[k]=null],[k+' string',m=>m.sessionMusic[k]='1'],[k+' negative',m=>m.sessionMusic[k]=-1],[k+' too large',m=>m.sessionMusic[k]=k==='volume'?1.1:3600.1]]),
 ['null motion',m=>m.motion=null],['array motion',m=>m.motion=[]],['motion code',m=>m.motion.script='alert(1)'],
 ['unknown target',m=>m.motion.target='enemies'],['missing target',m=>delete m.motion.target],['inert motion',m=>{m.motion.bounceHeight=0;m.motion.spinRps=0;}],
 ...['bounceHeight','bounceHz','spinRps'].flatMap(k=>[[k+' null',m=>m.motion[k]=null],[k+' string',m=>m.motion[k]='1'],[k+' too large',m=>m.motion[k]=k==='bounceHeight'?0.751:k==='bounceHz'?4.1:2.1]]),
 ['negative height',m=>m.motion.bounceHeight=-0.1],['too-slow bounce',m=>m.motion.bounceHz=0.09],['too-fast negative rotation',m=>m.motion.spinRps=-2.1],
 ...['flipX','flipY'].flatMap(k=>[[k+' null',m=>m.motion[k]=null],[k+' number',m=>m.motion[k]=1],[k+' string',m=>m.motion[k]='true']]),
 ['motion expression',m=>m.motion.condition='hp < 5'],['empty v4',m=>{delete m.sessionMusic;delete m.motion;}],
 ['duplicate v4 events',m=>m.events=[{event:'match-start',path:'audio/music.wav'},{event:'match-start',path:'audio/music.wav'}]]
];
for(const [name,mutate] of invalid){const m=structuredClone(base);mutate(m);await assert.rejects(()=>parse(m),name);checks++;}

const savedPath=path.join(root,'mods',folder,'mod.json'),saved=JSON.parse(await fs.readFile(savedPath,'utf8'));
for(const mutate of [
 m=>m.sessionMusic.hash='invalid',m=>m.sessionMusic.hash=[m.sessionMusic.hash],m=>m.sessionMusic.bytes=0,m=>m.sessionMusic.path='../music.wav',m=>m.sessionMusic.script='alert(1)',
 m=>m.motion.target='enemy',m=>m.motion.bounceHz=5,m=>m.motion.script='alert(1)',m=>m.motion.flipX='true',m=>m.motion.flipY=null,m=>m.format=3,m=>m.script='alert(1)'
]){
 const m=structuredClone(saved);mutate(m);await fs.writeFile(savedPath,JSON.stringify(m));
 const restored=await new ModManager(path.join(root,'mods')).initialize();eq(restored.records.some(r=>r.manifest.id===base.id),false,'invalid stored format4 is skipped');
}
await fs.writeFile(savedPath,JSON.stringify(saved));
const oldMotion=structuredClone(saved);delete oldMotion.motion.flipX;delete oldMotion.motion.flipY;await fs.writeFile(savedPath,JSON.stringify(oldMotion));
const oldRestored=await new ModManager(path.join(root,'mods')).initialize();eq(oldRestored.motionConfig().flipX,false);eq(oldRestored.motionConfig().flipY,false);await fs.writeFile(savedPath,JSON.stringify(saved));
const legacy={format:1,id:'legacy-static',name:'legacy',version:'1',server:'8443',files:[{target:'/assets/music.wav',originalSha256:'0'.repeat(64),path:'audio/music.wav'}]};
for(const format of [1,2]){await reopened.install(await parse({...legacy,format,id:'legacy-'+format}));checks++;}
await reopened.install(await parse({format:3,id:'legacy-events',name:'legacy',version:'1',server:'8443',events:[{event:'teammate-zero-lp',path:'audio/music.wav'}]}));
const final=await new ModManager(path.join(root,'mods')).initialize();eq(final.records.length,5);eq(final.eventTracks().find(e=>e.id==='legacy-events').includeSelf,false);
const archive=path.join(root,'format4.zip');await fs.writeFile(archive,await pack(motionOnlyFolder));
const validation=parseMod(await fs.readFile(archive)).manifest;eq(validation.format,4);eq(!!validation.motion,true);eq(!!validation.sessionMusic,false);
console.log(JSON.stringify({ok:true,checks,invalidInputs:invalid.length,fixtureBytes:audio.length,semantics:'format4 session/motion; strict safe fields; local audio integrity; persisted activation priority; legacy event/static priority unchanged'}));
