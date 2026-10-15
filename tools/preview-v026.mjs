import { writeFileSync } from 'node:fs';
import { startServer } from '../server/index.js';
let server;
for (let port=14626;port<14630;port++) {
  try {server=await startServer({port,host:'127.0.0.1',matchWorkers:2});break;}
  catch(error){if(error.code!=='EADDRINUSE')throw error;}
}
if(!server)throw new Error('No free preview port');
writeFileSync(new URL('../.cache/v026-preview.json',import.meta.url),JSON.stringify({pid:process.pid,url:server.url+'/game.html',port:server.port},null,2));
console.log('Local-only preview:',server.url+'/game.html');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
