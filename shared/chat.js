// Friend-room chat: one bounded plain-text message per second, with a short in-memory history.
export const CHAT_MAX_LEN = 200;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_INTERVAL_MS = 1000;

export function sanitizeChat(value) {
  if (typeof value !== 'string' || value.length > CHAT_MAX_LEN * 2) return '';
  return value.replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    // Unicode mode treats valid pairs as one character, leaving only unpaired surrogates in this range.
    .replace(/[\ud800-\udfff]/gu, '')
    .trim();
}

export function validChat(value) {
  return typeof value === 'string' && value.length <= CHAT_MAX_LEN * 2
    && [...value].length <= CHAT_MAX_LEN && sanitizeChat(value).length > 0;
}
