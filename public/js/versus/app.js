import '../ui/compat.js';
import { h, render } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { Icon, Modal } from '../ui/components.js';
import { assets, portraitUrl } from '../assets.js';
import { audio, installAudio } from '../audio.js';
import { settingsStore } from '../ui/settings.js';
import { installDeviceSupport } from '../ui/device.js';
import { createVersusAudioSync, playVersusCommandSound } from './audio.js';
import { createFieldView } from '../render/app.js';
import { Grid } from '/sim/grid.js';
import { FacingWheel } from '../ui/facingWheel.js';
import { boardDir } from '../ui/facing.js';
import { boardAppearance } from '/shared/roomDirectory.js';
import { versusCanStand } from '/shared/versusPlacement.js';
import { versusCameraOptions } from '/shared/versusCamera.js';
import { data as uiData } from '../data.js';
import { VersusShopCard } from './shop.js';
import { DetailPanel } from '../ui/detailPanel.js';
import { Underframe, underframeRect } from '../ui/underframe.js';
import { panelSide, panelSlots } from '../ui/gameLogic/panel.js';
import { resultBonds } from '../ui/gameLogic/result.js';
import { EquipReplaceDialog } from '../ui/equipReplace.js';
import { ShopBar, armKey } from '../ui/shopBar.js';
import { createDragController } from '../render/drag.js';
import { BondStrip, BondPopup } from '../ui/bondStrip.js';
import { versusBondRecord } from '/shared/versusBonds.js';
import { VERSUS_RULES } from '/shared/versusRules.js';
import { detailUnit, monsterPreview } from './details.js';
import { resourceDocumentUrl, waitForResourceController, requireLocalResourceController } from '../resources/client.js';
import { t } from '../../../shared/i18n.js';

async function bootVersus() {
const canonical = resourceDocumentUrl(location.href, performance.getEntriesByType('navigation')[0]?.name, globalThis.__SP_GENERATION);
if (canonical) { location.reload(); return; }
await requireLocalResourceController();
await waitForResourceController();
const html = htm.bind(h);
installDeviceSupport();
let latest = null, view = null, selected = null, updateApp = null, showError = null, openDetail = null, socket = null;
let fieldId = null, attempt = 0, stopped = false, pendingSelection = null;
let focusId = null;
const embedded = new URLSearchParams(location.search).has('embedded');
let embeddedOnline = false, setFacing = null, overview = false;
let drag = null, ghost = null, pressedPiece = null, equipTarget = null;
const online = () => embedded ? embeddedOnline : socket?.readyState === 1;
const knownUnits = new Set();
const response = await fetch('/versus/catalog');
if (!response.ok) throw new Error('无法加载对抗目录');
const config = await response.json();
let grid = new Grid(config.stage, config.rect);
const cards = new Map(config.catalog.map(c => [c.id, c]));
const gameData = {};
for (const name of ['chess', 'enemies', 'items', 'tokens', 'bonds', 'assets']) {
  gameData[name] = await uiData.load(name);
  if (!gameData[name]) throw new Error(`无法加载 ${name}`);
}
gameData.stages = config.stages;
assets.seed(gameData.assets);
const syncAudio = embedded ? null : createVersusAudioSync(audio);
if (!embedded) installAudio({ getManifest: () => gameData.assets, getChess: () => gameData.chess, settings: settingsStore.get() });
for (const event of ['pointerdown', 'keydown', 'touchend']) addEventListener(event, () => {
  if (embedded) parent.postMessage({ type: 'versus-gesture' }, location.origin);
}, { capture: true, passive: true });
const image = card => !card ? null : card.kind === 'monster' ? assets.enemyIcon(card.id)
  : card.kind === 'equipment' ? assets.itemIcon(gameData.items[card.id] || card.id) : assets.avatar(card.avatar);
const clock = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
function send(action, payload = {}) {
  if (!online()) { showError?.(t('连接未就绪')); return; }
  if (embedded) { parent.postMessage({ type: 'versus-command', command: { action, ...payload } }, location.origin); return; }
  socket.send(JSON.stringify({ action, ...payload }));
}
function receive(packet) {
  if (!packet) return;
  if (packet.type === 'error') showError?.(packet.message);
  if (packet.type === 'ack') {
    if (!embedded) playVersusCommandSound(audio, packet.action);
    if (['deploy', 'move', 'withdraw', 'equip', 'sell'].includes(packet.action)) { selected = null; openDetail?.(null); setFacing?.(null); view?.highlightTiles([], { group: 'select' }); }
    updateApp?.(latest, online());
  }
  if (packet.type !== 'state') return;
  latest = packet; syncAudio?.(packet); updateApp?.(packet, online()); syncField();
  if (selected?.kind === 'monster' && !packet.me.monsters[selected.id]) { selected = null; highlight(); }
  if (selected?.kind === 'operator' && !packet.me.operators.some(o => o.uid === selected.uid && o.id === selected.id)) {
    selected = null; cancelDrag(); setFacing?.(null); highlight();
  }
}
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/versus/socket`);
  socket.addEventListener('open', () => {
    attempt = 0; updateApp?.(latest, true);
    const token = sessionStorage.getItem('versusToken'); if (token) send('resume', { token });
  });
  socket.addEventListener('message', e => {
    const packet = JSON.parse(e.data);
    if (packet.type === 'joined') sessionStorage.setItem('versusToken', packet.token);
    if (packet.type === 'error') {
      if (packet.message.includes('会话已失效')) { sessionStorage.removeItem('versusToken'); latest = null; updateApp?.(null, true); }
      showError?.(packet.message);
    }
    receive(packet);
  });
  socket.addEventListener('close', e => {
    updateApp?.(latest, false);
    if (e.code === 4001) { stopped = true; showError?.(t('另一页面已接管这个玩家')); }
    if (!stopped) setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++));
  });
}
function camera() {
  const field = document.querySelector('.field')?.getBoundingClientRect();
  const bonds = document.querySelector('.shell .gm__bond-list:not([hidden])')?.getBoundingClientRect();
  // Native prep cameras clear the bond strip's actual bottom edge, including its touch targets.
  const hudTop = field && bonds?.height > 0 ? Math.max(0, bonds.bottom - field.top + 8) : 0;
  view?.setCamera('boss',versusCameraOptions({width:innerWidth,rect:config.rect,side:latest?.field?.side||'L',overview,hudTop}));
}
function decorated(info) {
  return info.sourcePlayerId ? { ...info, outlineColor: info.sourcePlayerId === latest?.me.id ? 0x54baff : 0xff596c } : info;
}
function syncField() {
  if (!view || !latest?.field) return;
  const focus = latest.field;
  if (focusId !== focus.meta.fieldId) { overview = false; focusId = focus.meta.fieldId; selected = focus.playerId === latest.me.id ? pendingSelection : null; pendingSelection = null; }
  const field = overview && focus.overview ? { ...focus, ...focus.overview } : focus;
  if (fieldId !== field.meta.fieldId) {
    cancelDrag();
    const stage = gameData.stages[field.meta.stageId] || config.stage;
    grid = new Grid(stage, config.rect); view.setStage(stage);
    fieldId = field.meta.fieldId; view.enterBattle({ ...field.meta, units: field.meta.units.map(decorated) });
    knownUnits.clear(); for (const unit of field.meta.units) knownUnits.add(unit.id);
    camera(); setFacing?.(null);
    view.setLocalFeed({ on: true, speed: 2 });
    highlight();
  }
  const discovered = [];
  const announced = new Set(field.events.filter(e => e[0] === 'spawn').map(e => e[1].id));
  for (const unit of field.meta.units) if (!knownUnits.has(unit.id)) {
    knownUnits.add(unit.id); if (!announced.has(unit.id)) discovered.push(['spawn', decorated(unit)]);
  }
  view.pushEvents({ fieldId, ev: [...discovered, ...field.events.map(e => e[0] === 'spawn' ? ['spawn', decorated(e[1])] : e)], gt: field.snapshot.t });
  view.pushSnapshot(field.snapshot, { replaceSameTime: true });
  view.updateBattleItems(field.meta.units);
  view.highlightTiles(overview ? field.routes?.at(-1)?.cells || [] : [], { color: 0x54baff, fill: 0.12, line: 0.7, group: 'route' });
  highlight();
}
function legalTiles() {
  if (!selected || selected.kind === 'equipment' || !latest?.field || latest.field.playerId !== latest.me.id || latest.me.side == null) return [];
  if (selected.kind === 'operator' && latest.me.role !== 'defend' || selected.kind === 'monster' && latest.me.role !== 'attack') return [];
  const cells = [], side = latest.me.side;
  for (let row = 2; row <= 5; row++) {
    const columns = selected.kind === 'monster' ? latest.me.launchColumns || [8,9].map(c => side === 'R' ? 20-c : c)
      : Array.from({ length: 7 }, (_, i) => side === 'R' ? 17-i : i+3);
    for (const c of columns) {
      const card = cards.get(selected.id);
      if (selected.kind === 'operator' && !versusCanStand(grid, gameData.stages[latest.field.meta.stageId], row, c, gameData.chess[card.id])) continue;
      if (selected.kind === 'monster' && !grid.groundPassable(row, c)) continue;
      cells.push([row, c]);
    }
  }
  return cells;
}
function highlight() {
  view?.highlightTiles(legalTiles(), { color: selected?.kind === 'monster' ? 0xff6478 : 0x58e0b8, fill: 0.22, line: 0.85, group: 'select' });
}
function choose(piece, kind, toggle = true) {
  setFacing?.(null);
  selected = toggle && selected?.uid === piece.uid && kind !== 'monster' ? null : { ...piece, kind };
  if (selected && latest?.field?.playerId !== latest?.me.id) {
    pendingSelection = selected; selected = null;
    send('watch', { id: latest.room.players.find(p => p.id === latest.me.id).duel, playerId: latest.me.id });
  }
  highlight(); updateApp?.(latest, online());
}
function place(tile) {
  if (!tile || !online() || !selected || latest?.room?.players.find(p => p.id === latest.me.id)?.eliminated) return;
  if (selected.kind === 'equipment') {
    const own = operatorAt(tile); if (own) equipTarget?.(own, selected); return;
  }
  if (selected.kind === 'operator' && selected.row != null && tile.row < 2) { send('withdraw', { uid: selected.uid }); return; }
  if (!legalTiles().some(([r,c]) => r === tile.row && c === tile.col)) { showError?.(t('这里不能放置')); return; }
  openDetail?.(null);
  if (selected.kind === 'operator') {
    const current = latest.me.operators.find(o => o.uid === selected.uid);
    const moved = current?.row != null && (current.row !== tile.row || (latest.me.side === 'R' ? 20 - current.col : current.col) !== tile.col);
    setFacing?.({ ...selected, row: tile.row, col: tile.col, action: moved ? 'move' : current?.row == null ? 'deploy' : 'rotate' });
  }
  if (selected.kind === 'monster') send('launch', { id: selected.id, row: tile.row, col: tile.col });
}
function cancelDrag() {
  dragController.reset();
  drag = null; ghost?.remove(); ghost = null;
  view?.highlightTiles([], { group: 'drop' });
}
function startDrag(e, piece) {
  if (e.button !== 0 || drag || !piece || !['preparation','combat'].includes(latest?.room.status) || latest.room.players.find(p=>p.id===latest.me.id)?.eliminated) return;
  pressedPiece = piece;
  dragController.setEditable(true);
  const consumed = dragController.pointerDown(pointer(e));
  pressedPiece = null;
  if (!consumed) return;
  drag = { id: e.pointerId, piece, moved: false, element: e.currentTarget };
  e.currentTarget.setPointerCapture?.(e.pointerId);
}
function pointer(e) { return { pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY }; }
function operatorAt(tile) {
  if (!tile || latest?.field?.playerId !== latest?.me.id) return null;
  const field = overview ? latest.field.overview : latest.field;
  const unit = field?.meta.units.find(u => u.side === 'ally' && Math.round(u.y) === tile.row && Math.round(u.x) === tile.col && latest.me.operators.some(o => o.uid === u.uid));
  return latest.me.operators.find(o => o.uid === unit?.uid);
}
const dragController = createDragController({
  geo: { HAND_ROW: 0, HAND_SIZE: 21, TEMP_ROW: -1, TEMP_C0: 0, TEMP_SIZE: 0, FIELD: { r0: 1, r1: 5, c0: 2, c1: 18 } },
  hitPiece: () => pressedPiece,
  pickTile: (x, y) => view?.tileAt(x, y),
  isOverCanvas: (x, y) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
  canPlace: (piece, row, col) => piece.kind === 'equipment' ? !!operatorAt({ row, col })
    : piece.kind === 'operator' && piece.row != null && row < 2 || legalTiles().some(([r,c]) => row === r && col === c),
  emit: (type, event) => {
    if (type === 'pieceDragStart') {
      drag.moved = true; choose(event.piece, event.piece.kind, false); openDetail?.(null);
      ghost = document.createElement('img'); ghost.className = 'drag-ghost'; ghost.alt = ''; ghost.src = image(cards.get(event.piece.id)); document.body.append(ghost);
    }
    if (type === 'pieceDragMove' && ghost) {
      ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`;
      view?.highlightTiles(event.legal && event.target?.area === 'board' ? [[event.target.row,event.target.col]] : [], { group: 'drop', color: 0xffffff, fill: 0.3, line: 1 });
    }
    if (type === 'pieceDrop') {
      if (event.target.area === 'hand') send('withdraw', { uid: event.uid });
      else if (event.target.area === 'board') place(event.target);
      else {
        const el = document.elementFromPoint(event.target.clientX, event.target.clientY)?.closest('.bench-card');
        const own = latest.me.operators.find(o => String(o.uid) === el?.dataset.uid);
        if (event.piece.kind === 'equipment' && own) equipTarget?.(own, event.piece);
        else if (event.piece.kind === 'operator' && event.piece.row != null && el) send('withdraw', { uid: event.uid });
      }
    }
  },
});
addEventListener('pointermove', e => { if (drag?.id === e.pointerId) { dragController.pointerMove(pointer(e)); if (drag.moved) e.preventDefault(); } }, { passive: false, capture: true });
addEventListener('pointerup', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const moved = drag.moved, element = drag.element, piece = drag.piece;
  dragController.pointerUp(pointer(e));
  if (moved) {
    // Consume only the click generated by this drag, never the next intentional tap.
    const swallow = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    element.addEventListener('click', swallow, { once: true, capture: true });
    setTimeout(() => element.removeEventListener('click', swallow, true), 0);
  }
  cancelDrag();
  if (moved && piece.kind === 'operator' && piece.row != null) { selected = null; highlight(); updateApp?.(latest, online()); }
  if (!moved && element.tagName === 'CANVAS') { if (selected?.kind === 'equipment') equipTarget?.(piece, selected); else { selected = null; highlight(); openDetail?.(piece); } }
}, { capture: true });
addEventListener('pointercancel', cancelDrag);
addEventListener('blur', cancelDrag);
addEventListener('keydown', e => { if (e.key === 'Escape') cancelDrag(); });
function IconButton({ name, label, onClick, disabled, class: cls = '' }) {
  return html`<button class=${`icon-button ${cls}`} title=${label} aria-label=${label} onClick=${onClick} disabled=${disabled}><${Icon} name=${name}/></button>`;
}
function Card({ card, onClick, disabled, count, bench = false, active = false, piece = null, poor = false, index = null }) {
  if (!card) return html`<div class="sold">${t('已售出')}</div>`;
  const url = !bench && card.kind === 'operator' ? portraitUrl(gameData.assets, card.avatar, { e2: card.isGolden }) || image(card) : image(card);
  const copies = card.kind === 'operator' ? latest?.me.operators.filter(o => o.id === card.id).length || 0 : 0;
  return html`<button class=${`${bench ? 'bench-card' : 'shop-card'} ${card.kind} ${card.isGolden ? 'elite' : ''} ${active ? 'active' : ''} ${poor ? 'poor' : ''}`} onClick=${onClick} disabled=${disabled}
    data-tier=${card.tier} data-id=${card.id} data-shop-index=${index} data-uid=${piece?.uid} onPointerDown=${bench && !disabled ? e => startDrag(e, piece) : null}
    onLostPointerCapture=${e => { if (drag?.id === e.pointerId) cancelDrag(); }}
    title=${`${card.name}${bench ? '' : t(' · {price} 金币', { price: card.price })}${card.kind === 'monster' && card.desc ? `\n${card.desc}` : ''}`} aria-label=${`${bench ? t('选择') : t('购买')}${card.name}`}>
    ${url && html`<img src=${url} alt="" loading="lazy" draggable="false"/>`}
    ${bench ? html`<span>${card.name}</span>${card.isGolden ? html`<b>${t('精锐')}</b>` : count > 1 && html`<b>×${count}</b>`}` : html`<div class="card-text"><span class="card-name">${card.name}</span>
      ${card.kind === 'monster' && html`<b class="card-quantity">×${card.quantity}</b>`}
      ${active && html`<span class="buy-confirm">${poor ? t('金币不足') : t('确认购买')}</span>`}
      <span class="card-detail">${card.kind === 'operator' ? card.bonds.map(id => gameData.bonds[id]?.name).join(' / ') : card.kind === 'monster' ? t('{0} · 生命 {maxHp}', { 0: card.stats.motion === 'FLY' ? t('飞行') : t('地面'), maxHp: card.stats.maxHp }) : card.desc}</span>
      <span class="card-price">${card.price}</span><small class="card-tier">${['','I','II','III','IV','V','VI'][card.tier]}</small>
      ${card.kind === 'operator' && html`<span class="card-bonds">${card.bonds.map(id => html`<img src=${assets.bondIcon(id)} alt=${gameData.bonds[id]?.name} title=${gameData.bonds[id]?.name}/>` )}</span>
        ${copies > 0 && html`<span class="merge-pips" title=${t('已拥有 {copies}/3', { copies })}>${[0,1,2].map(i => html`<i class=${i < copies ? 'on' : ''}></i>`)}</span>`}`}</div>`}
  </button>`;
}
function App() {
  const [packet, setPacket] = useState(latest), [connected, setConnected] = useState(online());
  const [facing, changeFacing] = useState(null);
  const [name, setName] = useState(localStorage.getItem('versusName') || t('博士')), [code, setCode] = useState(new URLSearchParams(location.search).get('room') || '');
  const [roster, setRoster] = useState(false), [bracket, setBracket] = useState(false), [detail, setDetail] = useState(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [replacement, setReplacement] = useState(null), [rewardLater, setRewardLater] = useState(false);
  const [armed, setArmed] = useState(null), [benchPage, setBenchPage] = useState(0);
  const [bondOpen, setBondOpen] = useState(null);
  const [bondsCollapsed, setBondsCollapsed] = useState(innerWidth <= 1000);
  const bondsHost = useRef(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const benchHost = useRef(null);
  const [confirm, setConfirm] = useState(false), [toast, setToast] = useState(''), [loading, setLoading] = useState(true);
  const [shopFolded, setShopFolded] = useState(innerWidth <= 1000 && innerHeight <= 450);
  const host = useRef(null), toastTimer = useRef(null);
  const settled = packet?.room?.history.findLast(entry => entry.players.includes(packet.me.id));
  const settlementKey = packet?.room?.status === 'complete' ? 'complete' : settled?.id;
  useEffect(() => { if (settlementKey) setResultOpen(true); }, [settlementKey]);
  updateApp = (value, online) => { setPacket(value && { ...value }); setConnected(online); };
  showError = message => { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4500); };
  openDetail = piece => { setArmed(null); setDetail(piece); };
  equipTarget = (own, item) => {
    if (own.items.length >= 2 && gameData.items[item.id]?.kind !== 'consume_on_equip') setReplacement({ targetUid: own.uid, targetId: own.id, targetName: cards.get(own.id)?.name,
      golden: cards.get(own.id)?.isGolden, item: { ...item, name: cards.get(item.id)?.name }, options: own.items.map((id, i) => ({ uid: i, id, name: gameData.items[id]?.name })) });
    else send('equip', { uid: own.uid, itemUid: item.uid });
  };
  setFacing = changeFacing;
  const mapVersion = packet?.room.mapVersion || 'new';
  useEffect(() => {
    let active = true;
    fieldId = null; knownUnits.clear(); setLoading(true);
    createFieldView(host.current, { data: gameData, assets, ...boardAppearance(mapVersion), settings: settingsStore.get(),
      padding: { left: 8, right: 8, top: 53, bottom: 34 } }).then(v => {
      if (!active) { v.destroy(); return; }
      view = v; v.setStage(config.stage); v.enterBattle({ fieldId: 'preview', kind: 'boss', rect: config.rect, stageId: config.stage.id, units: [] });
      v.setCamera('boss', { rect: { ...config.rect, r0: 2 }, side: 'L', half: true, instant: true, shop: false, fit: true, margin: 0.3, headroom: 0.65, padding: { left: 8, right: 8, top: 43, bottom: 27 } });
      v.on('tileClick', tile => {
        if (selected) place(tile); else openDetail?.(null);
      });
      v.on('pieceClick', e => {
        const own = latest?.field?.playerId === latest?.me.id && e.unit?.ownerId === latest?.me.id
          ? latest?.me.operators.find(o => o.uid === e.uid || o.uid === e.unit?.uid) : null;
        if (!own) {
          if (['op', 'enemy'].includes(e.unit?.kind)) {
            selected = null; highlight();
            openDetail?.({ id: e.unit.defId, uid: e.uid, unitId: e.unitId, fieldId: latest.field.meta.fieldId,
              items: e.unit.items || [], readOnly: true });
          }
          return;
        }
        if (selected?.kind === 'equipment') equipTarget?.(own, selected);
        else { selected = null; highlight(); openDetail?.({ ...own, unitId: e.unitId, fieldId: latest.field.meta.fieldId }); }
      });
      const canvas = host.current.querySelector('canvas[aria-label]');
      canvas.addEventListener('pointerdown', e => {
        if (latest?.field?.playerId !== latest?.me.id) return;
        const unit = v.unitAt(e.clientX, e.clientY), own = unit?.ownerId === latest?.me.id
          ? latest?.me.operators.find(o => o.uid === unit?.uid) : null;
        if (!own) return;
        startDrag(e, { ...own, kind: 'operator' });
        e.stopImmediatePropagation();
      }, true);
      setLoading(false); syncField();
      window.__versusView = v;
    }).catch(e => { setLoading(false); showError(t('战场加载失败：{message}', { message: e.message })); });
    return () => { active = false; view?.destroy(); view = null; };
  }, [mapVersion]);
  useEffect(() => settingsStore.subscribe(settings => view?.setSettings(settings)), []);
  useEffect(() => {
    const onResize = () => { cancelDrag(); requestAnimationFrame(camera); };
    addEventListener('resize', onResize); return () => removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const root = bondsHost.current, workspace = host.current;
    if (!root || !workspace) return;
    let raf;
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(camera); };
    const observer = new ResizeObserver(update);
    observer.observe(root); observer.observe(workspace);
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [bondsCollapsed]);
  useEffect(() => {
    const dismiss = e => {
      if (e.target.closest('.dpanel,.uframe,.bench-card,.scard,.fwheel,.eqr,.versus-reward')) return;
      if (e.target.tagName === 'CANVAS' && view?.unitAt(e.clientX, e.clientY)) return;
      setDetail(null); setArmed(null);
    };
    const escape = e => { if (e.key === 'Escape') { setDetail(null); setArmed(null); selected = null; highlight(); changeFacing(null); } };
    document.addEventListener('pointerdown', dismiss, true); addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss, true); removeEventListener('keydown', escape); };
  }, []);
  const room = packet?.room, me = packet?.me, my = room?.players.find(p => p.id === me.id);
  const duel = room?.duels.find(d => d.id === packet?.field?.duelId);
  const pair = duel?.players.map(id => room.players.find(p => p.id === id));
  const left = pair?.find(p => p.side === 'L'), right = pair?.find(p => p.side === 'R');
  const focusedId = packet?.field?.playerId;
  useEffect(() => { setDetail(null); setArmed(null); }, [packet?.field?.meta.fieldId]);
  const fieldBonds = packet?.field?.bonds || me?.bonds || {};
  const bondEntries = Object.entries(fieldBonds).filter(([, b]) => b.count > 0).map(([bondId, b]) => ({ bondId, ...b }));
  const portrait = p => p && html`<button class=${`player-avatar ${focusedId === p.id ? 'active' : ''}`} aria-label=${t('查看{name}的战场', { name: p.name })} aria-pressed=${focusedId === p.id}
    title=${p.name} style=${{ borderColor: p.color, color: p.color }} onClick=${() => { overview = false; send('watch', { id: p.duel, playerId: p.id }); camera(); }}>${p.initial}</button>`;
  const ownDuel = room?.duels.find(d => d.players.includes(me.id));
  const editable = connected && !!room && !packet?.spectator && !my?.eliminated && ['preparation','combat'].includes(room.status) && !ownDuel?.done;
  const deployable = editable && room.status !== 'lobby';
  const cardOf = id => cards.get(id) || (gameData.items[id] && { ...gameData.items[id], kind: 'equipment' })
    || (gameData.enemies[id] && { ...gameData.enemies[id], id, kind: 'monster' });
  const selectedCard = selected ? cardOf(selected.id) : null;
  const detailCard = detail ? cardOf(detail.id) : null;
  const detailPiece = detailCard?.kind === 'operator' && !detail.shop && !detail.readOnly ? me?.operators.find(o => o.uid === detail.uid) : detail;
  const liveDetail = detailUnit(packet, detail, overview)?.live || (!detail?.readOnly ? monsterPreview(detailCard, duel?.power) : null);
  const nativeDetail = !detailCard || !detailPiece ? null : detailCard.kind === 'operator' ? { type: 'chess', chess: gameData.chess[detailCard.id],
    piece: detail.shop ? null : { ...detailPiece, kind: 'chess', items: (detailPiece.items || []).map((id, i) => typeof id === 'string' ? ({ id, uid: i }) : id) },
    garrisons: (detailCard.traits || []).map((t, i) => ({ garrisonId: `versus:${i}`, eventTypeDesc: t('对抗模式（测试）'), descRaw: `${t.desc}\n${t.ready ? t.conversion : t('验收版暂未接入')}` })) }
    : detailCard.kind === 'monster' ? { type: 'enemy', enemy: gameData.enemies[detailCard.id], count: detail.shop ? detailCard.quantity : detail.readOnly ? null : me.monsters[detail.id] }
    : { type: 'item', item: gameData.items[detailCard.id], piece: detail };
  const sellCount = detailCard?.kind === 'monster' ? Math.min(detailCard.quantity, me?.monsters[detail.id] || 0) : 1;
  const sellValue = detailCard?.kind === 'monster' ? Math.floor(detailCard.price * sellCount / detailCard.quantity) : 1;
  const bench = !me ? [] : [...me.operators.filter(o => o.row == null).map(o => ({ ...o, kind: 'operator' })),
    ...Object.entries(me.monsters).map(([id, count]) => ({ id, uid: id, count, kind: 'monster' })),
    ...me.items.map(o => ({ ...o, kind: 'equipment' }))];
  const pages = Math.max(1, Math.ceil(bench.length / 12)), pageIndex = Math.min(benchPage, pages - 1);
  const detailSlot = bench.slice(pageIndex * 12, pageIndex * 12 + 12).findIndex(pc => pc.uid === detailPiece?.uid);
  const detailRow = detailPiece?.row ?? (detailSlot < 7 ? 0 : 1);
  const detailCol = detailPiece?.col ?? (detailSlot < 7 ? detailSlot + 3 : detailSlot - 7 + 4);
  const detailSide = detailPiece?.row != null ? me?.side : packet?.field?.side;
  const detailWorldCol = detailSide === 'R' ? 20 - detailCol : detailCol;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const detailDock = panelSide(!detail?.shop && !detail?.readOnly
    ? underframeRect(view?.tileScreen(detailRow, detailWorldCol), rem) : null,
    panelSlots({ width: innerWidth, height: innerHeight }, rem, { shopOpen: !shopFolded }));
  const roleOffers = (me?.role === 'attack' ? ['monster'] : ['operator','equipment']).flatMap(kind=>(me?.shop[kind] || []).map((id,index)=>({kind,id,index})));
  const nativePriv = { hand: Array.from({length:16},(_,i)=>me?.operators.filter(o=>o.row==null).map(o=>({...o,kind:'chess'}))[i]||null), board: me?.operators.filter(o => o.row != null).map(o => ({ ...o, kind: 'chess' })) || [], loadout: me?.loadout, funds: me?.coins, deployCap: me?.role==='attack'?0:8, deployCount: me?.operators.filter(o => o.row != null).length || 0,
    shop: { level: me?.level || 1, upgradePrice: me?.upgrade?.price ?? 10, refreshPrice: 1, freeRefreshes: me?.freeRefresh,
      bonusChessSlots: Math.max(0, roleOffers.filter(o => o.kind !== 'equipment').length - 5),
      slots: roleOffers.map(o => ({ kind: o.kind === 'equipment' ? 'item' : 'chess', id: o.id, sold: !o.id, price: cards.get(o.id)?.price || 0 })) } };
  useEffect(() => { setRewardLater(false); }, [me?.rewardOffer?.slots?.map(s => s.id).join(':')]);
  useEffect(() => {
    view?.setBattleBench(focusedId === me?.id ? bench.slice(pageIndex * 12, pageIndex * 12 + 12).map((pc, slot) => {
      const col = slot < 7 ? slot + 3 : slot - 7 + 4;
      return { ...pc, kind: pc.kind === 'operator' ? 'chess' : pc.kind === 'monster' ? 'enemy' : 'item',
        tier: cards.get(pc.id)?.tier, row: slot < 7 ? 0 : 1, col: packet.field.side === 'R' ? 20 - col : col };
    }) : []);
  });
  useEffect(() => {
    let raf;
    const project = () => {
      const host = benchHost.current, bounds = host?.getBoundingClientRect();
      if (host && view && latest?.field) for (const el of host.querySelectorAll('[data-slot]')) {
        const slot = Number(el.dataset.slot), row = slot < 7 ? 0 : 1, localCol = slot < 7 ? slot + 3 : slot - 7 + 4;
        const pos = view.tileScreen(row, latest.field.side === 'R' ? 20 - localCol : localCol);
        if (!pos) continue;
        const size = Math.max(30, Math.min(76, pos.s * 0.82));
        Object.assign(el.style, { left: `${pos.x - bounds.x}px`, top: `${pos.y - bounds.y}px`, width: `${size}px`, height: `${size * 1.03}px` });
      }
      raf = requestAnimationFrame(project);
    };
    raf = requestAnimationFrame(project); return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (armed && armed.kind !== 'reward' && me?.shop[armed.kind]?.[armed.index] !== armed.id) { setArmed(null); setDetail(d => d?.shop ? null : d); }
  }, [me?.shop, armed]);
  const saveName = () => localStorage.setItem('versusName', name);
  const create = () => { saveName(); setRoster(true); send('create', { name }); };
  const join = () => { saveName(); setRoster(true); send('join', { name, code }); };
  const restart = () => { if (embedded) { send('return'); return; } stopped = true; sessionStorage.removeItem('versusToken'); location.href = '/versus.html'; };
  const statusText = !room ? t('未加入') : my?.eliminated && room.status !== 'complete' ? t('已淘汰 · 观战中') : room.status === 'lobby' ? t('等待开局') : room.status === 'info' ? t('确认信息') : ownDuel?.preparing ? t('攻守整备') : room.status === 'complete' ? t('对抗结束') : ownDuel?.done ? t('等待晋级') : me?.role==='attack'?t('攻方 · 交战中'):t('守方 · 交战中');
  const resultPlayers = room?.results || settled?.results || [];
  return html`<main class=${`shell role-${me?.role || 'defend'} ${shopFolded ? 'shop-folded' : ''}`} style=${{ '--unit-slots': Math.max(1, roleOffers.filter(o => o.kind !== 'equipment').length) }}>
    <header class="topbar"><div class="battle-time" aria-label=${t('对抗进度')}><span class="build-tag">${t('测试')}</span><span class=${my?.eliminated ? 'eliminated-status' : ''}>${statusText}</span><strong>${duel?.preparing || clock(duel?.remaining ?? 480)}</strong><span class="power">${t('第')}${duel?.leg || 1}${t('/2段 · 怪物生命 ×')}${(duel?.power.hp || 1).toFixed(2)}</span></div>
      <div class="top-end">${!connected && html`<small class="reconnect">${t('连接中')}</small>`}
        <button class="versus-rules-button" aria-label=${t('对抗模式规则')} title=${t('对抗模式规则（测试版）')} onClick=${() => setRulesOpen(true)}><${Icon} name="book"/><span>${t('规则')}</span></button>
        <${IconButton} name=${shopFolded ? 'book' : 'collapse'} label=${shopFolded ? t('展开商店') : t('收起商店')} onClick=${() => setShopFolded(!shopFolded)}/>
        ${room?.status === 'lobby' && html`<button onClick=${() => setRoster(true)}><${Icon} name="users"/>${room.players.length}/4</button>`}
        <${IconButton} name="eye" label=${t('淘汰赛与观战')} onClick=${() => setBracket(!bracket)} disabled=${!room?.round}/>
        <${IconButton} name="expand" label=${t('全屏')} onClick=${() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})}/>
        <${IconButton} name="exit" label=${room?.status === 'complete' ? t('返回房间') : my?.eliminated || packet?.spectator ? t('退出观战') : t('认输')} onClick=${() => room?.status === 'complete' ? restart() : my?.eliminated || packet?.spectator ? embedded ? send('leave') : restart() : setConfirm(true)} disabled=${!deployable && !my?.eliminated && !packet?.spectator && room?.status !== 'complete'}/>
      </div>
    </header>
    <section class="workspace" aria-label=${t('对抗战场')}>
      <div class="field" ref=${host}></div>
      <div class="field-tools"><button class=${overview ? 'active' : ''} title=${overview ? t('返回局部地图') : t('查看完整战场')} aria-label=${t('大地图')} aria-pressed=${overview} disabled=${!packet?.field} onClick=${() => { overview = !overview; camera(); syncField(); setPacket({ ...packet }); }}><${Icon} name="search"/><span>${overview ? t('局部') : t('大地图')}</span></button>
        ${settled && html`<button aria-label=${t('查看对抗结算')} title=${t('对抗结算')} onClick=${() => setResultOpen(true)}><${Icon} name="crown"/><span>${t('结算')}</span></button>`}</div>
      ${loading && html`<div class="finish-banner">${t('战场加载中…')}</div>`}
      <div class="field-labels">
        <div class="gate">${portrait(left)}<div class="gate-info"><div class="gate-name"><span>${left?.name || t('左侧')}${left?.id === me?.id ? t(' · 你') : ''}</span><strong>${left?.role==='attack'?t('攻'):left?.hp ?? 20}</strong></div><div class="hp-track"><i style=${{ width: `${left?.role==='attack'?0:(left?.hp ?? 20) * 5}%` }}></i></div></div></div>
        <div class="gate enemy"><div class="gate-info"><div class="gate-name"><span>${right?.name || t('右侧')}${right?.id === me?.id ? t(' · 你') : ''}</span><strong>${right?.role==='attack'?t('攻'):right?.hp ?? 20}</strong></div><div class="hp-track"><i style=${{ width: `${right?.role==='attack'?0:(right?.hp ?? 20) * 5}%` }}></i></div></div>${portrait(right)}</div>
      </div>
      ${room?.round > 0 && html`<aside class="player-list" aria-label=${t('玩家视角')}><div class="watch-roster">${room.players.map(p => html`<button class=${focusedId === p.id ? 'active' : ''} aria-label=${t('查看{name}的战场', { name: p.name })} title=${p.name} disabled=${!room.duels.some(d => d.id === p.duel)} style=${{ borderLeft: `3px solid ${p.color || '#777'}` }} onClick=${() => { overview = false; send('watch', { id: p.duel, playerId: p.id }); camera(); }}><b style=${{ color: p.color }}>${p.initial}</b><span>${p.name}</span><small>${p.eliminated ? t('败') : p.hp}</small></button>`)}</div></aside>`}
      ${selectedCard && html`<div class="selection-note"><span>${selectedCard.name}</span><small>${selected.kind === 'monster' ? t('前沿投放') : selected.kind === 'equipment' ? t('装备') : t('待部署')}</small><${IconButton} name="close" label=${t('取消选择')} onClick=${() => { selected = null; highlight(); setPacket({ ...packet }); }}/></div>`}
      ${room?.status === 'complete' && html`<div class="finish-banner"><h2><${Icon} name="crown"/> ${room.players.find(p => p.id === room.champion)?.name}</h2><p>${t('最终胜者')}</p></div>`}
      <section class="inventory" aria-label=${t('备战区')} ref=${benchHost} hidden=${focusedId !== me?.id}>
        <div class="bench">${bench.slice(pageIndex * 12, pageIndex * 12 + 12).map((piece, slot) => html`<div class="bench-slot" data-slot=${slot} key=${piece.uid}>
          <${Card} piece=${piece} card=${cards.get(piece.id) || (gameData.items[piece.id] && { ...gameData.items[piece.id], kind: 'equipment' })} bench=${true} count=${piece.count} disabled=${!deployable} active=${selected?.uid === piece.uid} onClick=${() => { if (selected?.kind === 'equipment' && piece.kind === 'operator') equipTarget(piece, selected); else { choose(piece, piece.kind); openDetail(piece); } }}/>
        </div>`)}</div>
        ${pages > 1 && html`<div class="bench-pages"><${IconButton} name="chevronLeft" label=${t('上一页备战区')} disabled=${pageIndex === 0} onClick=${() => setBenchPage(pageIndex - 1)}/><span>${pageIndex + 1}/${pages}</span><${IconButton} name="chevronRight" label=${t('下一页备战区')} disabled=${pageIndex === pages - 1} onClick=${() => setBenchPage(pageIndex + 1)}/></div>`}
      </section>
      ${bracket && html`<aside class="bracket"><h3>${t('淘汰赛 ·')} ${room.round ? [t('4 进 2'),t('2 进 1')][room.round - 1] : t('等待开局')}</h3>
        ${room.duels.map(d => html`<button class=${`duel-row ${duel?.id === d.id ? 'active' : ''}`} onClick=${() => send('watch', { id: d.id })}>${d.players.map(id => { const p = room.players.find(p => p.id === id); return html`<span class=${d.winner === id ? 'winner' : ''}>${p.name}<b>${d.winner === id ? t('胜') : p.hp}</b></span>`; })}</button>`)}
        ${room.history.length > 0 && html`<h3 style="margin-top:14px">${t('已结束')}</h3>`}${room.history.map(entry => html`<div class="duel-row"><span>${t('第 {round} 轮', { round: entry.round })} <b class="winner">${room.players.find(p => p.id === entry.winner)?.name}</b></span><small>${entry.reason} · ${clock(entry.time)}</small></div>`)}</aside>`}
    </section>
    <${ShopBar} priv=${nativePriv} editable=${editable} collapsed=${shopFolded} onCollapse=${setShopFolded} allowFreeze=${false}
      reward=${me?.role==='defend'&&!rewardLater?me?.rewardOffer:null} onReward=${index=>send('reward',{index})} onRewardLater=${()=>setRewardLater(true)}
      levelReason=${!editable ? t('当前不能升级') : me?.upgrade?.reason} onLevel=${() => send('upgrade')} onRefresh=${() => send('refresh')} onRefuse=${showError}
      onBuy=${i=>{const offer=roleOffers[i];send('buy',{kind:offer.kind,index:offer.index});}}
      onDetail=${(id, kind) => { const [group,index] = kind.split(':'); const offer=me?.rewardOffer&&!rewardLater?{kind:'reward'}:kind==='chess'||kind==='item'?roleOffers.find(o=>o.id===id):{kind:group,index:Number(index)};setDetail({id,shop:offer}); }} onDetailClose=${() => setDetail(null)}
      income=${html`<span class="income">${t('每')}${me?.incomeInterval || 2}${t('秒 +1 · 上限100')}</span><small class="upgrade-status" role="status">${me?.upgrade?.cooldown ? t('{cooldown}秒', { cooldown: me.upgrade.cooldown }) : me?.upgrade?.required > me?.upgrade?.deployed ? t('部署 {deployed}/{required}', { deployed: me.upgrade.deployed, required: me.upgrade.required }) : ''}</small>`}
      renderOffers=${me?.role==='attack'?({ armed: nativeArmed, tapCard }) => roleOffers.map(({ kind, id, index }, i) => {
        const reason = !editable ? t('当前只能查看') : (cards.get(id)?.price || 0) > me?.coins ? t('资金不足') : null;
        const slot = nativePriv.shop.slots[i], key = kind === 'equipment' ? 'i' : 'c';
        return html`<${VersusShopCard} key=${`${kind}:${index}:${id}`} card=${cards.get(id)} kind=${kind} index=${index} priv=${nativePriv}
          reason=${reason} armed=${nativeArmed === armKey(key,i,slot)} image=${image(cards.get(id))} onTap=${() => tapCard(key,i,slot,`${kind}:${index}`,reason,() => send('buy',{kind,index}))}/>`;
      }):null}/>
    ${toast && html`<div class="toast" role="alert">${toast}</div>`}
    ${me?.rewardOffer && rewardLater && html`<button class="versus-reward-pill" onClick=${() => setRewardLater(false)}><${Icon} name="gift"/>${t('晋升奖励 · 免费选一名')}</button>`}
    ${replacement && html`<${EquipReplaceDialog} request=${replacement} getItem=${id => gameData.items[id]} onCancel=${() => setReplacement(null)} onConfirm=${replaceIndex => { send('equip', { uid: replacement.targetUid, itemUid: replacement.item.uid, replaceIndex }); setReplacement(null); }}/>`}
    ${resultOpen && resultPlayers.length > 0 && html`<div class="overlay"><section class="modal versus-result" role="dialog" aria-modal="true" aria-labelledby="versus-result-title"><div class="modal-head"><div><small>${t('对抗模式（测试）')}</small><h2 id="versus-result-title">${room.status === 'complete' ? t('对抗结算') : settled.winner === me.id ? t('本场胜利 · 晋级') : t('本场落败')}</h2></div><${IconButton} name="close" label=${t('关闭对抗结算')} onClick=${() => setResultOpen(false)}/></div>
      <div class="result-roster">${resultPlayers.map(p => html`<article class=${`result-player ${p.id === me.id ? 'self' : ''}`}><header><b>${p.placement === 1 ? t('冠军') : p.placement ? t('{0}第 {placement} 名', { 0: p.placement === 2 ? '' : t('并列'), placement: p.placement }) : t('晋级')}</b><span>${p.name}${p.id === me.id ? t(' · 你') : ''}</span></header><div class="result-lineup">${p.lineup.map(o => html`<img src=${image(cards.get(o.id))} title=${cards.get(o.id)?.name} alt=${cards.get(o.id)?.name}/>` )}</div>
        <dl>${[[t('剩余生命'),p.hp],[t('击倒敌人'),p.stats.kills],[t('投放怪物'),p.stats.launched],[t('漏怪数量'),p.stats.leaks],[t('晋升次数'),p.stats.merges],[t('消耗金币'),p.stats.spent]].map(([label,value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>
        ${(p.defense||[]).map((leg,i)=>html`<p class="room-caption">${t('第')}${i+1}${t('轮防守：漏怪 {leaks} · 坚守', { leaks: leg.leaks })} ${clock(leg.heldSeconds)} ${t('· 击杀价值 {killValue}', { killValue: leg.killValue })}</p>`)}
        <div class="result-bonds">${resultBonds(Object.entries(p.bonds || {}).map(([bondId,b])=>({ ...b,bondId })),id=>gameData.bonds[id]).map(b=>html`<span key=${b.bondId} data-bond=${b.bondId}><img src=${assets.bondIcon(b.bondId)} alt=""/>${gameData.bonds[b.bondId]?.name}${b.hideLayers ? '' : ` ${b.layers ?? 0}`}</span>`)}</div></article>`)}</div>
      <div class="form-actions"><button onClick=${() => setResultOpen(false)}>${room.status === 'complete' ? t('查看战场') : my?.eliminated ? t('继续观战') : t('继续对抗')}</button>
        ${room.status === 'complete' || my?.eliminated ? html`<button class="primary" aria-label=${room.status === 'complete' ? t('结算返回房间') : t('结算退出观战')} onClick=${() => room.status === 'complete' ? restart() : embedded ? send('leave') : restart()}>${room.status === 'complete' ? t('返回房间') : t('退出观战')}</button>` : null}</div>
    </section></div>`}
    ${!embedded && (!room || room.status === 'lobby' && roster) && html`<div class="overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
      <div class="modal-head"><h2 id="entry-title">${room ? t('对抗房间') : t('卫戍对抗')}</h2>${room ? html`<${IconButton} name="close" label=${t('关闭房间设置')} onClick=${() => setRoster(false)}/>` : html`<span class="build-tag">${t('本地验收版')}</span>`}</div>
      ${!room ? html`<label class="form-label">${t('博士昵称')}<input maxLength="16" value=${name} onInput=${e => setName(e.target.value)}/></label>
        <button class="primary" style="width:100%" disabled=${!connected || !name.trim()} onClick=${create}><${Icon} name="plus"/>${t('创建 4 人房间')}</button>
        <div class="join-row"><input aria-label=${t('房间代码')} placeholder=${t('房间代码')} maxLength="4" value=${code} onInput=${e => setCode(e.target.value)}/><button disabled=${!connected || !name.trim() || code.length !== 4} onClick=${join}>${t('加入房间')}</button></div>` : html`<div class="room-caption">${t('房间')}<strong>${room.code}</strong>${room.players.length}/4 <${IconButton} name="copy" label=${t('复制房间代码')} onClick=${() => navigator.clipboard.writeText(room.code).catch(() => showError(room.code))}/></div>
        <div class="room-roster">${Array.from({ length: 4 }, (_, i) => { const p = room.players[i]; return html`<div class=${`seat ${p ? '' : 'empty'}`}><${Icon} name=${p?.bot ? 'robot' : 'user'}/><span>${p?.name || t('等待加入')}${p?.id === me.id ? t(' · 你') : ''}</span></div>`; })}</div>
        ${room.host === me.id ? html`<div class="form-actions"><button onClick=${() => { send('start', { fillAI: true }); setRoster(false); }} class="primary"><${Icon} name="robot"/>${t('补齐 AI 并开始')}</button><button disabled=${room.players.length < 4} onClick=${() => { send('start'); setRoster(false); }}><${Icon} name="play"/>${t('开始')}</button></div>` : html`<p class="room-caption">${t('等待房主开始')}</p>`}`}
    </section></div>`}
    <div class="gm__hud">
    <div class="gm__bonds" ref=${bondsHost} aria-label=${t('当前战场盟约')}>
      <button type="button" class="bonds-toggle" aria-expanded=${!bondsCollapsed} aria-controls="versus-bond-strip"
        aria-label=${bondsCollapsed ? t('展开盟约') : t('收起盟约')} title=${bondsCollapsed ? t('展开盟约') : t('收起盟约')}
        onKeyDown=${e => { if (e.key === ' ') e.stopPropagation(); }}
        onClick=${() => { if (!bondsCollapsed) setBondOpen(null); setBondsCollapsed(!bondsCollapsed); }}>
        <${Icon} name=${bondsCollapsed ? 'chevronRight' : 'chevronLeft'}/><span>${t('盟约')}</span>
      </button>
      <div id="versus-bond-strip" class="gm__bond-list" hidden=${bondsCollapsed || !bondEntries.length}>
        <${BondStrip} bonds=${bondEntries} max=${bondEntries.length} openId=${bondOpen} onOpen=${id => setBondOpen(bondOpen === id ? null : id)}/>
      </div>
    </div>
    ${nativeDetail && html`<${DetailPanel} detail=${nativeDetail} editable=${false} loadout=${me?.loadout} voice=${true}
      side=${detailDock} shopOpen=${!shopFolded} bonds=${bondEntries} onBond=${setBondOpen} live=${liveDetail}
      onClose=${() => { setArmed(null); setDetail(null); }}/>`}
    ${nativeDetail && !detail.shop && !detail.readOnly && view && (detailPiece.row != null || detailSlot >= 0) && html`<${Underframe} view=${view} uid=${detailPiece.uid} row=${detailRow} col=${detailWorldCol}
      name=${detailCard.name} busy=${!deployable} actions=${{ retreat: detailCard.kind === 'operator' && detailPiece.row != null, sell: sellValue }}
      onRetreat=${() => send('withdraw', { uid: detailPiece.uid })} onSell=${() => { send('sell', { uid: detailPiece.uid, id: detailPiece.id, kind: detailCard.kind }); setDetail(null); }}/>`}
    </div>
    ${confirm && html`<div class="overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div class="modal-head"><h2 id="confirm-title">${t('确认认输？')}</h2></div><p class="confirm-text">${t('本场将判负，之后进入观战。')}</p><div class="form-actions"><button onClick=${() => setConfirm(false)}>${t('取消')}</button><button class="danger" onClick=${() => { send('forfeit'); setConfirm(false); }}>${t('确认认输')}</button></div></section></div>`}
    ${bondOpen && html`<${BondPopup} bondId=${bondOpen} record=${versusBondRecord(gameData.bonds[bondOpen])} entry=${fieldBonds[bondOpen]} priv=${focusedId === me?.id && me?.role === 'defend' ? nativePriv : { board: packet.field.meta.units.filter(u => u.kind === 'op').map(u => ({ id: u.defId, kind: 'chess', items: u.items || [] })), hand: [] }} banned=${room?.bannedChess || []} onClose=${() => setBondOpen(null)} />`}
    <${Modal} open=${rulesOpen} title=${t('对抗模式规则（测试版）')} micro=${t('4 人攻守淘汰赛')} class="versus-rules" width="min(520px, 94vw)" trapFocus=${true} onClose=${() => setRulesOpen(false)}
      actions=${html`<button aria-label=${t('关闭规则')} onClick=${() => setRulesOpen(false)}><${Icon} name="close"/>${t('关闭')}</button>`}>
      <dl>${VERSUS_RULES.map(([title, text]) => html`<div key=${title}><dt>${title}</dt><dd>${text}</dd></div>`)}</dl>
    <//>
    ${room?.status === 'info' && !embedded && html`<div class="overlay"><section class="modal"><h2>${t('对抗模式（测试） · 确认信息')}</h2><p class="confirm-text">${t('战场：')}${gameData.stages[room.stageId]?.name}<br/>${t('本局禁用盟约：')}${room.disabledBonds.map(id => gameData.bonds[id]?.name).join('、')}</p><button class="primary" disabled=${my?.infoReady} onClick=${() => send('infoReady')}>${my?.infoReady ? t('已就绪') : t('准备就绪')} · ${room.countdown}</button></section></div>`}
    ${facing && view && html`<${FacingWheel} view=${{ tileScreen: (...args) => { const pos = view.tileScreen(...args); return pos && { ...pos, s: Math.min(54, pos.s) }; }, highlightTiles: (...args) => view.highlightTiles(...args), stripesUnder: (...args) => view.stripesUnder?.(...args) }} row=${facing.row} col=${facing.col} grid=${gameData.chess[facing.id]?.rangeGrid} name=${cards.get(facing.id)?.name} onCommit=${dir => { send(facing.action, { uid: facing.uid, ...(['deploy', 'move'].includes(facing.action) ? { row: facing.row, col: facing.col } : {}), dir: boardDir(dir, me.side === 'R') }); changeFacing(null); }} onCancel=${() => changeFacing(null)}/>`}
  </main>`;
}
render(html`<${App}/>`, document.getElementById('app'));
if (embedded) {
  embeddedOnline = true;
  addEventListener('message', e => { if (e.origin === location.origin && e.source === parent) receive(e.data); });
  parent.postMessage({ type: 'versus-ready' }, location.origin);
} else connect();
window.__versusState = () => latest;
}

bootVersus().catch(error => {
  console.error('[versus] boot failed', error);
  const root = document.getElementById('app');
  if (root) root.textContent = t('对抗战场加载失败，请检查网络后刷新。');
});
