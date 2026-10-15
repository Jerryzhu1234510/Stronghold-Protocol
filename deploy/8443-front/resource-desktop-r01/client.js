(() => {
  'use strict';
  if (window.SPResourcePolicy) return;
  const CACHE = 'sp-resource-content-v1';
  const openCache=async name=>(await import('/resource-policy/cache-store.mjs')).resourceCaches.open(name);
  const manifests = new Map();
  let lastDiagnostic=null;
  const supported = () => isSecureContext && !!navigator.serviceWorker && !!navigator.locks && !!globalThis.caches && !!crypto.subtle;
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  const failure = message => Object.assign(new Error(message), { code:'LOCAL_RESOURCES_REQUIRED' });
  async function localRead(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('浏览器读取素材库等待过久。请保持页面在前台，关闭其他导入页面后重新检查。')),30000);})]);}finally{clearTimeout(timer);}}
  async function json(url, cache='no-store') {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    let response;try{response=await fetch(url,{cache,signal:controller.signal});return await read(response);}finally{clearTimeout(timer);}
    async function read(response){
    if (!response.ok) throw failure('资源检查暂不可用，请稍后点击重新检查。');
    return response.json();
    }
  }
  function create({ build, prepare = async () => {} } = {}) {
    let dialog, text, progress, retry, close, pending, resolve, reject, running = false;
    function ui() {
      if (dialog) return;
      dialog = document.createElement('dialog'); dialog.className = 'sp-local-dialog';
      dialog.innerHTML = '<form method="dialog"><button class="sp-local-close" aria-label="关闭资源检查">×</button></form><p class="sp-local-eyebrow">8443服 · 本地资源库</p><h2>检查本地素材后进入游戏</h2><p>安卓完整版内置全部素材，无需导入ZIP。iOS／电脑网页需先导入旧完整包v2，再导入0.2.5核心素材补全包。账号、联机和模拟数据仍需联网。</p><progress max="1" value="0" aria-label="本地资源检查进度"></progress><p class="sp-local-status" role="status" aria-live="polite"></p><div class="sp-local-actions"><a class="sp-local-primary" href="/#resource-pack">去导入 ZIP 资源包</a><button type="button" class="sp-local-retry">重新检查</button></div><p>优先从 QQ 群 <strong>455814975</strong> 下载旧完整包v2及0.2.5核心素材补全包。服务器备用下载共享限速，人数多时会较慢。下载 ZIP 后还需在本站导入。</p><a class="sp-local-resume" href="/game.html">恢复已有对局（新开局仍需检查）</a>';
      const download = document.createElement('p'); download.className = 'sp-local-downloads';
      download.innerHTML = '<strong>请先到 QQ 群 455814975 群文件下载0.2.5核心素材补全包，再回选服大厅导入；旧完整资源包v2仍有效，不要清空缓存。电脑端与安卓APK也从群文件获取。</strong>';
      const extra = document.createElement('a'); extra.href = '/#resource-pack'; extra.textContent = '回到选服大厅导入资源'; download.append(' ',extra);
      dialog.querySelector('.sp-local-actions').after(download);
      document.body.append(dialog); text = dialog.querySelector('.sp-local-status'); progress = dialog.querySelector('progress');
      retry = dialog.querySelector('.sp-local-retry'); close = dialog.querySelector('.sp-local-close');
      retry.addEventListener('click', () => { void inspect(); });
      dialog.addEventListener('close', () => { if (pending) reject?.(failure('请先导入本地资源包，再创建或加入新对局。')); });
    }
    async function check(onProgress = () => {}, onStage=()=>{}) {
      const started=performance.now(),timings={};
      if (!supported()) throw failure('当前浏览器无法使用本地资源库。请使用正常模式的新版 Edge、Chrome 或支持站点存储的浏览器。');
      onStage('正在读取版本清单…');
      const selected = build || (await json('/resource-policy/status.json')).build;
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(selected || '')) throw failure('服务器版本暂不可用，请稍后重试。');
      if(!manifests.has(selected))manifests.set(selected,json('/resource-policy/manifest.json?build='+encodeURIComponent(selected),'force-cache').catch(error=>{manifests.delete(selected);throw error;}));
      const manifest = await manifests.get(selected);
      if (manifest.version !== 1 || manifest.build !== selected || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 50000) throw failure('资源清单无效，请联系服主。');
      const seen = new Set();
      for (const item of manifest.entries) {
        if (!/^[a-f0-9]{64}$/.test(item?.hash) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > 33554432 || seen.has(item.hash)) throw failure('资源清单无效，请联系服主。');
        seen.add(item.hash);
      }
      timings.manifestMs=Math.round(performance.now()-started);
      async function finish(result){
        result.digest=manifest.digest;
        const before=performance.now();if(result.ready)onStage('素材已齐全，正在准备读取组件…');
        if(result.ready)await prepare(selected,result);
        timings.prepareMs=Math.round(performance.now()-before);timings.totalMs=Math.round(performance.now()-started);
        result.timings=timings;lastDiagnostic={revision:'resource-fast-r04',...result};
        window.dispatchEvent(new CustomEvent('sp:local-resource-check',{detail:result}));return result;
      }
      const native=new Map();
      try{
        const bundled=JSON.parse(window.SPAndroidResources?.getManifest?.()||'null');
        if(bundled?.version===1&&bundled.source==='android-bundled'&&Array.isArray(bundled.entries)&&bundled.entries.length<=50000)
          for(const item of bundled.entries)if(/^[a-f0-9]{64}$/.test(item?.hash)&&Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=33554432)native.set(item.hash,item.bytes);
      }catch{}
      const nativeOnly=manifest.entries.every(item=>native.get(item.hash)===item.bytes);
      if(nativeOnly){
        const result={ready:true,build:selected,count:manifest.entries.length,missing:0,missingBytes:0,nativeOnly:true,source:'android-bundled'};
        timings.inventoryMs=0;onProgress(result.count,result.count);return finish(result);
      }
      const inventoryStarted=performance.now();onStage('正在读取本机素材目录…');
      let missing = 0, missingBytes = 0;
      const controller=new AbortController(),lockTimer=setTimeout(()=>controller.abort(),30000);
      let result;
      try{result = await navigator.locks.request('sp-resource-write-v1', {mode:'shared',signal:controller.signal}, async () => {
        clearTimeout(lockTimer);
        // Every writer verifies SHA-256 before cache.put. Enumerate actual content-addressed
        // keys once for completeness; do not open 6,759 responses again on every room action.
        // Keep the inventory inside the shared lock so a concurrent clear cannot race it.
        const cache=await localRead(openCache(CACHE)),keys=new Set((await localRead(cache.keys())).map(request=>request.url));
        for(const item of manifest.entries){
          if(native.get(item.hash)!==item.bytes&&!keys.has(location.origin+'/__sp_resource_content/'+item.hash)){missing++;missingBytes+=item.bytes;}
        }
        onProgress(manifest.entries.length,manifest.entries.length);
        return {ready:missing === 0, build:selected, count:manifest.entries.length, missing, missingBytes};
      });}catch(error){if(error.name==='AbortError'&&controller.signal.aborted)throw failure('另一个页面正在写入素材，请等导入完成后重新检查。');throw error;}finally{clearTimeout(lockTimer);}
      timings.inventoryMs=Math.round(performance.now()-inventoryStarted);return finish(result);
    }
    async function inspect() {
      if (running) return; running = true; retry.disabled = true; progress.value = 0;
      text.textContent = '正在核对当前版本的本地资源，请稍候…';
      let stage='正在核对当前版本的本地资源',since=Date.now();
      const heartbeat=setInterval(()=>{if(Date.now()-since>3000)text.textContent=stage+'（等待'+Math.floor((Date.now()-since)/1000)+'秒，请保持页面在前台）';},1000);
      try {
        const result = await check((done,total) => { progress.value = done/total; text.textContent = '正在检查本地资源 ' + done + '/' + total + '…'; },value=>{stage=value;since=Date.now();text.textContent=value;});
        if (result.ready) { text.textContent = '核心资源检查通过，可以进入游戏。'; resolve?.(result); }
        else text.textContent = '缺少 ' + result.missing + ' 个核心素材（约 ' + mb(result.missingBytes) + '）。请导入旧完整包v2及0.2.5核心补全包，再点击重新检查。';
      } catch (error) { text.textContent = error.message || '检查失败，请稍后重试。'; }
      finally { clearInterval(heartbeat);running = false; retry.disabled = false; }
    }
    function ensure() {
      if (pending) return pending;
      ui(); if (!dialog.open) dialog.showModal();
      pending = new Promise((yes,no) => { resolve = yes; reject = no; }).finally(() => {
        pending = null; resolve = reject = null; if (dialog.open) dialog.close();
      });
      void inspect(); return pending;
    }
    return {check,ensure};
  }
  window.SPResourcePolicy = {create,supported,diagnostics:()=>lastDiagnostic};
})();
