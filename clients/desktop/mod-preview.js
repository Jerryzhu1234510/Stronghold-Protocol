'use strict';
(() => {
  const bridge=window.SPDesktopModPreview,$=id=>document.getElementById(id);
  let catalog=null,artUrl=null,eventUrl=null,sessionUrl=null,eventAudio=null,artSerial=0,eventSerial=0,loopSerial=0,looping=false,disposed=false;
  const listeners=new Set();
  let state={connection:{status:'online'},me:{playerId:'preview'},room:{code:'LOCAL-PREVIEW',inMatch:false,seats:[{playerId:'preview'}],spectators:[]},match:{public:{phase:'PREP',round:1,players:[{playerId:'preview'}]}}};
  // The preview owns its own store. It has no WebSocket or reference to a live match.
  window.__SP__={store:{get:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}}};
  const motion=window.SPDesktopMotionFactory({motion:null});
  const ref=motion.ref({id:'preview-art',kind:'op',side:'ally',ownerId:'preview'},64,{fieldId:'local-preview'});
  ref($('sprite'));
  const volume=()=>Number($('volume').value)/100;
  const session=window.SPDesktopSessionMusicFactory({getSettings:()=>({bgm:volume(),muted:false}),onChange:s=>{if(s.errors)status('循环音乐无法播放，请检查音频文件。');}});
  const status=text=>$('status').textContent=text;
  const current=()=>catalog?.mods.find(m=>m.id===$('mod').value)||null;
  const selectedTrack=event=>current()?.events.find(e=>e.event===event)||(!current()?catalog?.mods.flatMap(m=>m.events).find(e=>e.event===event&&e.effective):null);
  const selectedSession=()=>current()?.session||(!current()?catalog?.mods.find(m=>m.id===catalog.sessionModId)?.session:null);
  function publish(){state={...state,room:{...state.room,inMatch:true}};for(const fn of listeners)fn(state);}
  function applyMotion(){const selected=current()?.motion||(!current()?catalog?.mods.find(m=>m.id===catalog.motionModId)?.motion:null);motion.configure({motion:$('motion').checked?selected:null});publish();$('motion-info').textContent=selected?'动作：跳高 '+selected.bounceHeight+' 格 · 每秒 '+selected.bounceHz+' 次跳动 · 每秒 '+selected.spinRps+' 圈 · 横翻 '+(selected.flipX?'开':'关')+' · 竖翻 '+(selected.flipY?'开':'关'):'这个预览对象没有配置动作。';}
  const release=url=>{if(url)URL.revokeObjectURL(url);};
  async function blob(id,original=false){const asset=await bridge.asset(id,original);return URL.createObjectURL(new Blob([asset.bytes],{type:asset.mime}));}
  function stopEvent(){eventSerial++;if(eventAudio){eventAudio.onended=null;eventAudio.onerror=null;eventAudio.pause();eventAudio.removeAttribute('src');eventAudio.load();eventAudio=null;}release(eventUrl);eventUrl=null;session.setInterrupted(false);}
  function stopSession(){loopSerial++;looping=false;session.configure(null);release(sessionUrl);sessionUrl=null;}
  function stopAll(){stopEvent();stopSession();motion.configure({motion:null});$('motion').checked=false;status('已停止声音与动作。');}
  async function playEvent(track,label){
    stopEvent();const serial=eventSerial;session.setInterrupted(true);
    try{
      const url=await blob(track.asset);if(disposed||serial!==eventSerial){release(url);return;}
      eventUrl=url;const sound=new Audio(url);eventAudio=sound;sound.volume=volume()*(track.volume??1);
      if(track.startSeconds)sound.addEventListener('loadedmetadata',()=>{if(eventAudio===sound)sound.currentTime=Math.min(track.startSeconds,Math.max(0,sound.duration-.05));},{once:true});
      sound.onended=()=>{if(eventAudio===sound){stopEvent();status('试听结束：'+label);}};
      sound.onerror=()=>{if(eventAudio===sound){stopEvent();status('音频无法解码，请检查此包的音频文件。');}};
      await sound.play();if(eventAudio===sound){sound.dataset.previewVolume=String(track.volume??1);status('正在试听：'+label);}
    }catch(error){if(serial===eventSerial){stopEvent();status(error.message||'音频无法播放。');}}
  }
  async function startSession(){
    const track=selectedSession();if(!track)return;stopSession();const serial=loopSerial;
    try{const url=await blob(track.asset);if(disposed||serial!==loopSerial){release(url);return;}sessionUrl=url;looping=true;session.configure({...track,url,id:'preview-session'});publish();session.consume(state);session.setInterrupted(!!eventAudio);status('整局 BGM 开始循环；停止按钮或关闭窗口可结束。');}catch(error){if(serial===loopSerial)status(error.message);}
  }
  function files(){return current()?.files||catalog?.mods.filter(m=>m.enabled).flatMap(m=>m.files.filter(f=>f.effective).map(f=>({...f,modName:m.name})))||[];}
  async function showArt(){
    const id=$('art').value,serial=++artSerial;const item=files().find(f=>f.id===id);$('original').disabled=!item?.originalAvailable;if($('original').disabled)$('original').checked=false;
    try{const url=await blob(id,$('original').checked);if(disposed||serial!==artSerial){release(url);return;}release(artUrl);artUrl=url;$('sprite').src=url;$('sprite').hidden=false;$('art-info').textContent=item?(item.variant?item.variant+' · ':'')+item.target+(item.matchesBaseline?' · 对应当前本地素材清单':' · 原版哈希与本地清单不同，实战可能跳过'):'使用内置干员立绘展示动作；实战小人造型以训练场为准。';applyMotion();}catch(error){if(serial===artSerial){$('sprite').hidden=true;status(error.message);}}
  }
  function render(){
    stopEvent();stopSession();const chosen=current();$('description').textContent=chosen?chosen.description||'无简介':'预览已启用包的音乐事件、循环 BGM 和动作组合。';$('source').textContent=chosen?(chosen.enabled?'正式状态：已启用':'正式状态：未启用，仅预览'):'已安装 '+catalog.mods.length+' 个包';
    const art=$('art');art.replaceChildren();for(const b of catalog.builtins){const o=document.createElement('option');o.value=b.id;o.textContent=b.name;art.append(o);}for(const f of files().filter(f=>f.type==='image')){const o=document.createElement('option');o.value=f.id;o.textContent=(f.variant?f.variant+' / ':'')+f.path;art.append(o);}
    if(chosen?.files.some(f=>f.type==='image'))art.value=chosen.files.find(f=>f.type==='image').id;$('original').checked=false;$('motion').checked=true;if(art.value)void showArt();else{$('sprite').hidden=true;status('没有可预览图片；请检查完整客户端的资源库。');}
    $('events').replaceChildren();for(const [event,label] of Object.entries(catalog.events)){const track=selectedTrack(event),button=document.createElement('button');button.type='button';button.disabled=!track;const name=document.createElement('span');name.textContent=label;const detail=document.createElement('small');detail.textContent=track?'点击试听 · '+event:'未配置 · '+event;button.append(name,detail);button.onclick=()=>void playEvent(track,label);$('events').append(button);}
    const track=selectedSession();$('session-play').disabled=!track;$('session-stop').disabled=!track;$('session-info').textContent=track?'使用此包的真实音频、起播位置与音量；循环方式与整局 BGM 相同。':'当前对象未配置整局循环 BGM。';
    $('files').replaceChildren();if(!files().length)$('files').textContent='当前对象没有图片、音效或骨骼替换项。';for(const f of files()){const row=document.createElement('div');row.className='file-row';const title=document.createElement('div');title.textContent=(f.variant?'['+f.variant+'] ':'')+f.path+' → '+f.target;row.append(title);if(['audio','image'].includes(f.type)){const b=document.createElement('button');b.type='button';b.textContent=f.type==='audio'?'试听':'查看';b.onclick=()=>f.type==='audio'?void playEvent({asset:f.id},f.path):(art.value=f.id,void showArt());row.append(b);}else{const label=document.createElement('span');label.textContent='训练场验证';row.append(label);}$('files').append(row);}
    applyMotion();status('预览就绪；设置仅对这个窗口生效。');
  }
  async function refresh(){try{if(!bridge)throw Error('请从 PC 客户端顶部 Mods 菜单打开预览室。');const selected=$('mod').value;catalog=await bridge.catalog();$('mod').replaceChildren();const combined=document.createElement('option');combined.value='';combined.textContent='当前启用组合';$('mod').append(combined);for(const m of catalog.mods){const o=document.createElement('option');o.value=m.id;o.textContent=m.name+(m.enabled?'':'（未启用）');$('mod').append(o);}if(catalog.mods.some(m=>m.id===selected))$('mod').value=selected;render();}catch(error){status(error.message);}}
  $('refresh').onclick=()=>void refresh();$('mod').onchange=render;$('art').onchange=()=>void showArt();$('original').onchange=()=>void showArt();$('motion').onchange=applyMotion;$('stop-all').onclick=stopAll;$('session-play').onclick=()=>void startSession();$('session-stop').onclick=()=>{stopSession();status('已停止循环 BGM。');};
  $('volume').oninput=()=>{$('volume-value').textContent=$('volume').value+'%';if(eventAudio)eventAudio.volume=volume()*Number(eventAudio.dataset.previewVolume||1);session.refresh();};
  $('sprite').onerror=()=>{$('sprite').hidden=true;status('图片无法解码；如果这是图集，请在训练场检查完整模型。');};
  window.addEventListener('pagehide',()=>{disposed=true;artSerial++;stopEvent();stopSession();ref(null);motion.dispose();session.dispose();release(artUrl);listeners.clear();},{once:true});
  void refresh();
})();
