import WebSocket from 'ws';
import fs from 'node:fs/promises';
const expected='ee4149fa116a-7';
const report={at:new Date().toISOString(),oldGeneration:'3a528c4aa227-6',pongs:0,closedEarly:false,healthRetryErrors:0,pass:false};
const socket=new WebSocket('wss://weishuxieyi.icu/_build/'+report.oldGeneration+'/ws',{origin:'https://weishuxieyi.icu'});
socket.on('pong',()=>report.pongs++);
socket.on('close',()=>{if(!report.pass)report.closedEarly=true;});
try {
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 console.log('Old generation WebSocket connected');
 let publishedAt=0;const deadline=Date.now()+180000;
 while(Date.now()<deadline) {
  if(socket.readyState!==WebSocket.OPEN)throw new Error('Old stream disconnected during deployment');
  socket.ping();
  let h;try {const response=await fetch('https://weishuxieyi.icu/healthz',{signal:AbortSignal.timeout(8000)});h=await response.json();}
  catch {report.healthRetryErrors++;await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  if(h.build===expected.split('-')[0])publishedAt ||= Date.now();
  if(publishedAt && Date.now()-publishedAt>5000){report.newBuild=h.build;report.pass=report.pongs>=2;break;}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!report.pass)throw new Error('New generation not observed or old stream heartbeat failed');
}catch(error){report.error=error.message;process.exitCode=1;}
finally{socket.close();await fs.writeFile('../../outputs/r2-cutover/live-stream.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
