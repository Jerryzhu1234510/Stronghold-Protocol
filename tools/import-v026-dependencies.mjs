import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const importFile = path => {
  const local = resolve(root,path), backup=resolve(root,'.cache/v026-integration/before',path);
  if (!existsSync(backup)) {mkdirSync(dirname(backup),{recursive:true});copyFileSync(local,backup);}
  copyFileSync(resolve(root,'.cache/upstream-v026',path),local);
};
// The clip-bounds and optional HUD readouts need the pre-0.2.6 helpers missing from our compatibility branch.
importFile('public/js/render/spine.js');
importFile('public/js/render/interp.js');
const snap='server/sim/snapshot.js';
const dest=resolve(root,snap), backup=resolve(root,'.cache/v026-integration/before',snap);
if(!existsSync(backup)){mkdirSync(dirname(backup),{recursive:true});copyFileSync(dest,backup);}
const text=readFileSync(resolve(root,'.cache/upstream-v026',snap),'utf8');
const start=text.indexOf('export function ammoView('), end=text.indexOf('/** Units included in a snapshot:',start);
if(start<0||end<0)throw new Error('missing HUD helpers');
writeFileSync(dest,readFileSync(dest,'utf8')+'\n'+text.slice(start,end));
