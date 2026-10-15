// One account writer for all immutable game releases. Runs only in the fixed gateway.
import fs from 'node:fs';
import path from 'node:path';
import { AccountStore, validTrophyTable } from './store.js';
import { Accounts } from './auth.js';
import { Friends } from './friends.js';
import { History } from './history.js';
import { Preferences } from './preferences.js';
import { Backup } from './backup.js';
import { createHistoryRecorder } from './history-hook.js';
import { createApi } from '../http/api.js';

export function createAccountAuthority({ file, allowCreate = false, log = console } = {}) {
  if (!file) throw new Error('必须指定发布目录之外的 SP_ACCOUNTS_FILE');
  file = path.resolve(file);
  if (!allowCreate && !fs.existsSync(file)) throw new Error('账号库不存在；已拒绝以空库上线');
  // Validate before constructing the legacy store: never rename a bad production DB and start empty.
  if (fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== 1 || !value.users || !value.accounts
      || ['users','names','accounts','sessions','friends','history','preferences'].some(k => value[k] != null && (typeof value[k] !== 'object' || Array.isArray(value[k])))
      || !validTrophyTable(value.trophies))
      throw new Error('账号库结构不受支持，未启动');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  const fd = fs.openSync(lock, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(fd);
  let store;
  try { store = new AccountStore({ file }); }
  catch (error) { fs.unlinkSync(lock); throw error; }
  const accounts = new Accounts(store), friends = new Friends(accounts), history = new History(store);
  const preferences = new Preferences(store), backup = new Backup(store, { accounts, friends, history, preferences });
  const api = createApi({ accounts, friends, history, preferences, backup, log });
  const record = createHistoryRecorder({ history, log });
  const leases = new Map();
  let closed = false;
  function rpc(method, params, releaseId) {
    if (closed) throw new Error('账号服务正在停止');
    if (method === 'friendIds') return friends.view(params.accountId).friends.map(p => p.accountId);
    if (method === 'resolve') {
      const accountId = accounts.sessionAccount(params.token);
      if (!accountId) return null;
      let resumeBuild = null;
      for (const lease of leases.values()) {
        if (lease.releaseId !== releaseId && lease.accounts.includes(accountId)) { resumeBuild = lease.releaseId; break; }
      }
      return { accountId, profile: accounts.profileOf(accountId), resumeBuild };
    }
    if (method === 'begin') {
      const ids = [...new Set(params.accounts || [])].filter(id => typeof id === 'string' && store.getProfile(id));
      leases.set(releaseId + ':' + params.matchId, { releaseId, accounts: ids });
      return true;
    }
    if (method === 'finish') {
      const matchId = String(params.meta?.matchId || '').slice(0, 128);
      if (!matchId) throw new Error('结算缺少稳定的对局 ID');
      const players = (params.result?.players || []).map(row => ({ ...row,
        accountId: row?.accountId && store.getProfile(row.accountId)
          && !store.historyOf(row.accountId).some(item => item.matchId === matchId) ? row.accountId : null }));
      const count = record(params.outcome, { ...params.result, players }, { ...params.meta, matchId });
      leases.delete(releaseId + ':' + params.leaseId);
      store.flush();
      if (store._dirty) throw new Error('账号库未能持久保存');
      return count;
    }
    if (method === 'release') { leases.delete(releaseId + ':' + params.matchId); return true; }
    throw new Error('未知账号内部请求');
  }
  return {
    file, store, api, rpc,
    release(id) { for (const [key, lease] of leases) if (lease.releaseId === id) leases.delete(key); },
    close() {
      if (closed) return;
      closed = true;
      store.close();
      if (store._dirty) throw new Error('账号库保存失败，保留写入锁，请检查磁盘');
      fs.unlinkSync(lock);
    },
  };
}
