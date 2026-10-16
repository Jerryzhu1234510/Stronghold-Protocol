'use strict';
const {app}=require('electron');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../../private-native-030'));
app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.whenReady().then(async()=>{
 let client;const report={errors:[]};
 const {ResourceLibrary}=require('../clients/desktop/resources.cjs'),handle=ResourceLibrary.prototype.handle;
 report.missing=[];ResourceLibrary.prototype.handle=async function(request,...args){const before=this.metrics.updates;const response=await handle.call(this,request,...args);if(this.metrics.updates>before)report.missing.push(request.url);return response;};
 try{
  const version=require('../clients/desktop/package.json').version;
  client=await require('../clients/desktop/client.cjs').startClient({origin:'http://127.0.0.1:27630',home:'/',show:false,test:true,
   serversOverride:[{id:'local030',name:'0.3.0本地兼容测试',url:'http://127.0.0.1:27630/'}],
   pack:path.resolve(__dirname,'../clients/desktop/export/卫戍协议-PC内置资源版-v'+version+'/resources/pack')});
  const web=client.win.webContents;web.on('console-message',(_e,level,message)=>{if(level===3)report.errors.push(message);});
  // Empty Mod directories intentionally do not install a music observer.
  await web.executeJavaScript(require('../clients/desktop/music-events.cjs').musicBootstrap({tracks:[],sessionTrack:{id:'qa',name:'QA only',url:'/media/qa-never-played.wav',volume:0.1,startSeconds:0}}));
  await new Promise(r=>setTimeout(r,4000));
  report.page=await web.executeJavaScript(`({body:document.body.innerText.slice(0,1200),bridge:typeof SPAndroidResources?.getManifest==='function',music:!!globalThis.__SPDesktopMusic,motion:!!globalThis.__SPDesktopUnitMotion})`);
  assert.ok(report.page.bridge);assert.ok(report.page.music);assert.ok(report.page.motion);assert.ok(report.page.body.includes('STRONGHOLD PROTOCOL'));
  await web.executeJavaScript(`(async()=>{const r=await fetch('/data/assets.json');const m=await r.json();const find=x=>typeof x==='string'&&x.startsWith('/assets/')?x:x&&typeof x==='object'?Object.values(x).map(find).find(Boolean):null;const u=find(m);const image=await fetch(u);return image.arrayBuffer();})()`);
  const until=async expression=>{const deadline=Date.now()+90000;while(Date.now()<deadline){if(await web.executeJavaScript(expression))return;await new Promise(r=>setTimeout(r,250));}throw Error('Native game did not reach '+expression);};
  await web.executeJavaScript(`(async()=>{const {register}=await import('/_build/'+window.__SP_GENERATION+'/js/account.js');await register({username:'pc030_'+Date.now(),password:'Local-test-only-030!',nickname:'PC内置资源验收'});})()`);
  const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
  await until('!!window.__SP__');
  await web.executeJavaScript(`(()=>{for(const b of document.querySelectorAll('button'))if(b.textContent.trim()==='我知道了')b.click();const enter=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='进入大厅');enter?.click();})()`);
  await until("document.body.innerText.includes('创建同盟')");
  await web.executeJavaScript(`(async()=>{const {net}=window.__SP__;await net.request('room.create',{mode:'coop',difficulty:'NORMAL',capacity:4});for(let i=0;i<3;i++)await net.request('room.addBot',{});await net.request('room.start',{});})()`);
  await until("window.__SP__.store.get().match.public?.phase==='INFO_CHECK'");
  await web.executeJavaScript(`(async()=>{const {net,store}=window.__SP__;await net.request('g.infoReady',{setupRevision:store.get().match.public.setupRevision??0});await net.request('g.autoplay',{on:true});})()`);
  await until("window.__SP_VIEW__?.kind==='engine' && window.__SP__.store.get().match.public?.round>=2");
  report.play=await web.executeJavaScript(`({renderer:window.__SP_VIEW__?.kind,round:window.__SP__.store.get().match.public?.round})`);
  await web.executeJavaScript("window.__SP__.net.request('room.leave',{})");
  report.resources=client.library.status();assert.ok(report.resources.hits>0);assert.equal(report.resources.updates,0);assert.deepEqual(report.errors,[]);
  const shot=await web.capturePage();await fs.writeFile(path.resolve(__dirname,'../../qa-native030.png'),shot.toPNG());report.ok=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{await fs.writeFile(path.resolve(__dirname,'../../qa-native030.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));client?.win.destroy();app.exit(report.ok?0:1);}
});
