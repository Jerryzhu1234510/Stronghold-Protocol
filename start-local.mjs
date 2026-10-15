import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startGateway} from './server/hot/gateway.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
// Only the disposable local test DB: recover a stale lock after Windows force-closes
// the test console. Never remove a lock owned by a live/inaccessible process.
const localLock=path.join(root,'local-state/accounts.json.lock');
try {
 const lock=JSON.parse(await fs.readFile(localLock,'utf8'));
 if(!Number.isSafeInteger(lock.pid)||lock.pid<=0)throw Error('本地测试锁格式异常，请人工检查');
 try { process.kill(lock.pid,0); throw Error('本地测试服仍在运行，请先关闭原窗口'); }
 catch(e) { if(e.code!=='ESRCH')throw e; await fs.unlink(localLock); }
} catch(e) { if(e.code!=='ENOENT')throw e; }
const gateway=await startGateway({releaseRoot:root,host:'127.0.0.1',port:27627,accountFile:path.join(root,'local-state/accounts.json'),allowCreateAccounts:true});
console.log('0.2.6房间扩展本地测试：http://127.0.0.1:27627/game.html（账号和正式服独立）');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await gateway.close();process.exit(0);});

process.stdin.setEncoding('utf8');process.stdin.on('data',async text=>{if(text.trim()==='stop'){await gateway.close();process.exit(0);}});
console.log('停止时输入 stop 并回车，或按 Ctrl+C。');
