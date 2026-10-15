import { accountProfile, accountToken, refreshMe } from '../account.js';

/** A cumulative account value, never the current match's award or an avatar number. */
export function totalTrophiesOf(profile, signedIn = true) {
  if (!signedIn || !profile) return null;
  return typeof profile.totalTrophies === 'number' && Number.isFinite(profile.totalTrophies) && profile.totalTrophies >= 0
    ? profile.totalTrophies : 0;
}

export function formatAccountTrophies(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
}

const refreshing = new Map();
function refreshOnce() {
  const token = accountToken();
  if (!token) return Promise.resolve(null);
  if (!refreshing.has(token)) {
    const pending = refreshMe().finally(() => { if (refreshing.get(token) === pending) refreshing.delete(token); });
    refreshing.set(token, pending);
  }
  return refreshing.get(token);
}

/** Refresh at entry / focus, and react immediately to sign-out or another tab's account change. */
export function watchAccountTrophies(onChange, {
  target = globalThis, document = globalThis.document,
  readToken = accountToken, readProfile = accountProfile, refresh = refreshOnce,
} = {}) {
  let active = true, token = readToken();
  const publish = () => { if (active) onChange(totalTrophiesOf(readProfile(), !!readToken())); };
  const reload = () => {
    if (!active || !readToken() || document?.visibilityState === 'hidden') return;
    Promise.resolve().then(refresh).then(publish).catch(() => {});
  };
  const accountChanged = () => {
    const nextToken = readToken(), switched = nextToken !== token;
    token = nextToken;
    publish();
    if (switched && token) reload();
  };
  const storageChanged = event => {
    if (event.key == null || event.key === 'sp.account' || event.key === 'sp.account.profile') accountChanged();
  };
  const visible = () => { if (document?.visibilityState !== 'hidden') reload(); };
  target.addEventListener?.('sp:account-change', accountChanged);
  target.addEventListener?.('storage', storageChanged);
  target.addEventListener?.('focus', reload);
  document?.addEventListener?.('visibilitychange', visible);
  publish();
  reload();
  return () => {
    active = false;
    target.removeEventListener?.('sp:account-change', accountChanged);
    target.removeEventListener?.('storage', storageChanged);
    target.removeEventListener?.('focus', reload);
    document?.removeEventListener?.('visibilitychange', visible);
  };
}
