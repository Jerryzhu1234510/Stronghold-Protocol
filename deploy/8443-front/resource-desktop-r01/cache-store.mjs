// Keep the r25 cache readable. New writes are sharded so Cache.keys() queries
// stay below Chromium's per-query result-size limit, even with 20,000+ assets.
const native=globalThis.caches,LEGACY='sp-resource-content-v1',PREFIX='sp-resource-content-v2-';
const shardName=name=>new RegExp('^'+PREFIX+'[a-f0-9]$').test(name);
const opened=new Map();
const open=name=>{if(!opened.has(name))opened.set(name,native.open(name).catch(error=>{opened.delete(name);throw error;}));return opened.get(name);};
function destination(request){const url=new URL(typeof request==='string'?request:request.url,globalThis.location?.href);const hash=/\/__sp_resource_content\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];if(!hash)throw Error('Invalid resource cache key');return PREFIX+hash[0];}
async function names(){return(await native.keys()).filter(name=>name===LEGACY||shardName(name));}
const content={
 async match(request,options){const cache=await open(destination(request)),value=await cache.match(request,options);return value||await(await open(LEGACY)).match(request,options);},
 async put(request,response){return(await open(destination(request))).put(request,response);},
 async delete(request,options){const results=await Promise.all([destination(request),LEGACY].map(async name=>(await open(name)).delete(request,options)));return results.some(Boolean);},
 async keys(request,options){
  const list=await names(),keys=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,list.length)},async()=>{while(cursor<list.length){const cache=await open(list[cursor++]);keys.push(...await cache.keys(request,options));}}));
  return [...new Map(keys.map(key=>[key.url,key])).values()];
 }
};
export const resourceCaches={
 open(name){return name===LEGACY?Promise.resolve(content):native.open(name);},
 async delete(name){if(name!==LEGACY)return native.delete(name);const list=await names();list.forEach(key=>opened.delete(key));const results=await Promise.all(list.map(key=>native.delete(key)));return results.some(Boolean);},
 keys(){return native.keys();},
 has(name){return name===LEGACY?names().then(list=>list.length>0):native.has(name);}
};
