import { createTrainingModAdapter } from './mod-adapter.js';
import { DATA_FILES, LIMITS, TRAINING_HISTORY_KEY, defaultScenario, validateScenario, legalTiles, deployTiles, trainingBonds, battleOptions, loadTraining, saveTraining, summarizeTraining, saveTrainingResult } from './model.js';

const root = document.getElementById('training-app');
const modAdapter = createTrainingModAdapter();
window.addEventListener('pagehide', () => { modAdapter.dispose(); view?.destroy?.(); }, { once: true });
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, action, cls) => { const n = el('button', text, cls); n.type = 'button'; n.onclick = action; return n; };
const select = (entries, value, action, label) => { const n = el('select'); n.setAttribute('aria-label', label); for (const [v,t] of entries) n.add(new Option(t,String(v))); n.value = String(value); if (action) n.onchange = () => action(n.value); return n; };
const number = (value, min, max, action, label) => { const n = el('input'); n.type = 'number'; n.min = min; n.max = max; n.step = 1; n.value = value; n.setAttribute('aria-label', label); n.onchange = () => action(Number(n.value)); return n; };
const label = (text, control) => { const n = el('label', text); n.append(control); return n; };
const row = (...nodes) => { const n = el('div', null, 'form-row'); n.append(...nodes); return n; };
const note = text => el('p', text, 'note');
const amount = x => Math.round(Number(x) || 0).toLocaleString('zh-CN');
let raw, scenario, sim, ds, view, battle, running = false, selected = 0, speed = 1, budget = 0, lastStats = 0, finishedSaved = false;
let storage; try { storage = localStorage; } catch { storage = { getItem(){ return null; }, setItem(){ throw new Error('浏览器禁止本地存储'); } }; }
let status, editor, board, grid, caption, metrics, resultBody, historyBox, startBtn, pauseBtn, stepBtn, resetBtn;


function say(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function edit(action) {
  if (battle) { say('先点击“重置战斗”返回布阵，再修改方案。'); return; }
  try { action(); drawEditor(); drawGrid(); drawPreview(); } catch(e) { say(e.message, true); }
}
function catalogue(records, key, searchLabel, onAdd) {
  const box = el('div'); const q = el('input'); q.type = 'search'; q.placeholder = searchLabel; q.setAttribute('aria-label', searchLabel);
  const list = select([], '', null, `${searchLabel}结果`); list.size = 4; list.className = 'catalogue';
  const refill = () => { list.replaceChildren(); const needle = q.value.trim().toLowerCase(); records.filter(r => `${r.name} ${r[key]}`.toLowerCase().includes(needle)).slice(0,250).forEach(r => list.add(new Option(`${r.name}${r.isGolden ? ' · 精锐' : ''}${r.rank === 'BOSS' ? ' · 首领' : ''}`,r[key]))); if (list.options.length) list.selectedIndex = 0; };
  q.oninput = refill; refill(); box.append(q,list,button('添加所选',()=>edit(()=>{ if (!list.value) throw new Error('请先选择一项'); onAdd(list.value); }),'compact')); return box;
}
function section(title, open = false) { const d = el('details'); d.open = open; d.append(el('summary',title)); return d; }
function remap(next) {
  const used = new Set();
  for (const u of next.units) { const p = legalTiles(raw,next,u.chessId).find(([r,c]) => !used.has(`${r},${c}`)); if (!p) throw new Error('新地图可用格位不足，请先减少干员。'); [u.row,u.col]=p; used.add(p.join(',')); }
  scenario = next;
}
function drawEditor() {
  const open = [...editor.querySelectorAll('details')].map(x=>x.open); editor.replaceChildren();
  const settings=section('01 / 训练设置',open[0]??true);
  settings.append(row(select(Object.values(raw.stages).filter(s=>s.deployTiles?.normal).map(s=>[s.id,`${s.name} · ${s.id.replace('autochess','')}`]),scenario.stageId,v=>edit(()=>remap({...JSON.parse(JSON.stringify(scenario)),stageId:v})),'训练地图')),
    row(select([['normal','普通战场'],['boss','Boss 战场（左半场）']],scenario.kind,v=>edit(()=>remap({...JSON.parse(JSON.stringify(scenario)),kind:v})),'战场类型')),
    row(label('回合',number(scenario.round,1,20,v=>edit(()=>scenario.round=v),'测试回合')),label('时限 / 秒',number(scenario.seconds,10,300,v=>edit(()=>scenario.seconds=v),'训练时限'))),
    row(label('敌人生命 ×',number(scenario.hpMul,1,96,v=>edit(()=>scenario.hpMul=v),'训练敌人生命倍率'))),
    row(label('种子',number(scenario.seed,1,0xffffffff,v=>edit(()=>scenario.seed=v),'训练随机种子'))));
  const cap=el('input');cap.type='checkbox';cap.checked=scenario.noBossCap;cap.onchange=()=>edit(()=>scenario.noBossCap=cap.checked);
  settings.append(row(label('取消 Boss 限伤',cap)),note('此开关仅影响 Boss 战场中首领的单次30万伤害限制；普通战场原本不限伤。'),note('敌人使用数据库原始属性，仅叠加所选生命倍率；回合用于技能规则，不自动套用正式波次倍率。训练不模拟多人共享血池、赛局经济和跨轮结算。'));
  const operators=section(`02 / 干员与装备 · ${scenario.units.length}/${LIMITS.units}`,open[1]??true);
  operators.append(catalogue(Object.values(raw.chess).filter(c=>c.visible!==false&&!c.isDiy),'chessId','搜索干员名称',id=>{
    if(scenario.units.length>=LIMITS.units)throw new Error('最多12名干员');const p=legalTiles(raw,scenario,id).find(([r,c])=>!scenario.units.some(u=>u.row===r&&u.col===c));if(!p)throw new Error('没有适合该干员的空格位');
    scenario.units.push({chessId:id,row:p[0],col:p[1],dir:'RIGHT',items:[]});selected=scenario.units.length-1;
  }));
  scenario.units.forEach((u,i)=>{
    const card=el('div',null,`unit-card${selected===i?' is-selected':''}`);const head=el('div',null,'card-heading');head.append(button(String(i+1),()=>{selected=i;drawEditor();drawGrid();},'compact'),el('strong',`${raw.chess[u.chessId].name}${raw.chess[u.chessId].isGolden?' · 精锐':''}`),button('移除',()=>edit(()=>{scenario.units.splice(i,1);selected=Math.max(0,Math.min(selected,scenario.units.length-1));}),'compact'));card.append(head);
    card.append(row(el('span',`格 ${u.row},${u.col}`),select([['RIGHT','朝右 →'],['LEFT','朝左 ←'],['UP','朝上 ↑'],['DOWN','朝下 ↓']],u.dir,v=>edit(()=>u.dir=v),`干员${i+1}朝向`)));
    const eq=el('div',null,'equipment');if(!u.items.length)eq.append(el('span','未装备'));u.items.forEach((id,j)=>{const line=el('div',raw.items[id].name);line.append(button('×',()=>edit(()=>u.items.splice(j,1)),'compact'));eq.append(line);});card.append(eq);operators.append(card);
  });
  operators.append(note('点击干员编号，再点击右侧布阵格换位置。高台格为蓝色，装备会发给当前选中的干员。'),catalogue(Object.values(raw.items).filter(i=>i.itemType==='EQUIP'),'id','搜索装备名称',id=>{const u=scenario.units[selected];if(!u)throw new Error('先添加并选择干员');if(u.items.length>=LIMITS.items)throw new Error('每名干员最多两件装备');u.items.push(id);}));
  const enemy=section(`03 / 敌人编组 · ${scenario.enemies.reduce((n,e)=>n+e.count,0)}/${LIMITS.enemies}`,open[2]??true);
  enemy.append(catalogue(Object.values(raw.enemies).filter(e=>!e.tokenOnly),'key','搜索敌人 / Boss 名称',id=>{if(scenario.enemies.length>=12)throw new Error('最多12组敌人');scenario.enemies.push({enemyKey:id,count:1,time:2,interval:2});}));
  scenario.enemies.forEach((e,i)=>{const card=el('div',null,'enemy-card');const h=el('div',null,'card-heading');h.append(el('strong',raw.enemies[e.enemyKey].name),button('移除',()=>edit(()=>scenario.enemies.splice(i,1)),'compact'));card.append(h,row(label('数量',number(e.count,1,100,v=>edit(()=>e.count=v),`第${i+1}组数量`)),label('入场 / 秒',number(e.time,0,299,v=>edit(()=>e.time=v),`第${i+1}组入场时间`))),row(label('间隔 / 秒',number(e.interval,0,30,v=>edit(()=>e.interval=v),`第${i+1}组间隔`))),note(raw.enemies[e.enemyKey].desc||'采用该敌人的原有技能。'));enemy.append(card);});
  const bonds=section('04 / 盟约层数',open[3]??false);const states=trainingBonds(scenario,raw);
  bonds.append(note('人数与激活档位按实际布阵、转职装备计算。层数可设0～999，未激活的盟约不会因层数自动生效。'));
  Object.values(raw.bonds).forEach(b=>{const st=states[b.bondId];const line=el('div',null,'bond-row');line.append(el('span',b.name),el('span',`${st?.count||0}人${st?.active?' · 生效':''}`,st?.active?'':'inactive'),number(scenario.layers[b.bondId]||0,0,999,v=>edit(()=>scenario.layers[b.bondId]=v),`${b.name}层数`));bonds.append(line);});
  editor.append(settings,operators,enemy,bonds);
}
function drawGrid() {
  grid.replaceChildren();const d=deployTiles(raw,scenario.stageId,scenario.kind);const u=scenario.units[selected];
  for(let r=9;r<=12;r++)for(let c=2;c<=10;c++){
    const i=scenario.units.findIndex(x=>x.row===r&&x.col===c);const on=i>=0;const valid=u&&legalTiles(raw,scenario,u.chessId).some(p=>p[0]===r&&p[1]===c);
    const b=button(on?`${i+1} ${raw.chess[scenario.units[i].chessId].name}`:`${r},${c}`,()=>{
      if(on){selected=i;drawEditor();drawGrid();return;}
      edit(()=>{u.row=r;u.col=c;});
    },`${d.ranged.some(p=>p[0]===r&&p[1]===c)?'ranged ':''}${on?'occupied ':''}${on&&i===selected?'selected':''}`);
    b.disabled=!!battle||(!valid&&!on);b.title=`布阵格 ${r},${c}`;grid.append(b);
  }
}
function drawPreview() {
  if(!view||battle)return;view.setStage(raw.stages[scenario.stageId]);
  view.setPrep({hand:[],temp:[],board:scenario.units.map((u,i)=>({row:u.row,col:u.col,uid:i+1,kind:'chess',id:u.chessId,items:u.items.map(id=>({id})),dir:u.dir}))},{editable:false});
  view.setCamera('prep',{side:'L',shop:false,instant:true});
}
function renderStats() {
  const r=battle?.result();const values=[battle?`${battle.time.toFixed(1)}s`:'待开始',r?`${r.killed}/${r.total}`:'—',r?.perPlayer?.training?.leaked?.length||0,r?.perPlayer?.training?.unitStats?.reduce((n,u)=>n+u.dmg,0)||0];
  metrics.querySelectorAll('b').forEach((b,i)=>b.textContent=i===3?amount(values[i]):String(values[i]));
  resultBody.replaceChildren();const stats=[...(r?.perPlayer?.training?.unitStats||[])].sort((a,b)=>b.dmg-a.dmg);
  for(const u of stats){const tr=el('tr');[u.name,amount(u.dmg),amount(u.heal),amount(u.taken),u.kills].forEach(v=>tr.append(el('td',String(v))));resultBody.append(tr);}
  if(!stats.length){const tr=el('tr');const td=el('td','开始训练后显示每名干员与召唤物的实时统计');td.colSpan=5;tr.append(td);resultBody.append(tr);}
}
function showHistory(){historyBox.replaceChildren();let list=[];try{list=JSON.parse(storage.getItem(TRAINING_HISTORY_KEY)||'[]');}catch{}if(!Array.isArray(list)||!list.length){historyBox.append(note('暂无本地训练记录。'));return;}for(const x of list.slice(0,10)){historyBox.append(el('p',`${new Date(x.at).toLocaleString('zh-CN')} · ${x.time}s · 击杀 ${x.killed}/${x.total} · 漏怪 ${x.leaked} · ${x.errors?'模拟错误':'本地训练'}`));}}
function feed(){if(!battle)return;const ev=battle.drainEvents();modAdapter.feed(ev,battle.time);if(view){if(ev.length)view.pushEvents({fieldId:'local-training',gt:battle.time,ev});view.pushSnapshot(battle.snapshot());}}
function syncButtons(){startBtn.disabled=!!battle;pauseBtn.disabled=!battle||battle.finished;pauseBtn.textContent=running?'暂停':'继续';stepBtn.disabled=!battle||running||battle.finished;resetBtn.disabled=!battle;for(const control of editor.querySelectorAll('input,select,button'))control.disabled=!!battle;}
function finish(){if(!battle?.finished||finishedSaved)return;finishedSaved=true;running=false;modAdapter.finish();try{saveTrainingResult(storage,summarizeTraining(battle,scenario));showHistory();}catch(e){say(`战斗结束；记录未能保存：${e.message}`,true);syncButtons();return;}say(battle.errorCount?`训练结束，模拟报告 ${battle.errorCount} 个错误，请查看控制台。`:`训练结束：击杀 ${battle.killed}/${battle.total}。结果已保存在本机。`,!!battle.errorCount);syncButtons();renderStats();}
function step(){if(!battle||battle.finished)return;battle.step();if(battle.time>=scenario.seconds&&!battle.finished)battle.forceEnd('timeout');feed();finish();}
function start(){try{scenario=validateScenario(scenario,raw);try{saveTraining(storage,scenario,raw);}catch{}const o=battleOptions(scenario,raw);const spec=sim.spec.buildBattleSpec(o);battle=sim.spec.createBattleFromSpec(spec,ds,{logger:{error(...a){console.error(...a);},warn:console.warn,info(){},debug(){}}});battle.start();modAdapter.start(scenario,battle.fieldMeta());if(view){view.setStage(raw.stages[scenario.stageId]);view.enterBattle(battle.fieldMeta());view.setCamera(scenario.kind,{rect:battle.rect,side:'L',half:scenario.kind==='boss',instant:true});}running=true;finishedSaved=false;budget=0;feed();drawGrid();syncButtons();say('训练运行中 · 本机计算，不计入正式对局记录。');}catch(e){battle=null;running=false;modAdapter.reset();say(e.message,true);syncButtons();}}
function reset(){running=false;modAdapter.reset();battle=null;budget=0;finishedSaved=false;drawGrid();drawPreview();renderStats();syncButtons();say('已返回布阵。修改后可用相同种子重新测试。');}

async function main(){
  const fetched=await Promise.all(DATA_FILES.map(async n=>{const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),30000);try{const r=await fetch(`/data/${n}.json`,{signal:ctl.signal});if(!r.ok)throw new Error(`训练数据 ${n} 加载失败（${r.status}）`);return[n,await r.json()];}finally{clearTimeout(timer);}}));
  raw=Object.fromEntries(fetched);modAdapter.setData(raw);const simUrl='/js/browser/sim.js';sim=await import(simUrl);sim.simdata.setSimData(raw);sim.support.setGameData?.(null);ds=new sim.simdata.DataSource(raw,null);scenario=loadTraining(storage,raw);
  root.replaceChildren();root.setAttribute('aria-busy','false');
  const toolbar=el('div',null,'toolbar');startBtn=button('开始训练',start,'primary');pauseBtn=button('暂停',()=>{running=!running;budget=0;if(running)modAdapter.resume();else modAdapter.pause();syncButtons();say(running?'训练继续。':'已暂停，可单步推进。');});stepBtn=button('单步 +1帧',()=>{step();renderStats();});resetBtn=button('重置战斗',reset);
  toolbar.append(startBtn,pauseBtn,stepBtn,resetBtn,label('速度',select([[.5,'0.5×'],[1,'1×'],[2,'2×'],[4,'4×']],speed,v=>speed=Number(v),'训练速度')),el('span',null,'spacer'),button('保存方案',()=>{try{scenario=saveTraining(storage,scenario,raw);say('训练方案已保存在本机。');}catch(e){say(e.message,true);}}),button('恢复示例',()=>edit(()=>{scenario=defaultScenario(raw);selected=0;say('已恢复示例，可继续自由修改。');})));
  status=el('p','数据已准备就绪，选择干员、装备和敌人后开始。','status');status.setAttribute('role','status');
  const layout=el('div',null,'training-layout');const left=el('section',null,'panel');left.append(el('h2','配装工作台'));editor=el('div',null,'editor');left.append(editor);
  const preview=el('section',null,'preview');const battlePanel=el('div',null,'panel');battlePanel.append(el('h2','战场预览'));board=el('div',null,'board-host');caption=el('div','正在准备战场画面…','board-caption');board.append(caption);battlePanel.append(board);
  const tools=el('div',null,'board-tools');tools.append(note('选中左侧干员，再点击空格部署。格位采用普通棋盘坐标，Boss 战场自动映射。'));grid=el('div',null,'placement-grid');grid.setAttribute('aria-label','训练布阵棋盘');tools.append(grid);battlePanel.append(tools);
  metrics=el('div',null,'metrics');for(const title of ['模拟时间','击杀 / 总数','漏怪','有效伤害']){const m=el('div',null,'metric');m.append(el('b','—'),el('span',title));metrics.append(m);}battlePanel.append(metrics);
  const results=el('div',null,'panel results');results.append(el('h2','训练统计'));const scroll=el('div',null,'table-scroll'),table=el('table'),thead=el('thead'),tr=el('tr');for(const h of ['单位','有效伤害','治疗','承伤','击杀'])tr.append(el('th',h));thead.append(tr);resultBody=el('tbody');table.append(thead,resultBody);scroll.append(table);results.append(scroll);
  const hist=el('details',null,'panel results');hist.append(el('summary','最近训练记录（仅本机）'));historyBox=el('div',null,'history');hist.append(historyBox);preview.append(battlePanel,results,hist);layout.append(left,preview);root.append(toolbar,status,layout,el('p','训练场可直接打开，无需登录。使用当前版本的真实战斗引擎；现有本地资源库继续有效。自选槽位、联防与多人共享血池留待后续训练功能。','training-shell-note'));
  drawEditor();drawGrid();renderStats();showHistory();syncButtons();
  let lastNow=performance.now();function frame(now){const dt=Math.min(.1,(now-lastNow)/1000);lastNow=now;if(running&&battle&&!document.hidden){budget=Math.min(budget+dt*speed,.5);let ticks=0;const startMs=performance.now();while(budget>=1/30&&!battle.finished&&ticks<30&&performance.now()-startMs<10){step();budget-=1/30;ticks++;}}if(now-lastStats>250){lastStats=now;renderStats();}requestAnimationFrame(frame);}requestAnimationFrame(frame);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){running=false;budget=0;modAdapter.pause();syncButtons();say('页面切到后台，训练已自动暂停。');}});
  // This renderer reads static assets only. The network battle runner is intentionally not imported.
  try{const renderUrl='/js/render/app.js',assetsUrl='/js/assets.js';const [{createFieldView},{assets}]=await Promise.all([import(renderUrl),import(assetsUrl)]);await assets.ready();view=await createFieldView(board,{data:raw,assets,settings:{quality:'medium',damageNumbers:true},padding:{top:20,bottom:20,left:20,right:20}});board.append(caption);caption.textContent='真实战斗画面 · 可用资源按需读取';drawPreview();if(battle){view.setStage(raw.stages[scenario.stageId]);view.enterBattle(battle.fieldMeta());view.setCamera(scenario.kind,{rect:battle.rect,side:'L',instant:true});feed();}}catch(e){caption.textContent=`画面暂不可用：${e.message}。训练与统计仍可使用。`;}
}
main().catch(e=>{modAdapter.dispose();root.replaceChildren(el('p',`训练场载入失败：${e.message}。请检查资源或刷新重试。`,'status error'),button('重新加载',()=>location.reload()));root.setAttribute('aria-busy','false');console.error(e);});
