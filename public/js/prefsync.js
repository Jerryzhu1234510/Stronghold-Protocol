// public/js/prefsync.js — 把「这台设备的配置」同步到账号（跨设备配置同步的客户端半边）。
//
// 与 ui/loadoutSync.js 的分工（容易混，这里说清楚）：
//   `ui/loadoutSync.js` 把配置推给**当前会话**（`room.loadout` / `room.ownership` / `room.diy`）—— 让**这一局**用上；
//   `prefsync.js`（本文件）把配置推给**账号**（`POST /api/me/preferences`）—— 让你**换台设备登录后**还是这套配置。
// 两者互相独立：没登录就没有第二条，游戏本身完全不受影响。
//
// 服务端的语义（server/accounts/preferences.js）：
//   · **逐项合并**：一次只发改过的那几个键，服务端其余项不动；
//   · 每项有大小上限，未知键被忽略（前向兼容）；
//   · `null` 表示清掉这一项。
//
// 客户端的三条规则：
//   1. **登录后先拉**：把云端的值**原样写回 localStorage**（用 `savePref(key, value, /*fromCloud*/ true)`）。
//      原样写是刻意的 —— 这些格式（`{ v: 1, entries }`、`{ v: 1, picks }` …）由各自的 model 解析并做清洗，
//      这里**只搬运**，不认识内容，所以不会因为格式演进而把旧数据弄坏。
//   2. **云端没有的项，用本地的值填一次**（首次登录的迁移）。云端**已有**的项不覆盖 —— 否则换台设备登录会把
//      这台机器的旧配置带过去，覆盖掉你在别处刚改好的。服务端的逐项合并正好就是这个语义：只发云端没有的键。
//   3. **之后每次本地改动都推**（去抖）。改动的来源是 `store.onPrefSave`（`savePref` 的通知）；
//      `fromCloud` 的写入**不回推**，否则会自己推自己。
//
// 同步失败**不打扰玩家**：只写 console 并把状态放进 `prefSync` store（界面想看可以看）。
// 配置同步失败不该打断游戏 —— 这是它与座位/房间同步的本质区别。

import { loadPref, savePref, onPrefSave, createStore } from './store.js';
import { accountFetch, accountToken } from './account.js';

/** 允许同步的键（与服务端 shared/account-protocol.js 的 PREFERENCE_KEYS 一一对应）。 */
export const SYNCED_PREFS = Object.freeze(['loadout', 'diy', 'ownership', 'lang', 'settings']);

/** 去抖：一次拖拽/连点只推一次。 */
export const PUSH_DEBOUNCE_MS = 900;

/** 同步状态（给界面看；'off' = 没登录）。 */
export const prefSync = createStore({ state: 'off', lastAt: 0, error: null });

/** 本地是否已经有一份「这台设备」的值（区别于默认值）。 */
function hasLocal(key) {
  try { return globalThis.localStorage?.getItem(`sp.pref.${key}`) != null; } catch { return false; }
}

/**
 * 把一次改动推给服务器。
 * @param {{ [key: string]: any }} patch
 * @returns {Promise<object|null>} 服务端合并后的整份配置（失败时 null）
 */
async function push(patch, token) {
  const keys = Object.keys(patch);
  if (!keys.length || !token || token !== accountToken()) return null;
  try {
    const r = await accountFetch('/api/me/preferences', { method: 'POST', body: { patch }, token });
    if (token !== accountToken()) return null;
    prefSync.set({ state: 'synced', lastAt: Date.now(), error: null });
    return r.preferences ?? {};
  } catch (e) {
    if (token !== accountToken()) return null;
    // 401 已经由 accountFetch 清掉本地 token；这里只记录，不弹提示
    prefSync.set({ state: e?.status === 401 ? 'off' : 'error', error: e?.code ?? String(e?.message ?? e) });
    return null;
  }
}

/**
 * 装一次（main.js 调用）。返回 `{ pull, flush, dispose }`，测试里都能直接调。
 * @param {{ timers?: { setTimeout: Function, clearTimeout: Function } }} [deps]
 */
export function installPrefSync({ timers } = {}) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  /** 待推送的改动：键 → 值（`null` 也在里面，表示清空）。 */
  let pending = new Map();
  let timer = null;
  let disposed = false;
  /** 已经推给服务器的值（JSON），用来跳过无变化的推。 */
  const sent = new Map();
  /** 正在拉取/迁移的账号，避免并发触发两次。 */
  let pulledFor = null;
  let owner = accountToken();
  function checkOwner() {
    const token = accountToken();
    if (owner !== token) {
      owner = token; pending.clear(); sent.clear(); pulledFor = null;
      T.clearTimeout(timer); timer = null;
    }
    return token;
  }

  const schedule = () => {
    if (disposed) return;
    T.clearTimeout(timer);
    timer = T.setTimeout(() => { timer = null; void flush(); }, PUSH_DEBOUNCE_MS);
  };

  /** 把攒下的改动一次推出去（服务端逐项合并，所以合并成一次请求是安全的）。 */
  async function flush() {
    const token = checkOwner();
    if (disposed || !pending.size) return;
    const patch = Object.fromEntries(pending);
    pending = new Map();
    // 记下来当作「已经推过」，这样同值的重复改动不会再发
    for (const [k, v] of Object.entries(patch)) sent.set(k, JSON.stringify(v));
    const merged = await push(patch, token);
    if (token !== accountToken()) return;
    // 服务端可能因为大小上限拒绝某一项：那种情况下不要把它记成已推，下次改动还会试
    if (merged === null) for (const k of Object.keys(patch)) sent.delete(k);
  }

  /**
   * 登录后拉一次：云端有 ⇒ 写回本地；云端没有的项 ⇒ 用本地值补一次（首次迁移）。
   * 已经为这个账号拉过就跳过（token 变了会重新拉）。
   */
  async function pull() {
    const token = checkOwner();
    if (!token) { prefSync.set({ state: 'off' }); return null; }
    if (pulledFor === token) return null;
    pulledFor = token;
    prefSync.set({ state: 'pulling', error: null });
    let cloud;
    try {
      const r = await accountFetch('/api/me/preferences', { token });
      if (disposed || token !== accountToken()) return null;
      cloud = r.preferences ?? {};
    } catch (e) {
      prefSync.set({ state: e?.status === 401 ? 'off' : 'error', error: e?.code ?? String(e?.message ?? e) });
      if (token !== accountToken()) return null;
      pulledFor = null;               // 允许下次重试
      return null;
    }
    const missing = {};
    for (const key of SYNCED_PREFS) {
      if (cloud[key] !== undefined && cloud[key] !== null) {
        // 云端有 ⇒ 原样写回本地（**只搬运，不解析**：格式由各自的 model 管）
        try { savePref(key, cloud[key], true); } catch { /* 写不进去就算了 */ }
        sent.set(key, JSON.stringify(cloud[key]));
      } else if (hasLocal(key)) {
        // 云端没有、本地有 ⇒ 这是首次登录的迁移，把本地的补上去
        missing[key] = loadPref(key, null);
      }
    }
    if (Object.keys(missing).length) {
      const merged = await push(missing, token);
      if (token !== accountToken()) return null;
      if (merged) for (const [k, v] of Object.entries(merged)) sent.set(k, JSON.stringify(v));
    } else {
      prefSync.set({ state: 'synced', lastAt: Date.now(), error: null });
    }
    return cloud;
  }

  /** 本地改动 → 攒起来等去抖。`fromCloud` 的写入是拉取时自己写的，不回推。 */
  const offSave = onPrefSave((key, value, fromCloud) => {
    checkOwner();
    if (fromCloud || disposed) return;
    if (!SYNCED_PREFS.includes(key)) return;          // recentRooms / lobby.mode 这些是**每台设备自己的**，不同步
    if (!accountToken()) return;                       // 没登录：只写本地
    if (sent.get(key) === JSON.stringify(value)) return; // 值与云端一致，不用推
    pending.set(key, value);
    prefSync.set({ state: 'pending' });
    schedule();
  });

  return {
    pull,
    flush,
    /** 供测试/调试：还没推出去的改动。 */
    pendingKeys: () => [...pending.keys()],
    dispose() { disposed = true; T.clearTimeout(timer); offSave?.(); },
  };
}
