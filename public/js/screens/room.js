// Room screen (同盟等待室): 4 seat cards (avatar frame, name, ready state, AI badge, host crown),
// host controls (difficulty picker, add/remove AI in co-op, start), invite code with copy code /
// copy link, ready toggle and leave.
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Texts go through t() (docs/I18N.md).

import { RoomExtensionsPanel } from '../ui/roomExtensions.js';
import { AccountPanels } from '../ui/accountPanels.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { CLONE_DESCRIPTION } from '../../../shared/cloneMode.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, roomCapacity, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyTag, DifficultyIcon, Tooltip, confirmDialog, doctorNo, Modal, useTicker,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { LoadoutButton } from './loadout.js';
import { DiyButton, flushProfiles } from '../ui/profileEntry.js';
import { ReleaseNotesButton } from '../ui/releaseNotes.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, serverNow } from '../store.js';
import { difficultyInfo } from './lobby.js';
import { MatchmakingScreen } from './matchmaking.js';
import { RoomCapacityPicker } from '../ui/roomCapacity.js';
import { MULTIPLAYER_PENDING } from '../../../shared/integrationStage.js';
import { t, tc } from '../../../shared/i18n.js';
import { mapName, validRecruitment, RECRUIT_MAX_LEN } from '../../../shared/roomDirectory.js';
import { RoomChatStrip } from '../ui/roomChatStrip.js';
import { PopulationStrip } from '../ui/population.js';

/**
 * Seats padded to the room's capacity (co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = roomCapacity(room?.mode, room?.capacity);
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine,
    othersReady,
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick }) {
  const coop = room.mode !== 'solo';
  if (!seat) {
    const canAdd = coop && facts.isHost;
    return html`<article class="seat seat--empty" style=${`--seat-i:${index}`}>
      <header class="seat__head"><span class="seat__no num">P${index + 1}</span><${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//></header>
      <div class="seat__art seat__art--empty">
        <div class="seat__radar" aria-hidden="true"></div>
        <span class="seat__wait">${t('等待博士加入')}</span>
        <${MicroLabel}>AWAITING DOCTOR<//>
      </div>
      <footer class="seat__foot">
        ${canAdd
          ? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t('添加 AI 队友')}<//>`
          : html`<span class="seat__state t-dim">${t('空位')}</span>`}
      </footer>
    </article>`;
  }
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  // The host never needs to toggle ready: starting the match readies them (server rule).
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  return html`<article class=${`seat brackets${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''} is-${state}`}
      style=${`--seat-i:${index}`}>
    <header class="seat__head">
      <span class="seat__no num">P${index + 1}</span>
      <${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//>
      ${isHostSeat ? html`<span class="seat__host"><${Icon} name="crown" />${t('创建者')}</span>` : null}
    </header>
    <div class="seat__art">
      <div class="seat__stripes" aria-hidden="true"></div>
      <${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />
      ${seat.isBot ? html`<span class="seat__bot-label"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
    </div>
    <div class="seat__who">
      <span class="seat__name">${seat.name || t('博士')}</span>
      ${isMe ? html`<span class="seat__you">${t('你')}</span>` : null}
    </div>
    <${MicroLabel}>${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}<//>
    <footer class="seat__foot">
      <span class=${`seat__state seat__state--${state}`}>
        ${state === 'ready' ? html`<${Icon} name="check" />${t('已就绪')}`
          : state === 'offline' ? html`<${Icon} name="wifiOff" />${t('连接中断')}`
          : state === 'host' ? html`<${Icon} name="crown" />${t('待命中')}`
          : html`<${Icon} name="hourglass" />${t('准备中')}`}
      </span>
      ${seat.isBot && facts.isHost ? html`<${Tooltip} text=${t('移除该 AI 队友')}>
        <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rm${index}`} onClick=${() => onRemoveBot(index)} aria-label=${t('移除 AI 队友')} />
      <//>` : null}
      ${!seat.isBot && !isMe && facts.isHost ? html`<${Tooltip} text=${t('将该博士移出同盟')}>
        <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `kick${index}`} onClick=${() => onKick(index, seat.name, seat.playerId)} aria-label=${t('移出该博士')} />
      <//>` : null}
    </footer>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

function InviteBox({ code, name, difficulty, description, capacity, mapVersion }) {
  const copy = async (what) => {
    const invite = t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', { name: name ?? '', difficulty: DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '' });
    const text = [inviteLink(code), invite, description ? `房间简介：${description}` : null,
      `${capacity}人房间 · ${mapName(mapVersion)}`, `同盟密钥：${code}`].filter(Boolean).join('\n');
    const ok = await copyText(what === 'code' ? code : text);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  return html`<div class="invite brackets">
    <div class="invite__label"><${Icon} name="key" /><span>${t('同盟密钥')}</span><${MicroLabel}>ALLIANCE KEY<//></div>
    <div class="invite__code num selectable" aria-label=${t('同盟密钥 {code}', { code })}>${[...String(code)].map((ch, i) => html`<span key=${i}>${ch}</span>`)}</div>
    <div class="invite__btns">
      <${Button} size="sm" icon="copy" title=${t('复制密钥')} aria-label=${t('复制密钥')} onClick=${() => copy('code')}>${t('复制密钥')}<//>
      <${Button} size="sm" icon="link" title=${t('复制链接')} aria-label=${t('复制链接')} onClick=${() => copy('link')}>${t('复制链接')}<//>
    </div>
  </div>`;
}

function DifficultyPicker({ room, isHost, busy, onPick }) {
  if (!isHost) {
    return html`<div class="dpick dpick--ro">
      <${DifficultyTag} difficulty=${room.difficulty} size="lg" code=${difficultyInfo(room.mode, room.difficulty).code} />
      <span class="t-dim">${t('由创建者选择')}</span>
    </div>`;
  }
  return html`<div class="dpick" role="radiogroup" aria-label=${t('模拟难度')}>
    ${DIFFICULTIES.map((d) => html`<button key=${d} type="button" role="radio" aria-checked=${room.difficulty === d ? 'true' : 'false'}
        class=${`dpick__opt${room.difficulty === d ? ' is-active' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`}
        disabled=${!!busy} onClick=${() => room.difficulty !== d && onPick(d)}>
      <${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d].replace('模拟', ''))}
    </button>`)}
  </div>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [description, setDescription] = useState('');
  useTicker(room?.recruitNextAt > serverNow() ? 250 : 0);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  if (!room) return null;
  const online = conn.status === 'online';
  if (room.matchmaking && !room.inMatch) return html`<${MatchmakingScreen} room=${room} online=${online} />`;
  const coop = room.mode !== 'solo';
  const facts = roomFacts(room, me.playerId);
  if (room.gameMode === 'versus' && (room.capacity !== 4 || facts.seats.filter(Boolean).length !== 4)) facts.canStart = false;
  const capacity = roomCapacity(room.mode, room.capacity);

  const recruitSeconds = Math.max(0, Math.ceil(((room.recruitNextAt || 0) - serverNow()) / 1000));
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', async () => { await flushProfiles(); return net.request('room.start', {}); });
  const setMapVersion = (mapVersion) => run('map', () => net.request('room.setMapVersion', { mapVersion }));
  const setGameMode = (gameMode) => run('gameMode', () => net.request('room.setGameMode', { gameMode }));
  const setVisibility = (visibility) => {
    if (visibility === 'public' && !validRecruitment(room.description)) { setDescription(room.description || ''); setDescriptionOpen(true); toast('请先填写房间简介，再切换公开', 'warn'); return; }
    run('visibility', () => net.request('room.setVisibility', { visibility }));
  };
  const recruit = () => run('recruit', async () => { await net.request('room.recruit', {}); toast('已发布房间简介到同盟招募', 'success'); });
  const saveDescription = () => run('description', async () => {
    await net.request('room.setDescription', { description });
    if (alive.current) setDescriptionOpen(false);
    toast('房间简介已保存', 'success');
  });
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  const setCapacity = (capacity) => run('capacity', () => net.request('room.setCapacity', { capacity, experimentalAccepted: capacity > 4 }));
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code }));
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  return html`<div class="screen room-screen">
    <header class="topbar">
      <div class="topbar__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <${Button} variant="danger" size="lg" square=${true} icon="exit" loading=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')} />
        <//>
        <div class="room-ping">
          <${PingPill} ms=${conn.ping} online=${online} />
          <${MicroLabel}>${t('当前延迟')}<//>
        </div>
        <${GuideButton} class="room-guide" variant="secondary" />
        <${ReleaseNotesButton} />
        <${AccountPanels} />
      </div>
      <div class="topbar__center">
        ${capacity > 4 && room.gameMode !== 'versus' ? html`<p class="stage-warning room-stage-warning" title=${MULTIPLAYER_PENDING}><span>${MULTIPLAYER_PENDING}</span><small>5–8人测试中 · 详见公告</small></p>` : null}
        <${MicroLabel} tone="mint">${coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}<//>
        <div class="room-heading"><h1 class="topbar__title">${coop ? '同盟模拟' : '独立模拟'}<span class="topbar__sep"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" /></h1><${PopulationStrip} /></div>
        <div class="room-options">
          <${RoomExtensionsPanel} room=${room} editable=${facts.isHost && online && !room.inMatch && !room.matchmaking} />
          ${coop ? html`<${RoomCapacityPicker} value=${capacity} onChange=${setCapacity} disabled=${!facts.isHost || !!busy || !online} locked=${!!room.capacityLocked} gameMode=${room.gameMode} />` : null}
          <label class="room-map-picker">棋盘外观<select value=${room.mapVersion || 'official'} aria-label="棋盘外观" disabled=${!facts.isHost || !!busy || !online}
            onChange=${(e) => { const value = e.currentTarget.value; e.currentTarget.value = room.mapVersion || 'official'; setMapVersion(value); }}>
            <option value="classic">${mapName('classic')}</option><option value="new">${mapName('new')}</option><option value="official">${mapName('official')}</option>
          </select></label>
          ${coop ? html`<label class="room-mode-picker">模式<select value=${room.gameMode || 'normal'} aria-label="游戏模式" title=${facts.isHost ? '选择正常、克隆或对抗模式（测试）' : '由房主切换模式'} disabled=${!facts.isHost || !!busy || !online || !!room.matchmaking}
            onChange=${e => { const value = e.currentTarget.value; e.currentTarget.value = room.gameMode || 'normal'; setGameMode(value); }}>
            <option value="normal">正常模式</option><option value="clone">克隆模式</option><option value="versus">对抗测试</option>
          </select></label>` : null}
        </div>
      </div>
      <div class="topbar__right">
        ${coop ? html`<${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} description=${room.description} capacity=${room.capacity} mapVersion=${room.mapVersion} />` : html`<div class="solo-note"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>
    ${coop ? html`<div class="room-description"><span class="room-description__label">房间简介</span><p>${room.description || '房主尚未填写简介'}</p>
      ${facts.isHost ? html`<button type="button" disabled=${!!busy || !online} onClick=${() => { setDescription(room.description || ''); setDescriptionOpen(true); }}>✎ 修改</button>` : null}</div>` : null}
    ${coop && room.gameMode === 'clone' ? html`<p class="room-clone-note" role="status">${CLONE_DESCRIPTION}</p>` : null}

    <main class=${`seats${coop ? capacity > 4 ? ' seats--expanded' : '' : ' seats--solo'}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} />`)}
      ${coop ? null : html`<aside class="solo-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />
    ${room.chatEnabled ? html`<${RoomChatStrip} key=${room.code} />` : null}

    <footer class="room-bar">
      <div class="room-bar__left">
        <span class="room-bar__label">${t('模拟难度')}<${MicroLabel}>DIFFICULTY<//></span>
        <${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} />
        ${coop ? html`<div class="room-access-controls">
          <div class="room-access-toggle" role="radiogroup" aria-label="房间公开方式">
            ${[['public', '公开'], ['private', '私有']].map(([v, label]) => html`<button key=${v} type="button" role="radio" aria-checked=${room.visibility === v}
              class=${room.visibility === v ? 'is-active' : ''} disabled=${!facts.isHost || !!busy || !online} onClick=${() => room.visibility !== v && setVisibility(v)}>${label}</button>`)}
          </div>
          ${room.visibility === 'public' && facts.isHost ? html`<${Button} variant="amber" size="sm" class="room-recruit" loading=${busy === 'recruit'}
            disabled=${!!busy || !online || recruitSeconds > 0 || facts.emptySeats === 0 || !validRecruitment(room.description)}
            onClick=${recruit}>${recruitSeconds > 0 ? `招募冷却 ${recruitSeconds}s` : '发布招募'}<//>`
            : html`<span class="room-access-hint">${room.visibility === 'public' ? '已显示在公开房间列表' : '凭密钥 / 邀请链接加入'}</span>`}
        </div>` : null}
      </div>
      <div class="room-bar__center">
        <div class="ready-count" hidden=${!coop}>
          <span class="t-lo">${t('已就绪')}</span>
          <b class="num">${facts.readyHumans}</b><span class="num t-dim">/${facts.humans.length}</span>
          <span class="ready-count__icons" aria-hidden="true">
            ${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}
          </span>
        </div>
        <div class="room-bar__status">${statusLine}</div>
      </div>
      <div class="room-bar__right room-bar__right--directory">
        <${LoadoutButton} from="room" size="lg" class="room-loadout" />
        <${DiyButton} size="lg" />
        ${facts.isHost
          ? html`<${Tooltip} text=${facts.canStart ? null : room.gameMode === 'versus' ? '对抗模式（测试）需要4人房间满员，且所有玩家已准备' : t('仍有博士未准备就绪')}>
              <${Button} variant="primary" size="xl" icon="play" loading=${busy === 'start'} disabled=${!facts.canStart || !online} onClick=${start}>${t('开始模拟')}<//>
            <//>`
          : facts.spectating
            ? html`<${Button} variant="secondary" size="xl" icon="eye" disabled=${true}>${t('观战中')}<//>`
          : html`<${Button} variant=${myReady ? 'primary' : 'secondary'} size="xl" icon=${myReady ? 'check' : 'hourglass'} active=${myReady}
              loading=${busy === 'ready'} disabled=${!online || !facts.mine} onClick=${toggleReady}>${myReady ? t('已就绪') : t('准备就绪')}<//>`}
      </div>
    </footer>
    <${Modal} open=${descriptionOpen} title="修改房间简介" micro="ALLIANCE PROFILE" trapFocus=${true} width="min(620px, 94vw)"
      onClose=${busy ? null : () => setDescriptionOpen(false)} actions=${html`<${Button} disabled=${!!busy} onClick=${() => setDescriptionOpen(false)}>取消<//>
        <${Button} variant="primary" loading=${busy === 'description'} disabled=${!!busy || !validRecruitment(description)} onClick=${saveDescription}>保存简介<//>`}>
      <label class="room-description-field">房间简介 <span>最多${RECRUIT_MAX_LEN}字</span><textarea rows="3" data-autofocus value=${description} maxLength=${RECRUIT_MAX_LEN}
        onInput=${(e) => setDescription(e.currentTarget.value)} placeholder="写下难度、玩法和队友偏好" disabled=${!!busy}></textarea></label>
      <p class="room-access-modal__intro">公开房间列表会显示简介；发布招募直接使用这段文字。修改后，已有招募文字一并更新。</p>
    <//>
  </div>`;
}
