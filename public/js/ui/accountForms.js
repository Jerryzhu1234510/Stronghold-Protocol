// public/js/ui/accountForms.js — 账号界面：标题页的登录/注册卡片、账号菜单（改代号 / 改密码 / 退出）。
//
// 设计取舍：
//   · **登录是可选的**。没登录照样能玩（匿名流程一点没动）—— 所以卡片默认是收起的一行，不是挡住"开始"的对话框。
//   · **登录后代号输入框变成只读**：服务器按账号资料决定名字（「代号#编号」），客户端改它没有意义。要改代号走账号菜单。
//   · 界面文案全部走 `t()`（public/i18n/en.json 里都有），错误按服务端返回的**稳定 code** 选文案，不显示英文原码。
//   · 提交中禁用按钮（网络慢时不会重复注册）。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, TextField, Modal } from './components.js';
import { toast } from './toasts.js';
import { AccountTrophies } from './accountTrophies.js';
import { t, N_ } from '../../../shared/i18n.js';
import {
  accountProfile, accountToken, clearAccount, isSignedIn, checkCredentials, login, register, logout,
  USERNAME_PATTERN, PASSWORD_MIN, NICKNAME_MAX,
} from '../account.js';

/** 服务端的错误码 → 玩家看得懂的话。没列到的码原样显示（至少能拿去搜）。 */
const ERROR_TEXT = {
  INVALID_USERNAME: N_('用户名只能用 3–20 位字母、数字或下划线'),
  INVALID_PASSWORD: N_('密码至少 8 位'),
  INVALID_NICKNAME: N_('请输入博士代号'),
  USERNAME_TAKEN: N_('这个用户名已经被用了'),
  NICKNAME_FULL: N_('这个代号的名额满了，换一个'),
  BAD_CREDENTIALS: N_('用户名或密码不对'),
  TOO_MANY_ATTEMPTS: N_('尝试太频繁了，等一分钟再试'),
  ACCOUNT_INCOMPLETE: N_('这个账号的资料不完整，请联系管理员'),
  INTERNAL: N_('服务器出错了，稍后再试'),
  HTTP: N_('连不上服务器'),
  CROSS_ORIGIN: N_('请求被拒绝（跨站）'),
};

/** 把一个错误对象翻成文案。 */
export function accountErrorText(err) {
  const code = err?.code;
  if (code && ERROR_TEXT[code]) return t(ERROR_TEXT[code]);
  if (err?.message && !/^HTTP \d+$/.test(err.message)) return err.message;
  return t(N_('操作失败，请稍后再试'));
}

/** 一行「已登录」摘要（标题页与账号菜单共用）。 */
export function AccountBadge({ class: cls }) {
  const p = accountProfile();
  if (!p) return null;
  const initial = [...p.name][0] || '?';
  return html`<span class=${`acc-badge ${cls || ''}`}>
    ${p.avatarUrl
      ? html`<img class="acc-badge__img" src=${p.avatarUrl} alt="" referrerpolicy="no-referrer" />`
      : html`<span class="acc-badge__img acc-badge__img--initial">${initial}</span>`}
    <b class="acc-badge__name">${p.name}</b>
  </span>`;
}

/**
 * 标题页的账号卡片。
 * @param {{ onSignedIn?: (profile: object) => void, onSignedOut?: () => void }} props
 */
export function AccountCard({ onSignedIn = null, onSignedOut = null } = {}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('login');            // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // 登录状态可能在别处变化（账号菜单退出）⇒ 每次渲染重新读一次（便宜：一次 localStorage 读）
  const [, bump] = useState(0);
  const signedIn = isSignedIn();
  const profile = accountProfile();

  useEffect(() => {
    if (signedIn) { setOpen(false); setPassword(''); setErr(null); }
  }, [signedIn]);

  const credErr = checkCredentials({ username, password });
  const nickOk = mode === 'login' || (nickname.trim().length > 0 && [...nickname].length <= NICKNAME_MAX);
  const canSubmit = !busy && !credErr && nickOk;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const fn = mode === 'register' ? register : login;
      const body = mode === 'register' ? { username, password, nickname } : { username, password };
      const r = await fn(body);
      // 参数要传给 `t()`，不是 `N_()` —— `N_` 只是「这是待翻译文案」的标记，**不做占位符替换**。
      // 一开始写成 `t(N_('已登录：{name}', {...}))`，浏览器里就真的显示了「已登录：{name}」。
      toast(t('已登录：{name}', { name: r.profile.name }), 'success');
      onSignedIn?.(r.profile);
      bump((n) => n + 1);
    } catch (e2) {
      setErr(accountErrorText(e2));
    } finally {
      setBusy(false);
    }
  };

  if (signedIn) {
    return html`<div class="acc-card acc-card--in">
      <div class="acc-card__row">
        <${AccountBadge} />
        <${MicroLabel} tone="mint">ACCOUNT<//>
        <button type="button" class="acc-card__signout tapx" disabled=${busy}
          onClick=${async () => { setBusy(true); await logout(); setBusy(false); bump((n) => n + 1); onSignedOut?.(); }}>
          ${t('退出')}
        </button>
      </div>
    </div>`;
  }

  if (!open) {
    return html`<div class="acc-card">
      <button type="button" class="acc-card__toggle tapx" onClick=${() => { setMode('login'); setErr(null); setOpen(true); }}>
        <${Icon} name="user" />
        <span>${t('登录 / 注册')}</span>
        <span class="acc-card__why">${t('登录后战绩、好友与配置会跟着账号走')}</span>
      </button>
    </div>`;
  }

  const isReg = mode === 'register';
  return html`<form class="acc-card acc-card--form" onSubmit=${submit}>
    <div class="acc-card__tabs">
      <button type="button" class=${`acc-tab tapx${isReg ? '' : ' is-on'}`} disabled=${busy}
        onClick=${() => { setMode('login'); setErr(null); }}>${t('登录')}</button>
      <button type="button" class=${`acc-tab tapx${isReg ? ' is-on' : ''}`} disabled=${busy}
        onClick=${() => { setMode('register'); setErr(null); }}>${t('注册')}</button>
      <button type="button" class="acc-card__close tapx" aria-label=${t('取消')} disabled=${busy}
        onClick=${() => { setOpen(false); setErr(null); setPassword(''); }}><${Icon} name="close" /></button>
    </div>

    <!-- 字段用 size="md"（不是默认的 lg）：整张卡片的高度直接决定它会不会被顶出屏幕，
         而这个屏在小窗口里装不下（见 account.css 头注的实测数字）。 -->
    <${TextField} size="md" label=${t('用户名')} micro="USERNAME" icon="user" value=${username}
      placeholder=${t('3–20 位字母、数字或下划线')} autoFocus=${true} disabled=${busy}
      invalid=${!!username && !USERNAME_PATTERN.test(username)}
      transform=${(v) => String(v).replace(/\s/g, '').slice(0, 20)}
      onInput=${setUsername} onEnter=${submit} />
    <!-- 密码规则**就写在输入框下面**：以前只在卡片底部显示，而提交按钮是禁用的 ——
         填了 4 位密码的人看不到原因，只会觉得「点了没反应」。 -->
    <${TextField} size="md" label=${t('密码')} micro="PASSWORD" icon="key" type="password" value=${password}
      placeholder=${t('至少 {PASSWORD_MIN} 位', { PASSWORD_MIN })} disabled=${busy}
      invalid=${!!password && [...password].length < PASSWORD_MIN}
      hint=${password && [...password].length < PASSWORD_MIN
        ? t('还差 {n} 位（至少 {PASSWORD_MIN} 位）', { n: PASSWORD_MIN - [...password].length, PASSWORD_MIN })
        : null}
      onInput=${setPassword} onEnter=${submit} />
    ${isReg ? html`<${TextField} size="md" label=${t('博士代号')} micro="CALLSIGN" icon="user" value=${nickname}
      placeholder=${t('其他玩家看到的名字（最多 {NICKNAME_MAX} 字）', { NICKNAME_MAX })} disabled=${busy}
      maxLength=${NICKNAME_MAX} onInput=${setNickname} onEnter=${submit} />` : null}

    ${err ? html`<div class="acc-card__err" role="alert">${err}</div>` : null}

    <${Button} variant="primary" size="md" block=${true} type="submit" loading=${busy} disabled=${!canSubmit}>
      ${isReg ? t('注册并登录') : t('登录')}<//>
    <!-- 两句解释合成一行：卡片每高一点，底部越可能被顶出屏幕 -->
    <div class="acc-card__note">
      ${t('用户名只用于登录，别人看不到（他们看到的是「代号#编号」）· 不登录也能玩，只是不保存战绩。')}
    </div>
  </form>`;
}

/**
 * 账号菜单（已登录时用）：改代号、改密码、退出。
 * @param {{ open: boolean, onClose: () => void, onChanged?: (profile: object) => void, onSignedOut?: () => void }} props
 */
export function AccountModal({ open, onClose, onChanged = null, onSignedOut = null }) {
  const [nickname, setNickname] = useState('');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const profile = accountProfile();

  useEffect(() => {
    if (open) { setNickname(profile?.nickname || ''); setCur(''); setNext(''); setErr(null); }
  }, [open]);

  if (!profile) return null;

  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr(accountErrorText(e)); } finally { setBusy(false); }
  };

  const rename = () => run(async () => {
    const { accountFetch } = await import('../account.js');
    const r = await accountFetch('/api/me/nickname', { method: 'POST', body: { nickname } });
    const { setAccount } = await import('../account.js');
    setAccount(accountToken(), r.profile);
    toast(t('代号已改为 {name}', { name: r.profile.name }), 'success');
    onChanged?.(r.profile);
  });

  const changePw = () => run(async () => {
    const { accountFetch } = await import('../account.js');
    await accountFetch('/api/me/password', { method: 'POST', body: { current: cur, next } });
    setCur(''); setNext('');
    toast(t(N_('密码已修改，其他设备已退出登录')), 'success');
  });

  const signOut = () => run(async () => {
    await logout();
    onSignedOut?.();
    onClose?.();
  });

  return html`<${Modal} open=${open} onClose=${onClose} title=${t('账号')} micro="ACCOUNT">
    <div class="acc-modal">
      <div class="acc-modal__id">
        <${AccountBadge} />
        <${MicroLabel}>${profile.provider === 'github' ? 'GITHUB' : 'PASSWORD'}<//>
      </div>
      <${AccountTrophies} class="account-trophies--detail" />

      <${TextField} size="sm" label=${t('博士代号')} micro="CALLSIGN" icon="user" value=${nickname} maxLength=${NICKNAME_MAX}
        disabled=${busy} onInput=${setNickname} />
      <${Button} size="sm" disabled=${busy || !nickname.trim() || nickname === (profile.nickname || '')} onClick=${rename}>
        ${t('保存代号')}<//>

      <hr class="acc-modal__sep" />
      <${TextField} size="sm" label=${t('当前密码')} micro="CURRENT" icon="key" type="password" value=${cur} disabled=${busy} onInput=${setCur} />
      <${TextField} size="sm" label=${t('新密码')} micro="NEW" icon="key" type="password" value=${next} disabled=${busy}
        placeholder=${t('至少 {PASSWORD_MIN} 位', { PASSWORD_MIN })} onInput=${setNext} />
      <${Button} size="sm" disabled=${busy || !cur || [...next].length < PASSWORD_MIN} onClick=${changePw}>
        ${t('修改密码')}<//>
      <div class="acc-modal__note">${t('修改密码后其他设备会退出登录，本设备保持。')}</div>

      ${err ? html`<div class="acc-card__err" role="alert">${err}</div>` : null}

      <hr class="acc-modal__sep" />
      <${Button} variant="ghost" size="sm" icon="exit" onClick=${signOut} disabled=${busy}>${t('退出登录')}<//>
    </div>
  <//>`;
}

export { USERNAME_PATTERN, PASSWORD_MIN, NICKNAME_MAX };
