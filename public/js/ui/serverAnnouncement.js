import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { createStore, useStore } from '../store.js';
import { announcementPhase, ANNOUNCEMENT } from '../../../shared/announcement.js';

export const announcementStore = createStore({ notice: null, clockOffset: 0 });
export function installAnnouncements(net, target = announcementStore) {
  const offWelcome = net.on('welcome', () => target.set({ notice: null }));
  const offNotice = net.on('server.announcement', msg => {
    const a = msg.announcement;
    const valid = a && typeof a.id === 'string' && typeof a.text === 'string' && a.text.length <= 1200 && Number.isFinite(a.startedAt);
    target.set({ notice: valid ? a : null, clockOffset: Number.isFinite(msg.serverNow) ? msg.serverNow - Date.now() : 0 });
  });
  return () => { offWelcome(); offNotice(); };
}

export function ServerAnnouncementHost() {
  const { notice, clockOffset } = useStore(s => s, Object.is, announcementStore);
  const [tick, setTick] = useState(0);
  const phase = notice ? announcementPhase(notice.startedAt, Date.now() + clockOffset) : null;
  useEffect(() => {
    if (!phase || phase.phase === 'done') return;
    const timer = setTimeout(() => setTick(t => t + 1), phase.waitMs + 20);
    return () => clearTimeout(timer);
  }, [notice, clockOffset, tick]);
  if (!notice || phase.phase !== 'scroll') return null;
  // Preact escapes text. The whole strip passes mouse/touch through to the game underneath.
  return html`<div class="server-announcement" role="status" aria-live="polite" aria-atomic="true">
    <div class="server-announcement__text" key=${`${notice.id}:${phase.pass}`}
      style=${{ '--announcement-duration': `${ANNOUNCEMENT.scrollMs}ms`, '--announcement-delay': `-${phase.offsetMs}ms`, color: notice.text.startsWith('【紧急提醒】') ? '#ff7474' : undefined }}>${notice.text}</div>
  </div>`;
}
