// Compatibility must run before resource checks and native admission.
import './compat.mjs';
// Resource checks belong to the web picker. Native clients use their local index.
const build = new URL(import.meta.url).searchParams.get('build');
if (!/^[A-Za-z0-9_-]{1,80}$/.test(build || '')) throw Error('Invalid game entry');
const base = '/_build/' + build + '/';
const native = !!window.SPAndroidResources?.getManifest;
const toPortal = () => {
  const room = new URL(location.href).searchParams.get('room');
  if (room && /^[A-Za-z0-9_-]{1,40}$/.test(room)) sessionStorage.setItem('sp.entryRoom',room);
  location.replace(native ? '/game.html' : '/#resource-pack');
};
async function json(url, options = {}) {
  const response = await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000),...options});
  if (!response.ok) { const error = Error('入口暂不可用，请稍后重试。'); error.status = response.status; throw error; }
  return response.json();
}
let admitted = false;
function resumable() {
  try { return !!sessionStorage.getItem('sp.token') || JSON.parse(localStorage.getItem('sp.tokens') || '[]').length > 0 || !!localStorage.getItem('sp.account'); } catch { return false; }
}
async function inactiveNative() {
  // Old matches keep their frozen build; only the active build can admit new rooms.
  if (!resumable()) { toPortal(); await new Promise(() => {}); }
}
if (native) {
  try {
    await import('/resource-policy/client.js');
    const result = await window.SPResourcePolicy.create({build}).check();
    if (!result.ready) throw Error('客户端缺少 '+result.missing+' 个核心素材，请从QQ群455814975或1127927007获取服主发布的新版客户端或资源增量包，再重新载入。');
    const current = await json('/resource-policy/admission?build=' + build);
    if (current.build !== build) {
      await inactiveNative();
    } else {
      try {
        await json('/resource-policy/admission',{method:'POST',headers:{'Content-Type':'application/json','X-SP-Resource-Entry':'1'},body:JSON.stringify({build:result.build,digest:result.digest,source:'native'})});
        admitted = true;
      } catch (error) {
        // Activation can race with the receipt request. Resume, without granting admission.
        if (error.status !== 409 || (await json('/resource-policy/admission?build=' + build)).build === build) throw error;
        await inactiveNative();
      }
    }
  } catch (error) {
    const box=document.createElement('aside');box.className='sp-local-banner';
    const title=document.createElement('strong');title.textContent=error.message;
    const retry=document.createElement('button');retry.textContent='重新载入';retry.onclick=()=>location.reload();
    box.append(title,retry);document.body.append(box);
    throw error;
  }
} else {
  try { admitted = (await json('/resource-policy/admission?build='+build)).allowed === true; } catch {}
  if (!admitted && !resumable()) {toPortal();await new Promise(()=>{});}
}
const [{ net }, { store }] = await Promise.all([import(base + 'js/net.js'), import(base + 'js/store.js')]);
const prepare = async () => {
  if (!navigator.serviceWorker || !navigator.locks || !globalThis.caches) return;
  try {
    const registration = await navigator.serviceWorker.register(base+'js/resources/worker.js',{type:'module',scope:base,updateViaCache:'none'});
    for(let i=0;i<20&&!registration.active;i++)await new Promise(r=>setTimeout(r,75));
    if(registration.active){const channel=new MessageChannel();channel.port1.onmessage=()=>channel.port1.close();registration.active.postMessage({action:'ready',enabled:!native},[channel.port2]);}
  } catch {}
};
await Promise.race([prepare(),new Promise(r=>setTimeout(r,1800))]);
const noticeHtml = "<strong>【8443服 0.2.6 · r05 更新】</strong><p>新增好友邀请、申请加入及观战；房主可在房间扩展面板设置Boss／其他敌人血量、取消Boss限伤与鸭爵增强。</p><p><strong>正常4～8人终极通关8杯；仅增强敌人血量不减杯。</strong>克隆模式、取消Boss限伤或鸭爵增强计杯减半，多个设置不重复减半。累计杯数从本次更新后结算开始，旧战绩不追补。</p><p><strong>旧完整资源包v2＋0.2.5核心素材补全包继续有效，无需重下。</strong>网页须在选服大厅导入并检查资源；电脑端完整解压后使用PC1.0.8程序更新（1.0.6完整版为基底），安卓完整版1.0.2继续可用。PC本地音乐、外观及小人动作Mod保持兼容。</p><p>本次维护后请从选服大厅或客户端重新进入，原账号、好友和历史记录保留。客户端、APK及资源文件请以服主实际发布的群文件为准。</p><p><strong>QQ群：455814975 ／ 1127927007，两个群同时使用。</strong></p>";
const pinNotice=()=>{for(const target of document.querySelectorAll('.release-notes__pinned')){if(target.querySelector('.sp-desktop-announcement'))continue;const notice=document.createElement('div');notice.className='sp-local-announcement sp-desktop-announcement';notice.innerHTML=noticeHtml;target.prepend(notice);}for(const target of document.querySelectorAll('.release-notes__feedback strong,.release-notes-entry__feedback')){const label='问题反馈群：455814975 / 1127927007';if(target.textContent!==label)target.textContent=label;}};
new MutationObserver(pinNotice).observe(document.getElementById('app'),{childList:true,subtree:true});
const request=net.request.bind(net);
net.request=async(type,...args)=>{try{return await request(type,...args);}catch(error){if(error.code==='ENTRY_REQUIRED'&&!native)toPortal();throw error;}};
if(!admitted){
  let settled=false,timer;
  const leaving=()=>{if(!settled)return;const state=store.get(),phase=state.match?.public?.phase;if(!state.room?.inMatch&&(!phase||phase==='LOBBY'))toPortal();};
  net.on('welcome',()=>{settled=false;clearTimeout(timer);timer=setTimeout(()=>{settled=true;leaving();},2500);});
  store.subscribe(leaving);
}
await import(base+'js/main.js');pinNotice();
