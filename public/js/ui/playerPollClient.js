import { loadPref, savePref } from '../store.js';
import { CLEMENTIA_POLL, validPollChoice } from '../../../shared/playerPoll.js';

export const isLivePoll = () => typeof window !== 'undefined' && !!window.__SP_GENERATION;
export function pollVoterKey() {
  const keyName = 'playerPoll.voterKey';
  let key = loadPref(keyName, null);
  if (typeof key !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) {
    key = crypto.randomUUID(); savePref(keyName, key);
  }
  if (loadPref(keyName, null) !== key) throw new Error('请允许保存网站数据后投票');
  return key;
}
export async function requestPlayerPoll(action, choice = null, { signal, fetcher = fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
  const res = await fetcher('/api/player-poll', { method: 'POST', cache: 'no-store', signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pollId: CLEMENTIA_POLL.id, voterKey: pollVoterKey(), action, choice }) });
  if (!res.ok) throw new Error(res.status === 429 ? '操作太频繁，请稍后重试' : '投票暂时无法连接，请重试');
  const state = await res.json();
  if (state.pollId !== CLEMENTIA_POLL.id || (state.choice !== null && !validPollChoice(state.choice))
    || !Number.isSafeInteger(state.total) || state.total < 0 || !Array.isArray(state.options)
    || state.options.length !== CLEMENTIA_POLL.options.length
    || state.options.some((o, i) => o.id !== CLEMENTIA_POLL.options[i].id || !Number.isSafeInteger(o.votes) || o.votes < 0
      || !Number.isFinite(o.percent) || o.percent < 0 || o.percent > 100)
    || state.options.reduce((sum, o) => sum + o.votes, 0) !== state.total) {
    throw new Error('投票数据异常，请重试');
  }
  return state;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('投票连接超时，请重试');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
