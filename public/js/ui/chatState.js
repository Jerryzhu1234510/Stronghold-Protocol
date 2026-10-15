import { CHAT_HISTORY_LIMIT } from '../../../shared/chat.js';

export const emptyChat = (code = null) => ({ code, messages: [], liveSeq: 0 });

/** The collapsed preview always belongs to a teammate, even after our own reply. */
export function latestFriendMessage(messages, playerId) {
  return messages.findLast((m) => m.playerId !== playerId) || null;
}

/** Prefer the latest teammate line; a room with only our own lines still has a visible preview. */
export function latestChatPreview(messages, playerId) {
  return latestFriendMessage(messages, playerId) || messages.at(-1) || null;
}

/** Ignore stale frames from another room; history resyncs merge without duplicates or unread inflation. */
export function receiveChat(state, frame) {
  if (!state.room?.chatEnabled || state.room.code !== frame.code) return state.chat;
  const previous = state.chat?.code === frame.code ? state.chat : emptyChat(frame.code);
  const history = frame.t === 'room.chatHistory';
  const incoming = history ? frame.messages : [frame.message];
  if (!Array.isArray(incoming)) return previous;
  const messages = new Map(previous.messages.map((m) => [m.id, m]));
  let added = 0;
  for (const m of incoming) {
    if (!m || !Number.isSafeInteger(m.id) || m.id < 1 || typeof m.text !== 'string' || typeof m.name !== 'string') continue;
    if (!messages.has(m.id) && m.playerId !== state.me?.playerId) added++;
    messages.set(m.id, m);
  }
  return { code: frame.code, messages: [...messages.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY_LIMIT),
    liveSeq: previous.liveSeq + (history ? 0 : added) };
}

export function normalizeChatAnchor(anchor) {
  return { x: Number.isFinite(anchor?.x) ? Math.max(0, Math.min(1, anchor.x)) : 0,
    y: Number.isFinite(anchor?.y) ? Math.max(0, Math.min(1, anchor.y)) : 0.72 };
}

/** An anchor is relative to the available area, so resizing / expanding cannot strand the handle off screen. */
export function chatPosition(anchor, size, viewport) {
  const safe = normalizeChatAnchor(anchor);
  return { x: viewport.x + 8 + safe.x * Math.max(0, viewport.width - size.width - 16),
    y: viewport.y + 8 + safe.y * Math.max(0, viewport.height - size.height - 16) };
}

export function chatAnchor(position, size, viewport) {
  return normalizeChatAnchor({ x: (position.x - viewport.x - 8) / Math.max(1, viewport.width - size.width - 16),
    y: (position.y - viewport.y - 8) / Math.max(1, viewport.height - size.height - 16) });
}

/** Keep the result's return button clickable while respecting a freely chosen chat anchor elsewhere. */
export function avoidChatControls(position, size, viewport) {
  const overlap = p => (viewport.avoid || []).reduce((sum, r) => sum +
    Math.max(0, Math.min(p.x + size.width, r.right) - Math.max(p.x, r.left)) *
    Math.max(0, Math.min(p.y + size.height, r.bottom) - Math.max(p.y, r.top)), 0);
  if (!overlap(position)) return position;
  const candidates = [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map(a => chatPosition(a, size, viewport));
  return candidates.sort((a, b) => overlap(a) - overlap(b))[0];
}
