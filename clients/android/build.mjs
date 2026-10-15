import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
const originalRoot=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.SP_MOBILE_BUILD_ROOT||originalRoot, out=path.join(root,'build');
const jdk=path.join(root,'tools/jdk/jdk-21.0.12.1+1/bin'), sdk=path.join(root,'tools/build-tools/android-15');
const androidJar=path.join(root,'tools/platform/android-35/android.jar');
const appManifest=await fs.readFile(path.join(root,'android/AndroidManifest.xml'),'utf8');
const version=appManifest.match(/android:versionName="([0-9.]+)"/)?.[1];
if(!version)throw Error('Missing Android version');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(exe,args,env={}){args=args.map(a=>a.startsWith(root+path.sep)?path.relative(root,a):a);const r=spawnSync(exe,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(`${path.basename(exe)} failed: ${r.stderr||r.stdout||r.error}`);if(r.stderr?.trim())console.log(r.stderr.trim());return r.stdout;}
async function walk(dir){const all=[];for(const ent of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,ent.name);all.push(...ent.isDirectory()?await walk(f):[f]);}return all;}
for(const dir of ['assets/pack','compiled','generated','classes','dex','private','export'])await fs.mkdir(path.join(dir==='private'||dir==='export'?root:out,dir),{recursive:true});
await fs.copyFile(path.join(originalRoot,'LICENSE'),path.join(out,'assets/GPL-3.0.txt'));
await fs.copyFile(path.join(originalRoot,'THIRD-PARTY-NOTICES.txt'),path.join(out,'assets/THIRD-PARTY-NOTICES.txt'));
await fs.copyFile(path.join(originalRoot,'android/assets/servers.json'),path.join(out,'assets/servers.json'));
let packManifest=path.join(originalRoot,'resource-manifest.json');try{await fs.access(packManifest);}catch{packManifest=path.resolve(originalRoot,'../../public/data/resource-cache.json');}
const raw=await fs.readFile(packManifest,'utf8');
const manifest=JSON.parse(raw.replace(/^\uFEFF/,''));
let source=path.resolve(process.env.SP_MOBILE_RESOURCE_ROOT||path.resolve(originalRoot,'resources/public'));
try{await fs.access(source);}catch(e){if(process.env.SP_MOBILE_RESOURCE_ROOT)throw e;source=path.resolve(originalRoot,'../../server-025/public');}
// The frozen r25 manifest omits model/configuration files and its font stylesheet.
// Bind these signed additions to the known build so future versions fetch changed files.
manifest.extras=manifest.extras||{};
async function includeExtras(dir){for(const ent of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isDirectory())await includeExtras(file);else if(ent.isFile()&&/\.(obj|json)$/i.test(ent.name)){const url='/'+path.relative(source,file).split(path.sep).map(encodeURIComponent).join('/');if(!manifest.entries[url]){const bytes=await fs.readFile(file);manifest.extras[url]={hash:sha(bytes),bytes:bytes.length};manifest.entries[url]=manifest.extras[url];}}}}
await includeExtras(path.join(source,'assets/local'));
if(!manifest.entries['/fonts/fonts.css']){const bytes=await fs.readFile(path.join(source,'fonts/fonts.css'));manifest.extras['/fonts/fonts.css']={hash:sha(bytes),bytes:bytes.length};manifest.entries['/fonts/fonts.css']=manifest.extras['/fonts/fonts.css'];}
manifest.extraBuilds=manifest.extraBuilds||['8edb310885ef-1'];
manifest.count=Object.keys(manifest.entries).length;
manifest.totalBytes=Object.values(manifest.entries).reduce((sum,item)=>sum+item.bytes,0);
let count=0;
for(const [url,item] of Object.entries(manifest.entries)){
  if(!/^\/(assets|fonts)\//.test(url)||!/[a-f0-9]{64}/.test(item.hash))throw Error('Invalid pack manifest');
  const relative=decodeURIComponent(url.slice(1)), from=path.resolve(source,relative),to=path.resolve(out,'assets/pack',relative);
  if(!from.startsWith(source+path.sep)||!to.startsWith(path.resolve(out,'assets/pack')+path.sep))throw Error('Unsafe resource path');
  const bytes=await fs.readFile(from);if(bytes.length!==item.bytes||sha(bytes)!==item.hash)throw Error('Source resource differs: '+url);
  await fs.mkdir(path.dirname(to),{recursive:true});try{await fs.link(from,to);}catch(e){if(e.code==='EPERM'||e.code==='EXDEV')await fs.copyFile(from,to);else if(e.code==='EEXIST'){if(sha(await fs.readFile(to))!==item.hash){await fs.unlink(to);await fs.copyFile(from,to);}}else throw e;}
  count++;
}
await fs.writeFile(path.join(out,'assets/pack/manifest.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(root,'export/resource-manifest.json'),JSON.stringify(manifest));
console.log(`Staged ${count} full resources.`);
run(path.join(sdk,'aapt2.exe'),['compile','--dir',path.join(root,'android/res'),'-o',path.join(out,'compiled/resources.zip')]);
run(path.join(sdk,'aapt2.exe'),['link','-I',androidJar,'--manifest',path.join(root,'android/AndroidManifest.xml'),'--java',path.join(out,'generated'),'-o',path.join(out,'base.apk'),path.join(out,'compiled/resources.zip')]);
// Windows aapt2 writes backslashes into nested asset names; Android AssetManager needs forward slashes.
run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'add-assets.ps1'),'-Apk',path.join(out,'base.apk'),'-Assets',path.join(out,'assets')]);
const java=[...await walk(path.join(root,'android/src')),...await walk(path.join(out,'generated'))].filter(f=>f.endsWith('.java'));
run(path.join(jdk,'javac.exe'),['-encoding','UTF-8','-source','8','-target','8','-classpath',androidJar,'-d',path.join(out,'classes'),...java]);
run(path.join(jdk,'java.exe'),['-cp',path.join(sdk,'lib/d8.jar'),'com.android.tools.r8.D8','--lib',androidJar,'--min-api','26','--output',path.join(out,'dex'),...await walk(path.join(out,'classes'))]);
run(path.join(jdk,'jar.exe'),['uf',path.join(out,'base.apk'),'-C',path.join(out,'dex'),'classes.dex']);
run(path.join(sdk,'zipalign.exe'),['-p','-f','4',path.join(out,'base.apk'),path.join(out,'aligned.apk')]);
const privateRoot=path.resolve(process.env.SP_MOBILE_SIGNING_ROOT||path.join(root,'private'));
const privatePath=path.join(privateRoot,'signing.json'),keystore=path.join(privateRoot,'release.p12');
let signing;try{signing=JSON.parse(await fs.readFile(privatePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;signing={password:randomBytes(32).toString('base64url')};await fs.writeFile(privatePath,JSON.stringify(signing),{flag:'wx'});}
const env={SP_APK_PASSWORD:signing.password};
try{await fs.access(keystore);}catch{
 run(path.join(jdk,'keytool.exe'),['-genkeypair','-keystore',keystore,'-storetype','PKCS12','-storepass:env','SP_APK_PASSWORD','-keypass:env','SP_APK_PASSWORD','-alias','weishu-release','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Stronghold Protocol Community, O=8443 Server, C=CN'],env);
}
const apk=path.join(root,`export/卫戍协议-安卓完整版-v${version}.apk`);
run(path.join(jdk,'java.exe'),['-jar',path.join(sdk,'lib/apksigner.jar'),'sign','--ks',keystore,'--ks-key-alias','weishu-release','--ks-pass','env:SP_APK_PASSWORD','--key-pass','env:SP_APK_PASSWORD','--out',apk,path.join(out,'aligned.apk')],env);
const verification=run(path.join(jdk,'java.exe'),['-jar',path.join(sdk,'lib/apksigner.jar'),'verify','--verbose','--print-certs',apk]);
const info={ok:true,version,apk,files:count,extras:Object.keys(manifest.extras).length,bytes:(await fs.stat(apk)).size,sha256:sha(await fs.readFile(apk)),verification};
await fs.writeFile(path.join(root,'export/apk-build.json'),JSON.stringify(info,null,2));console.log(JSON.stringify({...info,verification:'signature verified'}));
