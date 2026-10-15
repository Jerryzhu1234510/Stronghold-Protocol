import {TestClient} from '../test/helpers/wsClient.js';
import fs from 'node:fs/promises';
const text='网卡的博士可以切换至香港节点',versions=['ee4149fa116a-7','e7e0ee91198d-8','f1f917eba035-9'];
const report={text,clients:[],pass:false};
try {
 for(const generation of versions) {
  const client=await TestClient.connect('wss://weishuxieyi.icu/_build/'+generation+'/ws',{timeout:10000,wsOptions:{origin:'https://weishuxieyi.icu'}});
  try {await client.hello('公告验收');const frame=await client.waitFor('server.announcement',()=>true,8000);report.clients.push({generation,announcement:frame.announcement});}
  finally{await client.close();}
 }
 report.pass=report.clients.every(c=>c.announcement?.text===text);if(!report.pass)process.exitCode=1;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await fs.writeFile('../../outputs/hongkong-node-announcement/ws-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
