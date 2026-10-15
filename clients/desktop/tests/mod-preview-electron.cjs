'use strict';
// Run this file with the bundled Electron runtime, not node. Synthetic profile only.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const base=path.resolve(__dirname,'..'),out=path.join(base,'test-output','preview-electron');
const {ModManager,parseMod}=require('../mods.cjs'),{pack}=require('../mod-tool.cjs'),{digest}=require('../resources.cjs'),{ModPreviewLibrary,isPreviewSender,EVENT_LABELS}=require('../mod-preview.cjs');
app.disableHardwareAcceleration();app.setPath('userData',path.join(out,'profile'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 let win;
 try{
  await fs.mkdir(out,{recursive:true});const input=path.join(out,'input');await fs.mkdir(input,{recursive:true});
  const image=await fs.readFile(path.resolve(base,'../../public/assets/char/portrait/char_003_kalts_1.png'));
  const wav=Buffer.alloc(44+16000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<16000;i++)wav.writeInt16LE(Math.round(Math.sin(i/16000*440*Math.PI*2)*200),44+i*2);
  await fs.writeFile(path.join(input,'portrait.png'),image);await fs.writeFile(path.join(input,'tone.wav'),wav);
  const target='/assets/char/portrait/char_003_kalts_1.png',manifest={format:4,id:'preview-native-test',name:'预览室验收包',version:'1',server:'8443',files:[{target,path:'portrait.png',originalSha256:digest(image)}],events:Object.keys(EVENT_LABELS).map(event=>({event,path:'tone.wav',volume:.1})),sessionMusic:{path:'tone.wav',volume:.1},motion:{target:'own',bounceHeight:.3,bounceHz:1,spinRps:1,flipX:true,flipY:true}};
  await fs.writeFile(path.join(input,'mod.json'),JSON.stringify(manifest));const mods=await new ModManager(path.join(out,'mods')).initialize();await mods.install(parseMod(await pack(input)));
  const original={hash:digest(image),bytes:image.length};const library={index:{entries:{[original.hash]:original}},verifiedBody:async()=>image};const preview=new ModPreviewLibrary({mods,library,baseline:{entries:{[target]:original}}});
  const url=pathToFileURL(path.join(base,'mod-preview.html')).href;
  win=new BrowserWindow({width:1180,height:900,show:false,webPreferences:{preload:path.join(base,'preload.cjs'),additionalArguments:['--sp-mod-preview'],sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  ipcMain.handle('sp:mod-preview-catalog',e=>{assert.ok(isPreviewSender(e,win,url));return preview.catalog();});ipcMain.handle('sp:mod-preview-asset',(e,id,original)=>{assert.ok(isPreviewSender(e,win,url));return preview.asset(id,original);});
  const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadURL(url);
  const js=source=>win.webContents.executeJavaScript(source,true);
  for(let i=0;i<30;i++){if(await js("document.querySelector('#sprite').naturalWidth>0 && document.querySelectorAll('#events button').length===20"))break;await delay(100);}
  assert.equal(await js("document.querySelectorAll('#events button').length"),20);assert.equal(await js("document.querySelectorAll('#events button:disabled').length"),0);assert.equal(await js("document.querySelector('#sprite').naturalWidth>0"),true);assert.ok(['-1','-1 -1'].includes(await js("document.querySelector('#sprite').style.scale")));assert.equal(await js("document.querySelector('#sprite').getAnimations().length"),2);
  await js("window.__qaAudio=[];window.__qaOriginalAudio=Audio;window.Audio=function(...args){const a=new window.__qaOriginalAudio(...args);window.__qaAudio.push(a);return a;};document.querySelector('#session-play').click();");
  await delay(350);assert.equal(await js("__qaAudio.some(a=>a.loop&&!a.paused)"),true,'real BGM audio loops');
  await js("[...document.querySelectorAll('#events button')].find(b=>b.textContent.includes('boss-start')).click();");await delay(250);assert.equal(await js("__qaAudio.some(a=>!a.loop&&!a.paused)"),true,'real event audio plays');assert.equal(await js("__qaAudio.filter(a=>a.loop).every(a=>a.paused)"),true,'event pauses BGM');
  await delay(1100);assert.equal(await js("__qaAudio.some(a=>a.loop&&!a.paused)"),true,'BGM resumes after event');
  await js("document.querySelector('#volume').value='0';document.querySelector('#volume').dispatchEvent(new Event('input'));");assert.equal(await js("__qaAudio.every(a=>a.paused||a.volume===0)"),true);
  await js("document.querySelector('#stop-all').click();");assert.equal(await js("__qaAudio.every(a=>a.paused)"),true);assert.equal(await js("document.querySelector('#sprite').getAnimations().length"),0);assert.equal(await js("document.querySelector('#sprite').style.scale"),'');
  await js("document.querySelector('#motion').checked=true;document.querySelector('#motion').dispatchEvent(new Event('change'));");await delay(100);
  assert.equal(await js("(()=>{__SPDesktopUnitMotion.configure({motion:{target:'own',bounceHeight:.75,bounceHz:4,spinRps:2,flipX:true,flipY:true}});const sprite=document.querySelector('#sprite'),stage=document.querySelector('.stage'),a=sprite.getAnimations();a.forEach(x=>x.pause());for(let b=0;b<=4;b++)for(let r=0;r<16;r++){a[0].currentTime=b/4*250;a[1].currentTime=r/16*500;const s=sprite.getBoundingClientRect(),p=stage.getBoundingClientRect();if(s.top<p.top||s.bottom>p.bottom||s.left<p.left||s.right>p.right)return false;}return true;})()"),true,'maximum legal bounce/spin/flip stays inside preview stage');
  win.setSize(760,850);await delay(250);assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"),true,'narrow window has no horizontal overflow');
  assert.equal(errors.filter(s=>!/Electron Security Warning/.test(s)).length,0,JSON.stringify(errors));
  const result={ok:true,checks:['native Electron sandbox/preload IPC','20 event controls use installed audio','actual local portrait decoded','real 2D unit motion bounce/spin/flip composed','real looping audio interrupted and resumed by event','volume/stop release media and restore art','760px responsive window no horizontal overflow']};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));win.destroy();app.quit();
 }catch(error){console.error(error.stack);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}
});
