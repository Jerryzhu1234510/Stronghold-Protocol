'use strict';
const {app,dialog}=require('electron');
const path=require('node:path');
app.setName('卫戍协议');
const local030=process.argv.includes('--local-030') || require('./package.json').version.includes('030-test');
const localTest=local030||process.argv.includes('--local-test');
app.setPath('userData',path.join(app.getPath('appData'),local030?'WeishuDesktop8443-Local030':localTest?'WeishuDesktop8443-LocalExtensions':'WeishuDesktop8443'));
if(!app.requestSingleInstanceLock())app.quit();
else{
  let client;
  app.on('second-instance',()=>{if(client?.win){if(client.win.isMinimized())client.win.restore();client.win.show();client.win.focus()}});
  app.whenReady().then(async()=>{try{const localOrigin='http://127.0.0.1:'+(local030?'27630':'27627');const options=localTest?{origin:localOrigin,serversOverride:[{id:'local',name:local030?'0.3.0本地兼容测试服':'房间扩展本地测试服',url:localOrigin+'/game.html',badge:'本机隔离测试',description:'请先启动本地兼容服务端。测试账号与正式账号分开保存。'}]}:{};client=await require('./client.cjs').startClient(options)}catch(error){dialog.showErrorBox('客户端无法启动',error.message+'\n请重新解压完整客户端。');app.quit()}});
  app.on('window-all-closed',()=>app.quit());
}
