// server/accounts/preferences.js — 跨设备配置同步：登录后，干员调配 / 自选编队 / 语言 / 干员持有 跟着账号走。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 设计依据 fork 的 `GET|POST /api/me/preferences`（docs/ACCOUNTS-HISTORY.md §账号偏好与跨设备同步），但**存储与合并
// 规则是本移植自己定的**，因为它只需要一个 Map：
//
//   · **逐项合并**（不是整份替换）：两台设备各改不同的项，两边的结果都留得住；同一项以**服务端最后接受的**为准。
//   · **按项校验**：每项有自己的形状与大小上限，超了直接拒绝（不要让一次误传把账号配置写坏）。
//   · **设备本地项不同步**：音量、语音语言、静音、伤害数字、画质 —— 那是每台设备各自的事，留在 localStorage。
//   · **首次迁移**：客户端在没有任何云端配置时，把浏览器的旧值**整体上传一次**；云端已有值时不上传（云端优先），
//     所以换设备登录不会把手机上的设置带回电脑。
//
// 存的就是 `{ [accountId]: { [key]: value, updatedAt } }`，落在同一个账号库里（store.db.preferences）。

import { AccountError } from '../../shared/account-protocol.js';

/**
 * 允许同步的项与它的上限。`max` 是 JSON 序列化之后的字节数 —— 用一个宽但有限的上限挡住「把整个素材清单塞进来」。
 * 形状校验刻意宽松（这些是客户端自己的结构，服务端不该与它耦合），只保证**是能存的对象**且**不超过上限**。
 */
export const PREFERENCE_KEYS = Object.freeze({
  /** 干员技能与模组调配。 */
  loadout: { max: 64 * 1024 },
  /** 自选编队（4 个名额）。 */
  diy: { max: 32 * 1024 },
  /** 干员持有（下掉自己没有的干员）。 */
  ownership: { max: 32 * 1024 },
  /** 界面语言。 */
  lang: { max: 64 },
  /** 杂项设置（快捷键等）。 */
  settings: { max: 16 * 1024 },
});

/** 一个账号的配置总上限（防止用很多小项堆爆）。 */
const MAX_TOTAL = 256 * 1024;

const bytesOf = (v) => Buffer.byteLength(JSON.stringify(v ?? null));

export class Preferences {
  constructor(store, { now = Date.now } = {}) {
    this.store = store;
    this.now = now;
    // 这个表跟着账号库一起落盘；老库没有这一项时补上空表
    if (!store.db.preferences || typeof store.db.preferences !== 'object') store.db.preferences = {};
  }

  /** 一个账号的整份配置（空账号给 `{}`）。 */
  get(accountId) {
    const row = this.store.db.preferences[accountId];
    if (!row) return {};
    const out = {};
    for (const k of Object.keys(PREFERENCE_KEYS)) if (row[k] !== undefined) out[k] = row[k];
    return out;
  }

  /** 某个项的值（客户端合并用）。 */
  getKey(accountId, key) {
    return this.store.db.preferences[accountId]?.[key];
  }

  /**
   * 逐项合并更新。只认已知的键；未知键**忽略**（前向兼容：新客户端加了项，老服务端不该炸）。
   * @param {object} patch 例如 `{ lang: 'jp', loadout: [...] }`
   * @returns {object} 合并之后的整份配置
   */
  patch(accountId, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AccountError('INVALID_PATCH');
    // 先整体校验，再落库：一项太大就整份拒绝，不留下「写了一半」的配置
    const incoming = [];
    for (const [k, v] of Object.entries(patch)) {
      const spec = PREFERENCE_KEYS[k];
      if (!spec || v === undefined) continue;                 // 未知项：忽略（前向兼容），不报错
      if (v !== null && bytesOf(v) > spec.max) throw new AccountError('PREFERENCE_TOO_LARGE', 413);
      incoming.push([k, v]);
    }
    const row = (this.store.db.preferences[accountId] ??= {});
    for (const [k, v] of incoming) {
      if (v === null) delete row[k];                          // null = 清掉这一项
      else row[k] = v;
    }
    if (incoming.length) {
      const total = Object.keys(PREFERENCE_KEYS).reduce((n, k) => n + (row[k] === undefined ? 0 : bytesOf(row[k])), 0);
      if (total > MAX_TOTAL) throw new AccountError('PREFERENCES_FULL', 413);
      row.updatedAt = this.now();
      this.store.markDirty();
    }
    return this.get(accountId);
  }

  /** 账号注销时清掉（备份/恢复也用它）。 */
  drop(accountId) {
    if (!this.store.db.preferences[accountId]) return false;
    delete this.store.db.preferences[accountId];
    this.store.markDirty();
    return true;
  }

  /** 有几项、占多少字节（管理统计）。 */
  stats() {
    const rows = Object.values(this.store.db.preferences);
    return { accounts: rows.length, bytes: bytesOf(this.store.db.preferences) };
  }
}
