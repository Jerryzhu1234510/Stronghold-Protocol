'use strict';
const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame&&location.protocol==='file:'&&process.argv.includes('--sp-mod-preview')){
  contextBridge.exposeInMainWorld('SPDesktopModPreview',Object.freeze({catalog:()=>ipcRenderer.invoke('sp:mod-preview-catalog'),asset:(id,original=false)=>ipcRenderer.invoke('sp:mod-preview-asset',id,original)}));
}
if(process.isMainFrame&&location.protocol==='file:'&&!process.argv.includes('--sp-mod-preview')){
  const servers=ipcRenderer.sendSync('sp:launcher-servers');
  if(Array.isArray(servers))contextBridge.exposeInMainWorld('SPDesktopLauncher',Object.freeze({getServers:()=>servers}));
}
if(process.isMainFrame&&location.origin===process.argv.find(x=>x.startsWith('--sp-origin='))?.slice('--sp-origin='.length)){
  const manifest=ipcRenderer.sendSync('sp:bundled-manifest');
  if(typeof manifest==='string')contextBridge.exposeInMainWorld('SPAndroidResources',Object.freeze({getManifest:()=>ipcRenderer.sendSync('sp:bundled-manifest')}));
}
