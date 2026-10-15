'use strict';
// Node.js 22+: no third-party dependency. ZIP uses stored UTF-8 entries.
const fs=require('node:fs/promises'),path=require('node:path');
const {parseMod}=require('./mods.cjs');
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
const crc=b=>{let n=0xffffffff;for(const v of b)n=table[(n^v)&255]^(n>>>8);return(n^0xffffffff)>>>0};
async function pack(folder){
 const root=await fs.realpath(folder),parts=[],directory=[];let offset=0,total=0,count=0;
 async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const absolute=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('不能包含符号链接');if(entry.isDirectory()){await walk(absolute);continue;}if(!entry.isFile())continue;
  const relative=path.relative(root,absolute).split(path.sep).join('/');if(!/^(?:mod\.json|.+\.(?:png|jpg|jpeg|webp|gif|avif|mp3|ogg|wav|m4a|aac|opus|flac|woff|woff2|ttf|otf|skel|atlas|md|txt))$/i.test(relative))throw Error('包内含不支持的文件：'+relative);
  const stat=await fs.stat(absolute);if(stat.size>33554432||(total+=stat.size)>267000000||++count>5000)throw Error('素材包超过大小或文件数量限制');
  const body=await fs.readFile(absolute),name=Buffer.from(relative),checksum=crc(body),local=Buffer.alloc(30),central=Buffer.alloc(46);if(name.length>65535)throw Error('路径过长');
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(checksum,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(checksum,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  parts.push(local,name,body);directory.push(central,name);offset+=local.length+name.length+body.length;
 }}await walk(root);
 const end=Buffer.alloc(22),size=directory.reduce((n,b)=>n+b.length,0);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,...directory,end]);
}
async function main(){
 const [command,input,output,...rest]=process.argv.slice(2);if(!['pack','validate'].includes(command)||!input||command==='pack'&&!output)throw Error('用法：node mod-tool.cjs pack 包目录 输出.zip [--targets 资源清单.json]\n或：node mod-tool.cjs validate 包.zip [--targets 资源清单.json]');
 const bytes=command==='pack'?await pack(input):await fs.readFile(input),parsed=parseMod(bytes),m=parsed.manifest;
 const args=command==='pack'?rest:[output,...rest],flag=args.indexOf('--targets');
 if(flag>=0){const targets=JSON.parse(await fs.readFile(args[flag+1],'utf8')).entries;if(!targets)throw Error('资源清单缺少entries');for(const item of [...m.files,...m.variants.flatMap(v=>v.files)])if(targets[item.target]?.hash!==item.originalSha256)throw Error('目标原始哈希不匹配：'+item.target);}
 if(command==='pack'){const dest=path.resolve(output),root=await fs.realpath(input);if(dest===root||dest.startsWith(root+path.sep))throw Error('输出ZIP必须放在素材目录外');await fs.writeFile(dest,bytes,{flag:'wx'});}
 console.log(JSON.stringify({ok:true,id:m.id,format:m.format,replacements:m.files.length,variants:m.variants.length,events:m.events?.length||0,sessionMusic:!!m.sessionMusic,motion:!!m.motion,groups:[...new Set(m.variants.map(v=>v.group))].length,bytes:bytes.length}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={pack};
