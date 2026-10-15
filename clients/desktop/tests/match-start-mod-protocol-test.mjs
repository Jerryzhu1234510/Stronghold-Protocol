import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {ModManager,parseMod}=require('../mods.cjs');
const {pack}=require('../mod-tool.cjs');
await fs.mkdir(new URL('../test-output/',import.meta.url),{recursive:true});
const root=await fs.mkdtemp(new URL('../test-output/match-start-protocol-',import.meta.url));
const input=path.join(root,'input');
await fs.mkdir(path.join(input,'audio'),{recursive:true});
// A valid 100 ms, 8-bit mono PCM WAV, generated locally instead of shipping a song fixture.
const audio=Buffer.alloc(844,128);
audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);
audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
await fs.writeFile(path.join(input,'audio','start.wav'),audio);
const base={format:3,id:'test-match-start',name:'新对局音乐测试',version:'1.0.0',server:'8443',files:[],events:[{event:'match-start',path:'audio/start.wav'}]};
async function parse(manifest){await fs.writeFile(path.join(input,'mod.json'),JSON.stringify(manifest));return parseMod(await pack(input));}
const parsed=await parse(base);
assert.equal(parsed.manifest.events.length,1);
assert.deepEqual(Object.fromEntries(['event','path','volume','startSeconds','includeBots','includeSelf'].map(k=>[k,parsed.manifest.events[0][k]])),{event:'match-start',path:'audio/start.wav',volume:0.8,startSeconds:0,includeBots:true,includeSelf:false});
const mods=await new ModManager(path.join(root,'mods')).initialize();
await mods.install(parsed);
let tracks=mods.eventTracks();assert.equal(tracks.length,1);assert.equal(tracks[0].event,'match-start');
assert.deepEqual((await mods.eventAsset(tracks[0].url)).bytes,audio);
let reopened=await new ModManager(path.join(root,'mods')).initialize();
assert.equal(reopened.eventTracks()[0].event,'match-start');
await reopened.setEnabled(base.id,false);assert.equal(reopened.eventTracks().length,0);assert.equal(await reopened.eventAsset(tracks[0].url),null);
await reopened.setEnabled(base.id,true);

// Both controlled event types coexist; priority is per event rather than global.
const old=structuredClone(base);old.id='test-lp-legacy';old.events[0].event='teammate-zero-lp';
await reopened.install(await parse(old));
assert.deepEqual(reopened.eventTracks().map(e=>e.event).sort(),['match-start','teammate-zero-lp']);
const legacyRecord=reopened.records.find(r=>r.manifest.id===old.id);
const legacyPath=path.join(root,'mods',legacyRecord.folder,'mod.json');
const legacy=JSON.parse(await fs.readFile(legacyPath,'utf8'));delete legacy.events[0].includeSelf;
await fs.writeFile(legacyPath,JSON.stringify(legacy));
reopened=await new ModManager(path.join(root,'mods')).initialize();
assert.equal(reopened.eventTracks().find(e=>e.event==='teammate-zero-lp').includeSelf,false);

const names=['match-start','round-start','combat-start','boss-start','unite-start','prep-start','round-end','round-win','round-loss','match-win','match-loss','match-end','low-lp','self-zero-lp','teammate-zero-lp','core-alliance-6-combat-start','core-alliance-9-combat-start','siracusa-true-damage','kjerag-operator-freeze','kjerag-alliance-freeze'];
const all=structuredClone(base);all.id='test-all-events';all.events=names.map(event=>({event,path:'audio/start.wav'}));
const allParsed=await parse(all);
assert.deepEqual(allParsed.manifest.events.map(e=>e.event),names);
assert.equal(allParsed.manifest.events.find(e=>e.event==='low-lp').threshold,5);
assert.ok(allParsed.manifest.events.filter(e=>e.event!=='low-lp').every(e=>!Object.hasOwn(e,'threshold')));
assert.equal(allParsed.payload.size,1,'shared local audio is stored once');
await reopened.install(allParsed);
reopened=await new ModManager(path.join(root,'mods')).initialize();
assert.deepEqual(reopened.eventTracks().map(e=>e.event),names,'all controlled events survive registry restoration');
assert.ok(reopened.eventTracks().every(e=>e.id===all.id),'later package wins independently for each event');
for(const threshold of [1,999]){const candidate=structuredClone(base);candidate.events[0].event='low-lp';candidate.events[0].threshold=threshold;assert.equal((await parse(candidate)).manifest.events[0].threshold,threshold);}

const legacyStatic=structuredClone(base);delete legacyStatic.events;legacyStatic.files=[{target:'/assets/test.wav',originalSha256:'0'.repeat(64),path:'audio/start.wav'}];
for(const format of [1,2]){legacyStatic.format=format;assert.equal((await parse(legacyStatic)).manifest.format,format);}

const explicit=structuredClone(base);Object.assign(explicit.events[0],{volume:0,startSeconds:3600,includeBots:false,includeSelf:true});
const boundary=(await parse(explicit)).manifest.events[0];assert.equal(boundary.volume,0);assert.equal(boundary.startSeconds,3600);assert.equal(boundary.includeBots,false);assert.equal(boundary.includeSelf,true);
const invalid=[
  ['format 2',m=>m.format=2],['duplicate event',m=>m.events.push({...m.events[0]})],
  ['more than 32 events',m=>m.events=Array.from({length:33},()=>({...m.events[0]}))],
  ['unknown event',m=>m.events[0].event='run-script'],['script event field',m=>m.events[0].script='alert(1)'],
  ['persisted hash in input',m=>m.events[0].hash='0'.repeat(64)],
  ['external URL',m=>m.events[0].path='https://example.com/start.wav'],
  ['absolute path',m=>m.events[0].path='/audio/start.wav'],['Windows path',m=>m.events[0].path='C:/start.wav'],
  ['backslash',m=>m.events[0].path='audio\\start.wav'],['parent traversal',m=>m.events[0].path='../start.wav'],
  ['NUL path',m=>m.events[0].path='audio/start\0.wav'],['script path',m=>m.events[0].path='audio/start.js'],
  ['missing file',m=>m.events[0].path='audio/missing.wav'],
  ...['volume','startSeconds'].flatMap(field=>[
    [field+' string',m=>m.events[0][field]='1'],[field+' null',m=>m.events[0][field]=null],
    [field+' negative',m=>m.events[0][field]=-1],
    [field+' upper bound',m=>m.events[0][field]=field==='volume'?1.1:3600.1]
  ]),
  ...['includeBots','includeSelf'].flatMap(field=>[[field+' string',m=>m.events[0][field]='true'],[field+' null',m=>m.events[0][field]=null]]),
  ['threshold on other event',m=>m.events[0].threshold=5],
  ['custom siracusa cooldown',m=>{m.events[0].event='siracusa-true-damage';m.events[0].cooldownSeconds=0;}],
  ...[0,1000,5.5,'5',null,false].map(value=>['invalid low-lp threshold '+JSON.stringify(value),m=>{m.events[0].event='low-lp';m.events[0].threshold=value;}])
];
for(const [name,mutate] of invalid){const candidate=structuredClone(base);mutate(candidate);await assert.rejects(()=>parse(candidate),name);}

// A manually edited registry cannot introduce unknown triggers or executable fields.
const record=reopened.records.find(r=>r.manifest.id===base.id),manifestPath=path.join(root,'mods',record.folder,'mod.json');
const stored=JSON.parse(await fs.readFile(manifestPath,'utf8'));
for(const mutate of [m=>m.events[0].event='run-script',m=>m.events[0].script='alert(1)',m=>m.events[0].path='../start.wav',m=>m.events[0].includeBots='true']){
 const candidate=structuredClone(stored);mutate(candidate);await fs.writeFile(manifestPath,JSON.stringify(candidate));
 const restored=await new ModManager(path.join(root,'mods')).initialize();assert.ok(!restored.records.some(r=>r.manifest.id===base.id));assert.ok(restored.records.some(r=>r.manifest.id===old.id));
}
await fs.writeFile(manifestPath,JSON.stringify(stored));

const allRecord=reopened.records.find(r=>r.manifest.id===all.id),allPath=path.join(root,'mods',allRecord.folder,'mod.json');
const allStored=JSON.parse(await fs.readFile(allPath,'utf8'));
for(const mutate of [
 m=>m.events.push({...m.events[0]}),m=>m.events=Array.from({length:33},()=>({...m.events[0]})),
 m=>m.events[0].threshold=5,m=>m.events.find(e=>e.event==='low-lp').threshold=0,
 m=>m.events.find(e=>e.event==='low-lp').threshold=null
]){
 const candidate=structuredClone(allStored);mutate(candidate);await fs.writeFile(allPath,JSON.stringify(candidate));
 const restored=await new ModManager(path.join(root,'mods')).initialize();assert.ok(!restored.records.some(r=>r.manifest.id===all.id));
}
const optionalStored=structuredClone(allStored);delete optionalStored.events.find(e=>e.event==='low-lp').threshold;
await fs.writeFile(allPath,JSON.stringify(optionalStored));
const defaulted=await new ModManager(path.join(root,'mods')).initialize();assert.equal(defaulted.eventTracks().find(e=>e.event==='low-lp').threshold,5);
await fs.writeFile(allPath,JSON.stringify(allStored));
console.log(JSON.stringify({ok:true,checks:['all 20 controlled events parse and persist in one format 3 package','local event audio round trip, enable/disable and shared payload deduplication','legacy format 1/2 and LP event with absent includeSelf remain compatible','per-event coexistence, priority and numeric boundaries','low-lp threshold defaults, bounds and event-specific schema','duplicate events, more than 32 entries, custom cooldowns and unsafe inputs rejected','corrupt, duplicated or extended stored events skipped'],eventTypes:names.length,invalidInputs:invalid.length,fixtureBytes:audio.length}));
