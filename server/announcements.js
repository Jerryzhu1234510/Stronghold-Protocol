import { createInterface } from 'node:readline';
import { sendSession } from './net.js';
import { announcementLifetime, announcementPhase, parseAnnouncementCommand } from '../shared/announcement.js';
import { N_ } from '../shared/i18n.js';

export const ANNOUNCEMENT_HELP = N_('公告：announce 要显示的文字 | announce clear 撤下 | announce status 查看。每遍30秒，结束后间隔5分钟，共3遍。');

// Accessible only through process stdin / server-owner code; no player API can publish announcements.
export function createAnnouncements({ registry, log = console, input = null, now = Date.now, timers = globalThis }) {
  let current = null, sequence = 0, timer = null;
  const frame = () => ({ t: 'server.announcement', announcement: current, serverNow: now() });
  const broadcast = () => { const msg = frame(); for (const session of registry.all()) sendSession(session, msg); };
  const clear = () => { timers.clearTimeout(timer); timer = null; current = null; broadcast(); };
  const publish = text => {
    timers.clearTimeout(timer);
    current = { id: `${now()}-${++sequence}`, text, startedAt: now() };
    broadcast();
    timer = timers.setTimeout(clear, announcementLifetime()); timer?.unref?.();
    return current;
  };
  const command = line => {
    const cmd = parseAnnouncementCommand(line);
    if (!cmd) { if (String(line).trim()) log.info?.(`无法识别指令。${ANNOUNCEMENT_HELP}`); return false; }
    if (cmd.action === 'publish') { publish(cmd.text); log.info?.(`[公告] 已发布：${cmd.text}（共3遍，遍间隔5分钟）`); }
    else if (cmd.action === 'clear') { clear(); log.info?.('[公告] 已撤下。'); }
    else if (cmd.action === 'status') {
      const phase = current ? announcementPhase(current.startedAt, now()) : null;
      log.info?.(phase && phase.phase !== 'done' ? `[公告] ${current.text} · 第${phase.pass}遍${phase.phase === 'gap' ? '间隔等待中' : '滚动中'}` : '[公告] 当前没有公告。');
    } else log.info?.(cmd.error || ANNOUNCEMENT_HELP);
    return true;
  };
  const rl = input ? createInterface({ input, terminal: false, crlfDelay: Infinity }) : null;
  rl?.on('line', command);
  return {
    command,
    sendCurrent(session) {
      if (current && announcementPhase(current.startedAt, now()).phase === 'done') current = null;
      sendSession(session, frame());
    },
    close() { rl?.close(); timers.clearTimeout(timer); timer = null; },
  };
}
