// One terminal announcement: three 30-second passes, five minutes AFTER each finished pass.
export const ANNOUNCEMENT = Object.freeze({ passes: 3, scrollMs: 30_000, gapMs: 300_000, maxChars: 300 });
export const announcementLifetime = () => ANNOUNCEMENT.passes * ANNOUNCEMENT.scrollMs + (ANNOUNCEMENT.passes - 1) * ANNOUNCEMENT.gapMs;

/** Position within the shared schedule. New/reconnected players join the remaining passes. */
export function announcementPhase(startedAt, now) {
  const elapsed = Math.max(0, now - startedAt);
  if (elapsed >= announcementLifetime()) return { phase: 'done', pass: 3, waitMs: 0 };
  const span = ANNOUNCEMENT.scrollMs + ANNOUNCEMENT.gapMs;
  const pass = Math.floor(elapsed / span);
  const offsetMs = elapsed - pass * span;
  if (offsetMs < ANNOUNCEMENT.scrollMs) return { phase: 'scroll', pass: pass + 1, offsetMs, waitMs: ANNOUNCEMENT.scrollMs - offsetMs };
  return { phase: 'gap', pass: pass + 1, waitMs: span - offsetMs };
}

/** Plain terminal text only; never interpreted as HTML, shell code or a client command. */
export function parseAnnouncementCommand(line) {
  const raw = String(line ?? '').trim();
  const match = /^(?:\/?announce|公告)(?:\s+([\s\S]*))?$/i.exec(raw);
  if (!match) return null;
  const text = (match[1] || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim();
  if (!text || /^help$/i.test(text)) return { action: 'help' };
  if (/^clear$/i.test(text)) return { action: 'clear' };
  if (/^status$/i.test(text)) return { action: 'status' };
  if ([...text].length > ANNOUNCEMENT.maxChars) return { action: 'error', error: `公告最多 ${ANNOUNCEMENT.maxChars} 个字，请缩短内容。` };
  return { action: 'publish', text };
}
