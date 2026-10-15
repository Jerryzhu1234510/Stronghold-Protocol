export function patchResourceWorker(source, {variants = {}} = {}){
  source="import '/resource-policy/compat.mjs';\nimport {resourceCaches as caches} from '/resource-policy/cache-store.mjs';\n"+source;
  if(source.includes('createResourceTransport'))return source+`
// Native clients keep immutable APK/PC resources outside browser CacheStorage.
self.addEventListener('message',event=>{
  const port=event.ports?.[0];if(!port||event.data?.action!=='ready')return;
  event.waitUntil((async()=>{try{
    const value=await loadManifest();
    if(typeof storageAvailable==='function' ? storageAvailable() : !!(globalThis.caches && navigator.locks?.request))await navigator.locks.request(lockName,async()=>{await(await caches.open(META_NAME)).put(prefKey,new Response(event.data.enabled===true?'on':'off'));});
    port.postMessage({ok:true,enabled:event.data.enabled===true,manifestReady:!!value,readyRevision:4});
  }catch(error){port.postMessage({ok:false,error:String(error?.message||error)});}})());
});`;

  const start=source.indexOf('async function loadManifest() {'),end=source.indexOf('async function enabled()',start);
  if(start<0||end<0||!source.includes('enabled: await enabled(),'))throw Error('Unsupported resource worker');
  const loader=`async function loadManifest() {
  if (manifest) return manifest;
  if (Date.now() < retryAt) return null;
  return manifestPending ??= (async () => {
    const url=new URL('data/resource-cache.json',base).href;
    let saved;
    try { saved=await caches.open('sp-resource-worker-manifests-v1'); const cached=await saved.match(url);
      if(cached){const value=await cached.json();if(value.version===1&&value.entries&&typeof value.entries==='object'&&!Array.isArray(value.entries)){cacheBudget=resourceCacheLimit(value);return manifest=value;}await saved.delete(url);}
    } catch { saved=null; }
    const response=await fetch(url,{cache:'force-cache',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Resource manifest unavailable');
    const value=await response.json();
    if(value.version!==1||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))throw Error('Invalid resource manifest');
    cacheBudget=resourceCacheLimit(value);manifest=value;
    try { if(saved){await saved.put(url,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));const keys=await saved.keys();for(const item of keys.slice(0,Math.max(0,keys.length-16)))await saved.delete(item);} }catch{}
    return value;
  })().catch(()=>{retryAt=Date.now()+3000;return null;}).finally(()=>{manifestPending=null;});
}
`;
  let patched = (source.slice(0,start)+loader+source.slice(end)).replace('enabled: await enabled(),','manifestReady: !!manifest, enabled: await enabled(),');
  const begin = patched.indexOf('async function fullResponse('), finish = patched.indexOf('async function serve(',begin);
  if (begin < 0 || finish < 0) throw Error('Unsupported resource transport');
  const transport = `
const imageVariants = ${JSON.stringify(variants)};
let downloadsActive = 0, audioActive = 0;
const downloadQueue = [];
function pumpDownloads() {
  for (let i = 0; i < downloadQueue.length && downloadsActive < 4;) {
    const job = downloadQueue[i];
    if (job.request.signal.aborted) { downloadQueue.splice(i,1); job.reject(job.request.signal.reason); continue; }
    if (job.audio && audioActive >= 1) { i++; continue; }
    downloadQueue.splice(i,1); downloadsActive++; if (job.audio) audioActive++;
    job.resolve(() => { downloadsActive--; if (job.audio) audioActive--; pumpDownloads(); });
  }
}
function downloadSlot(request) {
  return new Promise((resolve,reject) => {
    const audio = /\\.(?:mp3|ogg|wav|m4a|aac|flac|opus)(?:\\?|$)/i.test(request.url);
    const job = {request,audio,resolve,reject};
    // Battle images and models go before music that has not started downloading.
    if (audio) downloadQueue.push(job); else { const i=downloadQueue.findIndex(j=>j.audio); if(i<0)downloadQueue.push(job);else downloadQueue.splice(i,0,job); }
    request.signal.addEventListener('abort',pumpDownloads,{once:true}); pumpDownloads();
  });
}
async function fullResponse(request, item, useCache = true, allowVariant = true) {
  let selected=item, key=cacheKey(item), networkRequest=request;
  const cache = useCache ? await caches.open(CACHE_NAME) : null;
  let cached = cache ? await cache.match(key) : null;
  const variant = allowVariant && useCache && imageVariants[item.hash];
  if (!cached && variant) {
    selected=variant;key=cacheKey(variant);cached=await cache.match(key);
    networkRequest=new Request(new URL('/resource-policy/variants/'+variant.hash+'.webp',base.origin),{cache:'force-cache',credentials:'omit',signal:request.signal});
  }
  if (cached) { const headers=new Headers(cached.headers);headers.set('x-sp-resource-cache','HIT');return new Response(cached.body,{status:cached.status,headers}); }
  if (!inflight.has(key)) {
    const promise = (async () => {
      const generation = await epoch(); const release = await downloadSlot(networkRequest);
      try {
        const headers=new Headers(networkRequest.headers);headers.delete('range');headers.delete('if-range');
        const {response,verified}=await transport.fetch(new Request(networkRequest,{headers}),selected);
        if (!response.ok || response.status!==200 || response.type==='opaque') {
          if(variant) { await response.body?.cancel();throw Error('Variant unavailable'); } return response;
        }
        const body=await response.arrayBuffer();
        if(!verified) {
          const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');
          if(body.byteLength!==selected.bytes || digest!==selected.hash) {
            if(variant)throw Error('Variant hash mismatch');
            return new Response(body,{status:response.status,headers:response.headers});
          }
        }
        const cleanHeaders=new Headers(response.headers);cleanHeaders.delete('content-encoding');cleanHeaders.set('content-length',String(body.byteLength));
        cleanHeaders.set('x-sp-resource-bytes',String(body.byteLength));cleanHeaders.set('x-sp-resource-source',variant?'lossless-webp':'origin');
        const clean=new Response(body,{status:200,headers:cleanHeaders});
        if(useCache)try{await save(key,clean.clone(),body.byteLength,generation);}catch{}
        return clean;
      } finally { release(); }
    })().finally(()=>inflight.delete(key));inflight.set(key,promise);
  }
  try {return (await inflight.get(key)).clone();}
  catch(error){if(variant&&!request.signal.aborted)return fullResponse(request,item,useCache,false);throw error;}
}
`;
  patched = (patched.slice(0,begin) + transport + patched.slice(finish))
    .replace('await fullResponse(request, item);','await fullResponse(request, item, true, false);');
  return patched+`
// Room entry needs readiness, not a full storage summary.
self.addEventListener('message',event=>{
  const port=event.ports?.[0];if(!port||event.data?.action!=='ready')return;
  event.waitUntil((async()=>{try{
    const value=await loadManifest();
    const state=await navigator.locks.request(lockName,async()=>{
      const want=event.data.enabled===true;
      if(await enabled()!==want)await(await caches.open(META_NAME)).put(prefKey,new Response(want?'on':'off'));
      return {ok:true,enabled:want,manifestReady:!!value,readyRevision:3};
    });port.postMessage(state);
  }catch(error){port.postMessage({ok:false,error:String(error?.message||error)});}})());
});
`;
}
