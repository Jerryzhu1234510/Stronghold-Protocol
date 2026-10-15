import { AccountPanels } from './accountPanels.js';
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { PHASE } from '../../../shared/constants.js';
import { useStore, shallowEqual, loadPref, savePref, selectRoute } from '../store.js';
import { net } from '../net.js';
import { CHAT_MAX_LEN, sanitizeChat, validChat } from '../../../shared/chat.js';
import { chatPosition, chatAnchor, normalizeChatAnchor, avoidChatControls, latestChatPreview } from './chatState.js';
import { t } from '../../../shared/i18n.js';

function viewport() {
  const v = window.visualViewport;
  const style = getComputedStyle(document.documentElement);
  const inset = (edge) => Math.max(0, parseFloat(style.getPropertyValue(`--sa-${edge}`)) || 0);
  const left = inset('l'), right = inset('r'), top = inset('t'), bottom = inset('b');
  return { x: (v?.offsetLeft || 0) + left, y: (v?.offsetTop || 0) + top,
    width: (v?.width || innerWidth) - left - right, height: (v?.height || innerHeight) - top - bottom,
    avoid: [...document.querySelectorAll('.result__foot')].map(el => el.getBoundingClientRect()) };
}

export function RoomChatHost({ docked = false, hidden = false, onExpand = null, compact = false }) {
  const room = useStore((s) => s.session.entered && s.room?.chatEnabled && selectRoute(s) !== 'room' ? s.room : null);
  if (docked) return null;
  return room ? html`<${RoomChat} key=${room.code} code=${room.code} docked=${docked} hidden=${hidden} onExpand=${onExpand} compact=${compact} />` : null;
}

export function RoomChat({ code, docked = false, hidden = false, onExpand = null, compact = false }) {
  const state = useStore((s) => ({ chat: s.chat, online: s.connection.status === 'online', playerId: s.me.playerId,
    phase: s.match.result ? PHASE.RESULT : s.match.public?.phase }), shallowEqual);
  const messages = state.chat.messages;
  const preview = latestChatPreview(messages, state.playerId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [behind, setBehind] = useState(false);
  const [anchor, setAnchor] = useState(() => normalizeChatAnchor(loadPref('roomChatPosition', null) || { x: 0, y: 0.72 }));
  const [view, setView] = useState(viewport);
  const [size, setSize] = useState({ width: 164, height: 44 });
  const root = useRef(null), log = useRef(null), input = useRef(null), toggle = useRef(null), drag = useRef(null);
  const atBottom = useRef(true), lastLive = useRef(state.chat.liveSeq), sending = useRef(false), alive = useRef(true);
  const returnFocus = useRef(false);
  const position = avoidChatControls(chatPosition(anchor, size, view), size, view);
  const length = [...draft].length;

  useEffect(() => () => { alive.current = false; }, []);
  useLayoutEffect(() => {
    if (!open && returnFocus.current) { returnFocus.current = false; toggle.current?.focus(); }
  }, [open]);
  useLayoutEffect(() => {
    const measure = () => {
      const r = root.current?.getBoundingClientRect();
      if (r) setSize((s) => s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height });
      setView(viewport());
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    const resize = () => setView(viewport());
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, []);
  useLayoutEffect(() => { setView(viewport()); }, [state.phase, open]);

  function move(next) { const safe = normalizeChatAnchor(next); setAnchor(safe); savePref('roomChatPosition', safe); }
  function dragStart(e) {
    if (docked || e.button !== 0 || drag.current) return;
    e.preventDefault();
    const r = root.current.getBoundingClientRect();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.x, top: r.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function dragMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    setAnchor(chatAnchor({ x: d.left + e.clientX - d.x, y: d.top + e.clientY - d.y }, size, view));
  }
  function dragEnd(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    move(chatAnchor({ x: d.left + e.clientX - d.x, y: d.top + e.clientY - d.y }, size, view));
    drag.current = null;
  }
  function moveKey(e) {
    const step = e.shiftKey ? 48 : 16;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    move(chatAnchor({ x: position.x + delta[0], y: position.y + delta[1] }, size, view));
  }

  useEffect(() => {
    const delta = state.chat.liveSeq - lastLive.current;
    lastLive.current = state.chat.liveSeq;
    if (!open && delta > 0) setUnread((n) => Math.min(99, n + delta));
    if (open || docked) {
      if (atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
      else if (delta > 0) setBehind(true);
    }
  }, [state.chat, open]);

  function expand() { onExpand?.(); atBottom.current = true; setBehind(false); setUnread(0); setOpen(true); requestAnimationFrame(() => input.current?.focus()); }
  function collapse() { returnFocus.current = true; setOpen(false); }
  function jump() { if (log.current) log.current.scrollTop = log.current.scrollHeight; atBottom.current = true; setBehind(false); }
  async function send(e) {
    e.preventDefault();
    if (sending.current || !state.online || !validChat(draft)) return;
    const text = sanitizeChat(draft);
    sending.current = true; setBusy(true); setError('');
    try {
      await net.request('room.chat', { text });
      if (alive.current) { setDraft((current) => current === draft ? '' : current); input.current?.focus(); }
    } catch (err) {
      if (alive.current) setError(err.code === 'RATE' ? t('发送太快，请稍后再试') : t('发送失败，消息已保留，请重试'));
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const shown = docked && !open ? messages.slice(-6) : messages;
  return html`<aside ref=${root} class=${`room-chat ${compact ? 'room-chat--compact' : ''} ${docked ? 'room-chat--docked' : ''} ${hidden ? 'room-chat--hidden' : ''} ${open ? 'room-chat--open' : preview ? 'room-chat--preview' : 'room-chat--empty'}`} aria-label=${t('好友房间聊天')}
    style=${docked ? { '--chat-width': `${view.width - 32}px`, '--chat-height': `${view.height - 90}px` } : { left: `${position.x}px`, top: `${position.y}px`, '--chat-width': `${view.width - 16}px`, '--chat-height': `${view.height - 16}px` }}
    onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Escape' && open && !e.isComposing) { e.preventDefault(); collapse(); } }}
    onKeyUp=${(e) => e.stopPropagation()}>
    ${docked ? html`<button ref=${toggle} type="button" class="gm__gear room-chat__dock-toggle" aria-label=${open ? t('收起聊天') : t('展开聊天')} title=${t('聊天')}
      aria-expanded=${open} aria-controls="room-chat-panel" onClick=${() => open ? collapse() : expand()}>
      <${Icon} name="chat" />${unread > 0 ? html`<span class="room-chat__badge">${unread}</span>` : null}</button>` : html`<div class="room-chat__header">
      ${open ? html`<${AccountPanels} friendsOnly=${true} />` : null}
      <button class="room-chat__move" type="button" aria-label=${t('移动聊天框')} title=${`${code} · ${t('拖动移动；聚焦后用方向键移动')}`}
        onPointerDown=${dragStart} onPointerMove=${dragMove} onPointerUp=${dragEnd} onPointerCancel=${() => { drag.current = null; }}
        onLostPointerCapture=${() => { drag.current = null; }} onKeyDown=${moveKey}><${Icon} name="edit"/></button>
      ${open ? html`<span class="room-chat__title">${t('房间聊天')}</span>
        <button type="button" onClick=${collapse} aria-label=${t('收起聊天')} title=${t('收起聊天')}><${Icon} name="chevronLeft"/></button>`
        : html`<button ref=${toggle} type="button" class="room-chat__toggle" onClick=${expand} aria-expanded="false" aria-controls="room-chat-panel"
          title=${t('展开房间聊天')}>
          ${compact ? html`<${Icon} name="chat" />` : html`<span class="room-chat__summary" aria-live="polite" aria-atomic="true">
            <span class="room-chat__label">${t('房间聊天')}</span>
          </span>`}
          ${unread > 0 ? html`<span class="room-chat__badge" aria-label=${t('{unread} 条未读消息', { unread })}>${unread}</span>` : compact ? null : html`<${Icon} name="chevronRight"/>`}
        </button>`}
    </div>`}
    ${open && html`<div id="room-chat-panel" class="room-chat__body">
      <div ref=${log} class="room-chat__log" role="log" tabIndex="0" aria-label=${t('聊天记录')} aria-live="polite" aria-relevant="additions" aria-atomic="false"
        onScroll=${() => { const el = log.current; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; if (atBottom.current) setBehind(false); }}>
        ${shown.length ? shown.map((m) => html`<div key=${m.id} class=${`room-chat__message ${m.playerId === state.playerId ? 'room-chat__message--own' : ''}`}>
          <div class="room-chat__meta"><strong>${m.name}${m.playerId === state.playerId ? t('（我）') : ''}</strong>
            <time>${new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
          <p>${m.text}</p></div>`)
          : html`<p class="room-chat__empty">${t('还没有人发言')}</p>`}
      </div>
      ${behind && html`<button class="room-chat__jump" type="button" onClick=${jump}>${t('有新消息 · 查看最新')}</button>`}
      ${open && html`<form class="room-chat__form" onSubmit=${send}>
        <label class="room-chat__sr" for="room-chat-input">${t('给房间里的队友发消息，最多 {CHAT_MAX_LEN} 字', { CHAT_MAX_LEN })}</label>
        <input id="room-chat-input" ref=${input} type="text" value=${draft} maxLength=${CHAT_MAX_LEN * 2}
          autoComplete="off" placeholder=${state.online ? t('输入消息…') : t('正在重连…')} disabled=${!state.online}
          aria-describedby="room-chat-hint" aria-invalid=${length > CHAT_MAX_LEN ? 'true' : undefined}
          onInput=${(e) => { setDraft(e.currentTarget.value); setError(''); }}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(e); } }} />
        <span class="room-chat__count" aria-live="polite">${length}/${CHAT_MAX_LEN}</span>
        <button type="submit" title=${t('发送消息')} aria-label=${t('发送消息')} disabled=${busy || !state.online || !validChat(draft)}><${Icon} name="edit"/></button>
      </form>
      <div id="room-chat-hint" class="room-chat__hint" role="status">${error || (!state.online ? t('重连后可继续聊天') : length > CHAT_MAX_LEN ? t('消息最多 {CHAT_MAX_LEN} 字', { CHAT_MAX_LEN }) : '')}</div>`}
    </div>`}
  </aside>`;
}
