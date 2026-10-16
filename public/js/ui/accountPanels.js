// public/js/ui/accountPanels.js — 好友面板与对局历史面板（挂在大厅顶栏的两个按钮后面）。
//
// 两个面板共用一套「登录了才有」的前提：
//   · 没登录时按钮**不显示**（而不是点了弹「请先登录」）—— 匿名玩家不该看到自己用不了的东西；
//   · 数据每次打开时拉一次（没有实时推送：好友申请不是即时聊天，不值得为此开一条长连接）。
//
// 好友：搜索（按代号 / 代号#编号）→ 发请求 → 对方接受；三列表（好友 / 待我接受 / 我已发出）。
// 历史：列表（时间、难度、回合、胜负、干了什么）→ 点开看整桌结算；按「加载更多」翻页。

import { net } from '../net.js';
import { useStore } from '../store.js';
import { useCallback, useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, TextField, Modal, Panel, Spinner } from './components.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { accountFetch, isSignedIn, accountProfile } from '../account.js';
import { accountErrorText } from './accountForms.js';

// 难度名用共享常量（shared/constants.js 的 DIFFICULTY_NAMES）—— **不要在这里再抄一份**：
// 一开始我写了本地的 { FUNNY: '趣味', ... }，既是重复定义、又绕过了 i18n 的标记（测试直接抓到了）。
const diffLabel = (d) => (DIFFICULTY_NAMES[d] ? t(DIFFICULTY_NAMES[d]) : (d || t('未知')));

const fmtWhen = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 一个玩家一行（结算里的一行）。 */
function ResultRow({ row, self = false }) {
  return html`<li class=${`res-row${self ? ' is-self' : ''}`}>
    <span class="res-row__seat num">P${(row.seat ?? 0) + 1}</span>
    <span class="res-row__name">${row.name}${self ? html` <${MicroLabel} tone="mint">YOU<//>` : null}</span>
    <span class="res-row__op">${t('{n} 名干员', { n: (row.operators || []).length })}</span>
    <span class="res-row__stat num" title=${t('伤害')}>${(row.damageDealt || 0).toLocaleString()}</span>
    <span class="res-row__stat num" title=${t('击杀')}>${row.kills || 0}</span>
    <span class="res-row__stat num" title=${t('漏怪')}>${row.leaked || 0}</span>
    <span class=${`res-row__lp num${row.survived ? ' is-alive' : ' is-down'}`}>${row.lp ?? 0}</span>
  </li>`;
}

// ── 对局历史 ────────────────────────────────────────────────────────────────────────────────────

function HistoryPanel({ onClose }) {
  const [rows, setRows] = useState(null);       // null = 还没加载
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);       // 展开的那一条
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const me = accountProfile();

  const load = useCallback(async (before = null) => {
    setBusy(true);
    setErr(null);
    try {
      const q = before ? `?limit=20&before=${encodeURIComponent(before)}` : '?limit=20';
      const r = await accountFetch(`/api/me/history${q}`);
      const got = r.matches || [];
      setRows((prev) => (before && prev ? [...prev, ...got] : got));
      if (got.length < 20) setDone(true);
    } catch (e) {
      if (e.status === 401) { setErr(t('登录已过期，请重新登录')); return; }
      setErr(accountErrorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = (rows || []).reduce((a, r) => {
    a.total++;
    if (r.status === 'completed') { a.done++; if (r.victory) a.wins++; }
    a.rounds = Math.max(a.rounds, r.rounds || 0);
    return a;
  }, { total: 0, done: 0, wins: 0, rounds: 0 });

  return html`<${Panel} class="hist-panel" tone="mint">
    <div class="panel-head">
      <${MicroLabel} tone="mint">BATTLE RECORD<//>
      <h3>${t('对局历史')}</h3>
      <button type="button" class="panel-close tapx" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </div>

    ${rows === null ? html`<div class="hist-loading"><${Spinner} size="sm" label="LOADING" /></div>` : null}
    ${err ? html`<div class="acc-card__err" role="alert">${err}</div>` : null}
    ${rows && !rows.length && !err ? html`<div class="hist-empty">${t('还没有对局记录 —— 打一局就有了（需要登录）')}</div>` : null}

    ${rows && rows.length ? html`<div class="hist-sum">
      ${t('共 {total} 局 · 完成 {done} 局 · 胜利 {wins} 局 · 最高第 {rounds} 回合', summary)}
    </div>` : null}

    <ul class="hist-list">
      ${(rows || []).map((r) => html`<li key=${r.matchId} class=${`hist-item${open === r.matchId ? ' is-open' : ''}`}>
        <button type="button" class="hist-item__head tapx" onClick=${() => setOpen(open === r.matchId ? null : r.matchId)}>
          <span class=${`hist-item__mark ${r.victory ? 'is-win' : r.status === 'completed' ? 'is-loss' : 'is-out'}`}>
            ${r.victory ? t('胜') : r.status === 'completed' ? t('败') : t('中断')}
          </span>
          <span class="hist-item__when num">${fmtWhen(r.endedAt)}</span>
          <span class="hist-item__mode">${r.mode === 'solo' ? t('独立模拟') : t('同盟')} · ${diffLabel(r.difficulty)}</span>
          <span class="hist-item__rounds num">${t('第 {n} 回合', { n: r.rounds || 0 })}</span>
          <span class="hist-item__ops num">${t('{n} 名干员', { n: (r.operators || []).length })}</span>
          ${r.hiddenCleared ? html`<span class="hist-item__hidden">${t('隐藏已通')}</span>` : null}
          <${Icon} name=${open === r.matchId ? 'chevronLeft' : 'chevronRight'} class="hist-item__chev" />
        </button>
        ${open === r.matchId ? html`<div class="hist-item__body">
          <div class="hist-stats">
            <span>${t('击杀 {n}', { n: r.stats?.kills ?? 0 })}</span>
            <span>${t('伤害 {n}', { n: (r.stats?.dmgDealt ?? 0).toLocaleString() })}</span>
            <span>${t('漏怪 {n}', { n: r.stats?.leaks ?? 0 })}</span>
            <span>${t('Boss 伤害 {n}', { n: (r.stats?.bossDamage ?? 0).toLocaleString() })}</span>
            ${r.stats?.gold != null ? html`<span>${t('资金 {n}', { n: r.stats.gold })}</span>` : null}
          </div>
          ${r.rows && r.rows.length ? html`<ul class="res-rows">
            ${r.rows.map((row) => html`<${ResultRow} key=${row.seat} row=${row} self=${row.name === me?.name} />`)}
          </ul>` : null}
        </div>` : null}
      </li>`)}
    </ul>

    ${rows && rows.length && !done ? html`<div class="hist-more">
      <${Button} size="sm" loading=${busy} onClick=${() => load(rows[rows.length - 1].endedAt)}>${t('加载更多')}<//>
    </div>` : null}
  <//>`;
}

// ── 好友 ────────────────────────────────────────────────────────────────────────────────────────

/** 一行好友/请求。`kind` 决定右边显示什么按钮。 */
function FriendRow({ p, kind, busy, onAccept, onRemove, onRequest, presence, canInvite, onRoom }) {
  const initial = [...(p.name || '?')][0] || '?';
  return html`<li class="fr-row">
    <span class="fr-row__img">
      ${p.avatarUrl ? html`<img src=${p.avatarUrl} alt="" referrerpolicy="no-referrer" />` : html`<span class="fr-row__initial">${initial}</span>`}
    </span>
    <span class="fr-row__name">${p.name}${kind === 'friend' ? html`<small class="fr-room-state">${presence?.online ? presence.room ? `${presence.room.inMatch ? t('对局中') : t('房间等待中')} · ${presence.room.code}` : t('在线大厅') : t('离线 / 旧版本对局')}</small>` : null}</span>
    <span class="fr-row__acts">
      ${kind === 'incoming' ? html`<${Button} size="sm" variant="primary" disabled=${busy} onClick=${() => onAccept(p)}>${t('接受')}<//>` : null}
      ${kind === 'outgoing' ? html`<span class="fr-row__wait">${t('等待对方接受')}</span>` : null}
      ${kind === 'found' ? html`<${Button} size="sm" disabled=${busy} onClick=${() => onRequest(p)}>${t('加好友')}<//>` : null}
      ${kind === 'friend' && presence?.online ? html`
        ${canInvite ? html`<${Button} size="sm" disabled=${busy} onClick=${() => onRoom(p, 'invite')}>${t('邀请进房')}<//>` : null}
        ${presence.room?.canJoin ? html`<${Button} size="sm" disabled=${busy} onClick=${() => onRoom(p, 'join')}>${t('申请加入')}<//>` : null}
        ${presence.room?.canSpectate ? html`<${Button} size="sm" disabled=${busy} onClick=${() => onRoom(p, 'spectate')}>${t('申请观战')}<//>` : null}
      ` : null}
      ${kind === 'friend' ? html`<${Button} size="sm" variant="ghost" disabled=${busy} onClick=${() => onRemove(p)}>${t('移除')}<//>` : null}
      ${kind === 'incoming' ? html`<${Button} size="sm" variant="ghost" disabled=${busy} onClick=${() => onRemove(p)}>${t('拒绝')}<//>` : null}
    </span>
  </li>`;
}

function FriendsPanel({ onClose }) {
  const room = useStore(s => s.room);
  const me = useStore(s => s.me);
  const [social, setSocial] = useState({ friends: [], tickets: [] });
  const canInvite = room?.mode === 'coop' && !room.inMatch && !room.matchmaking && room.seats?.some(s => s?.playerId === me.playerId);
  const socialLoad = () => net.request('friends.state').catch(() => {});
  useEffect(() => {
    const off = net.on('friends.state', setSocial);
    socialLoad();
    const timer = setInterval(() => { if (!document.hidden) socialLoad(); }, 5000);
    return () => { off(); clearInterval(timer); };
  }, []);
  const roomAction = async (type, body) => {
    setBusy(true); setErr(null);
    try {
      await net.request(type, body);
      if (type === 'friends.send') toast(t('已发送，请在好友面板查看处理结果'), 'success');
      if (type === 'friends.enter') onClose();
      else await socialLoad();
    } catch (e) { setErr(e.detail || e.message || t('房间请求失败')); }
    finally { setBusy(false); }
  };
  const [view, setView] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await accountFetch('/api/friends'));
      setErr(null);
    } catch (e) {
      if (e.status === 401) { setErr(t('登录已过期，请重新登录')); return; }
      setErr(accountErrorText(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** 跑一个会改变关系的动作，然后重新拉一遍列表。 */
  const act = useCallback(async (path, body, okText) => {
    setBusy(true);
    setErr(null);
    try {
      await accountFetch(path, { method: 'POST', body });
      if (okText) toast(okText, 'success');
      await load();
      return true;
    } catch (e) {
      setErr(accountErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);

  const search = async () => {
    const word = q.trim();
    if (!word) { setFound(null); return; }
    setSearching(true);
    setErr(null);
    try {
      const r = await accountFetch(`/api/users?q=${encodeURIComponent(word)}`);
      const known = new Set([...(view?.friends || []), ...(view?.incoming || []), ...(view?.outgoing || [])].map((x) => x.accountId));
      setFound((r.users || []).filter((u) => !known.has(u.accountId)));
    } catch (e) {
      setErr(accountErrorText(e));
    } finally {
      setSearching(false);
    }
  };

  const friends = view?.friends || [];
  const incoming = view?.incoming || [];
  const outgoing = view?.outgoing || [];

  return html`<${Panel} class="fr-panel" tone="mint">
    <div class="panel-head">
      <${MicroLabel} tone="mint">FRIENDS<//>
      <h3>${t('好友')}</h3>
      ${incoming.length ? html`<span class="fr-badge num">${incoming.length}</span>` : null}
      <button type="button" class="panel-close tapx" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </div>

    <div class="fr-search">
      <${TextField} icon="search" value=${q} placeholder=${t('按「代号」或「代号#编号」找人')}
        onInput=${setQ} onEnter=${search} />
      <${Button} size="sm" icon="search" loading=${searching} disabled=${!q.trim()} onClick=${search}>${t('搜索')}<//>
    </div>
    <div class="fr-hint">${t('好友是按「代号#编号」加的 —— 用户名只有自己看得到。')}</div>

    ${err ? html`<div class="acc-card__err" role="alert">${err}</div>` : null}
    <div class="fr-sec"><div class="fr-sec__title">${t('房间邀请与申请 · 2分钟有效')}</div>
      <p class="fr-hint">${t('仅同一版本的好友显示房间。申请由房主处理；通过后仍需本人点击进入。满员、开局或房主变更后需重新申请。')}</p>
      ${social.tickets.length ? social.tickets.map(x => html`<div key=${x.id} class="fr-room-ticket">
        <span>${x.name} · ${x.kind === 'invite' ? t('邀请加入') : x.mode === 'spectate' ? t('申请观战') : t('申请加入')} · ${x.code}<small class="fr-room-state">${x.status === 'approved' ? t('已通过') : x.incoming ? t('等待你处理') : t('已发送，等待处理')}</small></span>
        ${x.incoming && x.status === 'pending' ? html`<${Button} size="sm" disabled=${busy} onClick=${() => roomAction('friends.decide', { id: x.id, accept: true })}>${t('同意')}<//><${Button} size="sm" disabled=${busy} onClick=${() => roomAction('friends.decide', { id: x.id, accept: false })}>${t('拒绝')}<//>` : null}
        ${x.enter ? html`<${Button} size="sm" variant="primary" disabled=${busy} onClick=${() => roomAction('friends.enter', { id: x.id })}>${x.mode === 'spectate' ? t('进入观战') : t('进入房间')}<//>` : null}
      </div>`) : html`<div class="fr-hint">${t('暂无房间消息')}</div>`}
    </div>
    ${found === null ? null : html`<div class="fr-sec">
      <div class="fr-sec__title">${found.length ? t('搜索结果') : t('没找到（或者已经加过了）')}</div>
      <ul class="fr-list">${found.map((p) => html`<${FriendRow} key=${p.accountId} p=${p} kind="found" busy=${busy}
        onRequest=${(x) => act('/api/friends/request', { accountId: x.accountId }, t('已发出好友请求'))} />`)}</ul>
    </div>`}

    ${incoming.length ? html`<div class="fr-sec">
      <div class="fr-sec__title">${t('待我接受')}</div>
      <ul class="fr-list">${incoming.map((p) => html`<${FriendRow} key=${p.accountId} p=${p} kind="incoming" busy=${busy}
        onAccept=${(x) => act('/api/friends/accept', { accountId: x.accountId }, t('已添加好友'))}
        onRemove=${(x) => act('/api/friends/remove', { accountId: x.accountId })} />`)}</ul>
    </div>` : null}

    ${outgoing.length ? html`<div class="fr-sec">
      <div class="fr-sec__title">${t('我已发出')}</div>
      <ul class="fr-list">${outgoing.map((p) => html`<${FriendRow} key=${p.accountId} p=${p} kind="outgoing" busy=${busy}
        onRemove=${(x) => act('/api/friends/remove', { accountId: x.accountId }, t('已撤回请求'))} />`)}</ul>
    </div>` : null}

    <div class="fr-sec">
      <div class="fr-sec__title">${friends.length ? t('好友 · {n}', { n: friends.length }) : t('好友')}</div>
      ${friends.length
        ? html`<ul class="fr-list">${friends.map((p) => html`<${FriendRow} key=${p.accountId} p=${p} kind="friend" busy=${busy}
            presence=${social.friends.find(x => x.accountId === p.accountId)} canInvite=${canInvite}
            onRoom=${(x, kind) => roomAction('friends.send', { accountId: x.accountId, kind })}
            onRemove=${(x) => act('/api/friends/remove', { accountId: x.accountId }, t('已移除好友'))} />`)}</ul>`
        : html`<div class="fr-empty">${t('还没有好友 —— 用上面的搜索按「代号#编号」加一个')}</div>`}
    </div>
  <//>`;
}

// ── 入口 ────────────────────────────────────────────────────────────────────────────────────────

/**
 * 大厅顶栏的两个按钮 + 面板。未登录时**渲染 null**（匿名玩家看不到用不了的东西）。
 */
export function AccountPanels({ friendsOnly = false }) {
  const [tab, setTab] = useState(null);        // null | 'friends' | 'history'
  // 登录状态变化（在别处退出/登录）时要跟着变 ⇒ 每次渲染都问一次（一次 localStorage 读，很便宜）
  if (!isSignedIn()) return null;
  return html`<div class="acc-panels">
    <${Button} variant="secondary" size="sm" icon="users" active=${tab === 'friends'}
      class="lobby-friends" label=${t('好友')} onClick=${() => setTab(tab === 'friends' ? null : 'friends')}>
      ${t('好友')}<//>
    ${friendsOnly ? null : html`<${Button} variant="secondary" size="sm" icon="book" active=${tab === 'history'}
      class="lobby-history" label=${t('对局历史')} onClick=${() => setTab(tab === 'history' ? null : 'history')}>
      ${t('对局历史')}<//>`}
    ${tab ? html`<${Modal} open=${true} onClose=${() => setTab(null)} width="min(8.6rem,94vw)" class="account-panel-dialog">
      ${tab === 'friends' ? html`<${FriendsPanel} onClose=${() => setTab(null)} />` : html`<${HistoryPanel} onClose=${() => setTab(null)} />`}
    <//>` : null}
  </div>`;
}

net.on('friends.notice', msg => toast(msg.text, 'info', { ttl: 10000 }));
