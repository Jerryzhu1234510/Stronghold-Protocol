'use strict';
const {app,BrowserWindow,session,ipcMain,Menu,dialog,shell}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const {ResourceLibrary,mime,rangeFor}=require('./resources.cjs');
const {ModManager,parseMod}=require('./mods.cjs');
const {musicBootstrap}=require('./music-events.cjs');
const {PatchManager}=require('./patches.cjs');
const {version:clientVersion}=require('./package.json');
const {transformResponse:observeSimResponse}=require('./sim-music-observer.cjs');
const {motionBootstrap}=require('./unit-motion.cjs');
const {transformResponse:observeMotionResponse}=require('./unit-motion-observer.cjs');
const {prepareProgramCache}=require('./program-cache.cjs');
const {ModPreviewLibrary,isPreviewSender}=require('./mod-preview.cjs');
async function startClient({origin='https://weishuxieyiwangye.cn:8443',pack=path.join(process.resourcesPath,'pack'),show=true,home=null,test=false,serversOverride=null}={}){
  const ses=session.defaultSession;
  await prepareProgramCache(ses,app.getPath('userData'),clientVersion);
  const registry=JSON.parse(fs.readFileSync(path.join(__dirname,'servers.json'),'utf8'));
  if(registry.version!==1||!Array.isArray(registry.servers)||registry.servers.length>30)throw Error('服务器列表配置无效');
  const servers=(serversOverride||registry.servers).map(s=>{const u=new URL(s.url);if((u.protocol!=='https:'&&!(serversOverride&&u.origin==='http://127.0.0.1:27627'))||u.username||u.password||!s.name||s.name.length>40)throw Error('服务器网址配置无效');return {id:s.id,name:s.name,url:u.href,badge:s.badge||'社区服务器',description:s.description||''}});
  const allowed=new Set([origin,...servers.map(s=>new URL(s.url).origin)]);
  const trainingOrigin='http://127.0.0.1:27627';
  const observerRequest=request=>new URL(request.url).origin===trainingOrigin?new Request('https://weishuxieyiwangye.cn:8443'+new URL(request.url).pathname,{method:request.method,headers:request.headers}):request;
  const remote=async request=>{
    let source=request.initiatorOrigin;try{if(!source&&request.referrer)source=new URL(request.referrer).origin}catch{}
    const same=!source||source===new URL(request.url).origin;
    const credentials=same&&request.credentials!=='omit'?'include':'omit';
    const requestHeaders=new Headers(request.headers);requestHeaders.delete('if-none-match');requestHeaders.delete('if-modified-since');
    // Main-process fetch does not infer the renderer's Origin for POST requests.
    // Preserve it explicitly so the server can enforce same-origin resource entry.
    if(!['GET','HEAD'].includes(request.method)&&same)requestHeaders.set('Origin',source||new URL(request.url).origin);
    const response=await ses.fetch(new Request(request,{headers:requestHeaders}),{bypassCustomProtocolHandlers:true,credentials});
    // A fresh response avoids reusing a completed network loader after server redirects.
    // Chromium already decoded the network stream, so encoded lengths must be removed.
    const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');headers.delete('transfer-encoding');
    return new Response(response.body,{status:response.status,headers});
  };
  const mods=await new ModManager(path.join(app.getPath('userData'),'mods')).initialize();
  const patches=await new PatchManager(path.join(app.getPath('userData'),'resource-patches')).initialize();
  await patches.addBundledPack(path.join(path.dirname(pack),'patch-core-025'));
  const library=await new ResourceLibrary({directory:pack,origin,remote,mods,patches}).initialize();
  const libraries=new Map([[origin,library]]);
  for(const server of servers){const peer=new URL(server.url).origin;if(peer!==origin&&!libraries.has(peer))libraries.set(peer,await new ResourceLibrary({directory:pack,origin:peer,remote,patches}).initialize());}
  if(!libraries.has(trainingOrigin))libraries.set(trainingOrigin,await new ResourceLibrary({directory:pack,origin:trainingOrigin,remote,mods,patches}).initialize());
  const handleRequest=async request=>{
    const url=new URL(request.url);
    const modPath=url.pathname.replace(/^\/_build\/[A-Za-z0-9_-]{1,80}(\/__sp_desktop_mods\/)/,'$1');
    if([origin,trainingOrigin].includes(url.origin)&&modPath.startsWith('/__sp_desktop_mods/')){
      if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
      const asset=await mods.eventAsset(modPath);if(!asset)return new Response(null,{status:404});
      const range=rangeFor(request.headers.get('range'),asset.bytes.length);
      if(!range)return new Response(null,{status:416,headers:{'content-range':'bytes */'+asset.bytes.length}});
      const headers={'content-type':mime(asset.path),'cache-control':'no-store','accept-ranges':'bytes','content-length':String(range.end-range.start+1),'x-sp-native-resource':'DESKTOP-MOD-EVENT'};
      if(range.status===206)headers['content-range']=`bytes ${range.start}-${range.end}/${asset.bytes.length}`;
      return new Response(request.method==='HEAD'?null:asset.bytes.subarray(range.start,range.end+1),{status:range.status,headers});
    }
    const owner=libraries.get(new URL(request.url).origin);if(owner)return observeMotionResponse(observerRequest(request),await observeSimResponse(observerRequest(request),await owner.handle(request)));
    if(new URL(request.url).origin==='https://assets.weishuxieyi.icu')for(const peer of libraries.values()){const response=await peer.handle(request,true);if(response)return response;}
    return remote(request);
  };
  for(const scheme of new Set([new URL(origin).protocol.slice(0,-1),'http']))await ses.protocol.handle(scheme,handleRequest);
  ses.setPermissionRequestHandler((_web,_name,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
  ses.setDevicePermissionHandler(()=>false);
  ipcMain.on('sp:bundled-manifest',(event)=>{try{if([origin,trainingOrigin].includes(new URL(event.senderFrame.url).origin)&&event.senderFrame===event.sender.mainFrame)event.returnValue=library.bridge;else event.returnValue=null}catch{event.returnValue=null}});
  const internal=url=>{try{return allowed.has(new URL(url).origin)}catch{return false}};
  const external=url=>{try{if(['https:','http:'].includes(new URL(url).protocol))void shell.openExternal(url)}catch{}};
  const win=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:600,show:false,title:'卫戍协议 · 服务器大厅',backgroundColor:'#0b1212',autoHideMenuBar:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:['--sp-origin='+origin],contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false}});
  let previewWin=null,trainingWin=null;
  const syncFor=target=>{try{if(target&&!target.isDestroyed()&&[origin,trainingOrigin].includes(new URL(target.webContents.getURL()).origin))void target.webContents.executeJavaScript(musicBootstrap({tracks:mods.eventTracks(),sessionTrack:mods.sessionTrack()})+'\n'+motionBootstrap({motion:mods.motionConfig()})).catch(()=>{});}catch{}};
  const syncMusic=()=>{syncFor(win);syncFor(trainingWin);};
  const previewUrl=pathToFileURL(path.join(__dirname,'mod-preview.html')).href;
  const previewLibrary=new ModPreviewLibrary({mods,library,baseline:JSON.parse(fs.readFileSync(path.join(__dirname,'Mod目标素材清单-0.2.6.json'),'utf8'))});
  ipcMain.handle('sp:mod-preview-catalog',event=>{if(!isPreviewSender(event,previewWin,previewUrl))throw Error('预览接口仅供本地预览窗口使用');return previewLibrary.catalog();});
  ipcMain.handle('sp:mod-preview-asset',(event,id,original)=>{if(!isPreviewSender(event,previewWin,previewUrl))throw Error('预览接口仅供本地预览窗口使用');return previewLibrary.asset(id,original);});
  const openPreview=()=>{
    if(previewWin&&!previewWin.isDestroyed()){previewWin.show();previewWin.focus();return;}
    previewWin=new BrowserWindow({width:1180,height:850,minWidth:720,minHeight:560,show:false,title:'本地 Mod 预览室',backgroundColor:'#0b1414',parent:win,webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:['--sp-mod-preview'],contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
    previewWin.setMenu(null);previewWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    previewWin.webContents.on('will-navigate',e=>e.preventDefault());previewWin.webContents.on('will-redirect',e=>e.preventDefault());previewWin.webContents.on('will-attach-webview',e=>e.preventDefault());
    previewWin.once('ready-to-show',()=>previewWin?.show());previewWin.on('closed',()=>{previewWin=null;});
    void previewWin.loadFile(path.join(__dirname,'mod-preview.html'));
  };
  const openTraining=()=>{
    if(trainingWin&&!trainingWin.isDestroyed()){trainingWin.show();trainingWin.focus();return;}
    trainingWin=new BrowserWindow({width:1440,height:900,minWidth:960,minHeight:600,show:false,title:'卫戍协议 · 本地训练场',backgroundColor:'#0b1414',parent:win,webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:['--sp-origin='+trainingOrigin],contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
    trainingWin.setMenu(null);trainingWin.webContents.setUserAgent(trainingWin.webContents.getUserAgent()+' SPDesktop/1.0 BundledAssets/2');trainingWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const restrict=(e,legacy)=>{try{if(new URL(e.url||legacy).origin===trainingOrigin)return;}catch{}e.preventDefault();};
    trainingWin.webContents.on('will-navigate',restrict);trainingWin.webContents.on('will-redirect',restrict);trainingWin.webContents.on('will-attach-webview',e=>e.preventDefault());
    trainingWin.webContents.on('did-finish-load',()=>syncFor(trainingWin));
    trainingWin.webContents.on('did-start-navigation',(e,url,_inPlace,main)=>{if(e.isMainFrame??main)libraries.get(trainingOrigin)?.setPage(e.url||url);});
    trainingWin.webContents.on('did-fail-load',(_e,code,_desc,_url,main)=>{if(main&&code!==-3&&trainingWin&&!trainingWin.isDestroyed())void dialog.showMessageBox(trainingWin,{type:'info',message:'请先启动本地训练服务',detail:'在本地兼容测试服目录运行“启动房间扩展本地测试服.cmd”，然后重新打开训练场。当前服务器对局仍在主窗口中。'});});
    trainingWin.once('ready-to-show',()=>trainingWin?.show());trainingWin.on('closed',()=>{trainingWin=null;});void trainingWin.loadURL(trainingOrigin+'/training.html').catch(()=>{});
  };
  win.webContents.on('did-finish-load',syncMusic);
  ipcMain.on('sp:launcher-servers',event=>{event.returnValue=event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===pathToFileURL(path.join(__dirname,'launcher.html')).href?servers:null});
  const launcher=()=>win.loadFile(path.join(__dirname,'launcher.html'));
  const enter=server=>win.loadURL(server.url).catch(()=>{});
  win.webContents.setUserAgent(win.webContents.getUserAgent()+' SPDesktop/1.0 BundledAssets/2');
  win.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'}});
  win.webContents.on('will-navigate',(event,legacyUrl)=>{const url=event.url||legacyUrl;if(!internal(url)){event.preventDefault();external(url)}});
  win.webContents.on('will-redirect',(event,legacyUrl)=>{const url=event.url||legacyUrl;if(!internal(url)){event.preventDefault();external(url)}});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('did-start-navigation',(event,legacyUrl,_inPlace,legacyMain)=>{if(event.isMainFrame??legacyMain)for(const peer of libraries.values())peer.setPage(event.url||legacyUrl)});
  win.webContents.on('did-fail-load',(_event,code,_description,url,isMain)=>{if(isMain&&code!==-3&&show)void dialog.showMessageBox(win,{type:'warning',title:'连接暂不可用',message:'暂时无法打开服务器',detail:'请检查网络后重试，或返回选服。内置素材和登录数据仍保留。',buttons:['重试','返回选服']}).then(r=>r.response===0&&internal(url)?win.loadURL(url):launcher())});
  win.webContents.on('render-process-gone',()=>{if(show)void dialog.showMessageBox(win,{type:'warning',message:'游戏画面已停止',detail:'请重新打开客户端，内置资源与登录数据仍保留。',buttons:['关闭']}).then(()=>win.close())});
  const baseTemplate = [{label:'游戏',submenu:[{label:'返回选服大厅',click:launcher},...servers.map(s=>({label:s.name,click:()=>void enter(s)})),{label:'重新载入',accelerator:'CmdOrCtrl+R',click:()=>win.reload()},{role:'togglefullscreen',label:'全屏',accelerator:'F11'},{type:'separator'},{label:'退出',role:'quit'}]},{label:'资源',submenu:[{label:'内置资源状态',click:()=>{const s=library.status();void dialog.showMessageBox(win,{type:'info',message:'8443服完整素材已内置，无需导入 ZIP',detail:`内置 ${s.files.toLocaleString()} 个素材\n本次本地读取 ${s.hits} 次，约 ${(s.bytes/1048576).toFixed(1)} MB\n新增素材联网请求 ${s.updates} 次\n\nicu服按对方站点规则运行。账号、联机和游戏代码仍需联网。`})}},{label:'资源包与客户端更新',click:()=>external('https://pan.quark.cn/s/c078652ad1fd')}]},{label:'帮助',submenu:[{label:'使用说明',click:()=>dialog.showMessageBox(win,{message:`卫戍协议 · Windows 内置资源版 ${clientVersion}`,detail:'解压完整文件夹后启动客户端。顶部菜单可选服、导入资源增量及管理外观Mod，F11切换全屏。\n\n8443服素材从本地读取；icu服按对方站点规则运行。两服账号独立，客户端中的账号首次需要重新登录。\n\n更新通知与下载：QQ群455814975。'})}]}];
  const changed=()=>dialog.showMessageBox(win,{type:'info',message:'Mod设置已保存',detail:'事件音乐、整局BGM和小人动作配置立即生效；已载入的素材替换需重新载入，可在结束对局后按 Ctrl+R。新安装程序接口请先完整退出并重新启动客户端。'});
  baseTemplate[0].submenu.splice(1,0,{label:'本地训练场（独立窗口）',click:openTraining});
  baseTemplate[1].submenu.unshift({label:'导入资源增量包 ZIP…',click:async()=>{try{const choice=await dialog.showOpenDialog(win,{title:'选择8443服资源增量包',properties:['openFile'],filters:[{name:'资源增量包',extensions:['zip']}]});if(choice.canceled)return;if(fs.statSync(choice.filePaths[0]).size>268435456)throw Error('增量包不能超过256 MB');const result=await patches.importArchive(await fs.promises.readFile(choice.filePaths[0]));await dialog.showMessageBox(win,{message:'资源增量包已导入',detail:`新增 ${result.added} 个素材。下次加载自动使用。\n游戏仍会按服务器当前哈希校验，不会替换成旧版本素材。`})}catch(error){await dialog.showMessageBox(win,{type:'error',message:'增量包未导入',detail:error.message})}}});
  function refreshModsMenu(){
    const modsTemplate={label:'Mods',submenu:[
      {label:'本地 Mod 预览室…',click:openPreview},
      {label:'导入外观／音效 Mod ZIP…',click:async()=>{try{
        const choice=await dialog.showOpenDialog(win,{title:'选择本地外观、音效或素材包',properties:['openFile'],filters:[{name:'Mod ZIP',extensions:['zip']}]});if(choice.canceled)return;
        if(fs.statSync(choice.filePaths[0]).size>268435456)throw Error('外观包不能超过256 MB');
        const parsed=parseMod(await fs.promises.readFile(choice.filePaths[0])),m=parsed.manifest;
        const answer=await dialog.showMessageBox(win,{type:'question',message:'安装并启用「'+m.name+'」？',detail:`版本 ${m.version} · 固定替换 ${m.files.length} 项 · 新增 ${m.variants?.length||0} 套外观／音效选择 · 音乐事件 ${m.events?.length||0} 项\n整局循环BGM：${m.sessionMusic?'有':'无'} · 小人动作：${m.motion?'有':'无'}\n适用：8443服\n${m.description}\n\n安装后默认启用每组推荐项，可在Mods菜单切换或恢复原版。仅影响本机显示和播放。同ID的旧包将被更新。`,buttons:['安装并启用','取消'],defaultId:0,cancelId:1});
        if(answer.response===0){await mods.install(parsed);refreshModsMenu();await changed()}
      }catch(error){await dialog.showMessageBox(win,{type:'error',message:'外观／音效包未安装',detail:error.message})}}},
      {label:'打开 Mod 文件夹',click:()=>shell.openPath(mods.root)},
      {label:'试听音乐 Mod',enabled:mods.eventTracks().length>0||!!mods.sessionTrack(),click:()=>{try{if(new URL(win.webContents.getURL()).origin===origin)void win.webContents.executeJavaScript('globalThis.__SPDesktopMusic?.preview()').catch(()=>{});}catch{}}},
      {label:'停止音乐 Mod 播放',click:()=>{try{if(new URL(win.webContents.getURL()).origin===origin)void win.webContents.executeJavaScript('globalThis.__SPDesktopMusic?.stop()').catch(()=>{});}catch{}}},
      {label:'玩家使用指南',click:()=>shell.openPath(path.join(__dirname,'Mod使用指南.md'))},
      {label:'AI 制作指南',click:()=>shell.openPath(path.join(__dirname,'Mod制作指南-AI.md'))},
      {label:'打开0.2.5目标素材清单',click:()=>shell.openPath(path.join(__dirname,'Mod目标素材清单-0.2.5.json'))},
      {label:'Mod状态',click:()=>dialog.showMessageBox(win,{message:'本机 Mod 状态',detail:`已安装 ${mods.records.length} 个包，启用 ${mods.records.filter(r=>r.enabled).length} 个\n整局BGM：${mods.sessionTrack()?.name||'未启用'}\n小人动作：${mods.motionConfig()?.name||'未启用'}\n本次命中 ${mods.metrics.hits} 次，素材校验失败 ${mods.metrics.errors} 次\n\n按服务器原始哈希匹配；服务器改版后不匹配的项会跳过。`})},
      {label:'外观／音效选择',enabled:mods.records.some(r=>r.manifest.variants?.length),submenu:mods.records.filter(r=>r.manifest.variants?.length).map(r=>({label:r.manifest.name,enabled:r.enabled,submenu:[...new Set(r.manifest.variants.map(v=>v.group))].map(group=>{const choices=r.manifest.variants.filter(v=>v.group===group);return {label:(choices[0].category==='audio'?'音效 · ':'外观 · ')+choices[0].groupName,submenu:[{label:'使用原版（停用本组选项）',type:'radio',checked:r.selections[group]===null,click:async()=>{await mods.select(r.manifest.id,group,null);refreshModsMenu();await changed()}},...choices.map(v=>({label:v.name,type:'radio',checked:r.selections[group]===v.id,click:async()=>{await mods.select(r.manifest.id,group,v.id);refreshModsMenu();await changed()}}))]};})}))},
      {type:'separator'},
      ...(mods.records.length?mods.records.map(r=>({label:r.manifest.name+' · '+r.manifest.version,type:'checkbox',checked:r.enabled,click:async item=>{await mods.setEnabled(r.manifest.id,item.checked);refreshModsMenu();await changed()}})):[{label:'尚未安装外观包',enabled:false}]),
      {type:'separator'},
      {label:'移除外观包',enabled:mods.records.length>0,submenu:mods.records.map(r=>({label:r.manifest.name,click:async()=>{const answer=await dialog.showMessageBox(win,{type:'question',message:'移除「'+r.manifest.name+'」？',buttons:['取消','移除'],cancelId:0,defaultId:0});if(answer.response===1){await mods.remove(r.manifest.id);refreshModsMenu();await changed()}}}))}
    ]};Menu.setApplicationMenu(Menu.buildFromTemplate([...baseTemplate.slice(0,2),modsTemplate,...baseTemplate.slice(2)]));syncMusic();
  }
  refreshModsMenu();
  win.once('ready-to-show',()=>{if(show)win.show()});
  if(!test)win.on('close',event=>{if(/(?:\/_build\/|\/game\.html(?:$|[?#]))/.test(win.webContents.getURL())&&dialog.showMessageBoxSync(win,{type:'question',message:'关闭客户端？',detail:'进行中的对局会断开，可重新打开客户端尝试重连。',buttons:['继续游戏','关闭客户端'],defaultId:0,cancelId:0})===0)event.preventDefault()});
  if(home===null)await launcher();else await win.loadURL(origin+home);
  win.on('closed',()=>{previewWin?.close();trainingWin?.close();});
  return {win,library,ses,mods,openPreview,openTraining};
}
module.exports={startClient};
