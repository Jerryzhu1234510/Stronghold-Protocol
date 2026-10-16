// Player settings (BGM/SFX/voice volume, mute, damage numbers, render quality, the shortcut keys): a tiny observable
// store persisted in localStorage (`sp.pref.settings`), applied to the audio manager on every change, plus
// the settings modal — which also holds the language switch (ui/lang.js; kept apart in `sp.pref.lang`; under it a note
// while the current language's pack is a machine translation, `_meta.machineTranslated`) and the 快捷键
// section that rebinds the in-match shortcuts (the key map: ui/gameLogic/shortcuts.js; the community request
// 「快捷键可不可以自己设置」, the owner's decision of 2026-10-07).

import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref, onPrefSave } from '../store.js';
import { sanitizeSettings, HOTKEY_ACTIONS, DEFAULT_HOTKEYS, hotkeyLabel, rebindHotkey, isDefaultHotkeys, captureHotkey } from './gameLogic.js';
import { audio } from '../audio.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';
import { LangToggle, machineTranslationNote } from './lang.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { cacheSupported, resourceCacheAction, networkPreloadAllowed } from '../resources/client.js';
import { isBundledClient } from '../resources/manifest.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

function ResourceCacheSetting({ open }) {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const supported = cacheSupported(), localOnly = !networkPreloadAllowed(), native = isBundledClient();
  const action = async (name, extra) => {
    setBusy(true); setError('');
    try { setStatus(await resourceCacheAction(name, extra)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  useLayoutEffect(() => {
    if (!open || !supported) return;
    let alive = true;
    const refresh = () => resourceCacheAction(localOnly ? 'local-ready' : 'status').then(value => { if (alive) { setStatus(value); setError(''); } })
      .catch(err => { if (alive) setError(err.message); });
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [open, supported, localOnly]);
  if (localOnly) return html`<div class="set-resource-cache">
    ${native ? html`<div class="set-row"><span class="set-row__label">客户端内置素材<${MicroLabel}>BUNDLED RESOURCES<//></span><strong>已启用</strong></div>
      <p class="set-hint">联网预下载已关闭，不会再批量下载已有素材。缺少素材时请使用客户端资源补全包。</p>` : html`
    <div class="set-row"><span class="set-row__label">本地素材读取<${MicroLabel}>LOCAL RESOURCES<//></span><strong>已启用</strong></div>
    <p class="set-hint" role="status">${error || `本页本地读取 ${status?.hits ?? 0} 次；缺失 ${status?.localMisses ?? 0} 次。`}</p>
    <p class="set-hint">素材直接读取已导入的资源库，不会自动下载。缺音乐／语音时暂时静音；缺图片／模型时请补导两个资源包。已有素材继续有效，请不要清除站点数据。</p>
    <a class="set-key" href="/#resource-pack">返回选服大厅补导资源</a>`}
  </div>`;
  return html`<div class="set-resource-cache">
    <div class="set-row">
      <span class="set-row__label">素材本地缓存<${MicroLabel}>RESOURCE CACHE<//></span>
      <button type="button" class=${`set-toggle${status?.enabled ? ' is-on' : ''}`} role="switch"
        aria-label="素材本地缓存" aria-checked=${status?.enabled ? 'true' : 'false'} disabled=${!supported || !status || busy}
        onClick=${() => action('enable', { enabled: !status.enabled })}><i></i><span>${status?.enabled ? '开启' : '关闭'}</span></button>
    </div>
    <p class="set-hint" role="status">${!supported ? '当前浏览器或网址不支持本地缓存；正式站需使用 HTTPS。游戏仍可正常联网加载。' :
      error || (status ? `已缓存 ${status.files} 个素材 · ${(status.bytes / 1048576).toFixed(1)} MB / ${(status.limit / 1048576).toFixed(0)} MB` : '正在检查素材缓存…')}</p>
    <p class="set-hint">素材按内容缓存，更新后复用未改变的文件。可从大厅“资源预加载”提前下载完整素材；进房后暂停预下载，对局仍需联网。</p>
    ${status ? html`<p class="set-hint">本次缓存服务已复用 ${status.hits} 次素材，减少下载约 ${(status.savedBytes / 1048576).toFixed(1)} MB。</p>` : null}
    <div class="set-cache-actions">
      <button type="button" class="set-key" disabled=${!supported || busy} onClick=${() => action('status')}>查看缓存</button>
      <button type="button" class="set-key" disabled=${!supported || busy || !status?.files} onClick=${() => action('clear')}>清空素材缓存</button>
    </div>
  </div>`;
}

/** Settings store: { bgm, sfx, voice, muted, damageNumbers, quality, keys }. */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));

let applyingCloud = false;
onPrefSave((key, value, fromCloud) => {
  if (key !== 'settings' || !fromCloud) return;
  applyingCloud = true;
  try { settingsStore.set(sanitizeSettings(value)); } finally { applyingCloud = false; }
});
settingsStore.subscribe((s) => {
  if (!applyingCloud) savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
  audio.setVoiceLang(s.voiceLang);
});
audio.setVolumes(settingsStore.get());
audio.setVoiceLang(settingsStore.get().voiceLang);

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);

/**
 * The label of the key a rebindable shortcut has right now ('R', 'Space' …) — the HUD's key hints (shop bar, ready /
 * pause, underframe). Read at render: the game screen re-renders when the settings dialog closes.
 * @param {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'} action
 */
export const hotkeyLabelOf = (action) => hotkeyLabel(settingsStore.get().keys?.[action]);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>
  </div>`;
}

const QUALITY = [['high', N_('高')], ['medium', N_('中')], ['low', N_('低')]];
/** The rebindable shortcuts' names (msgids), by action. */
const HOTKEY_NAMES = { refresh: N_('刷新商店'), freeze: N_('冻结 / 解冻商店'), levelUp: N_('升级调度中心'), retreat: N_('撤退选中干员'),
  sell: N_('出售选中干员'), ready: N_('准备就绪 / 暂停（独立模拟）') };

/**
 * 快捷键: each shortcut with its key. Click its key (or Enter / Space on it) and press the new one: Esc cancels (the
 * dialog stays open), Tab leaves, a key held with Ctrl / Alt / ⌘ or one the interface keeps is refused, a key another
 * shortcut has is swapped — the line under the list says what happened; 恢复默认 restores the keys of 0.1.4. Esc
 * (cancel / close) is fixed. On a touch-only device the section says the keys need a keyboard and folds the list (an
 * attached keyboard still uses it).
 * @param {{ keys: Record<string, string>, touchUi: boolean }} props
 */
function HotkeySection({ keys, touchUi }) {
  const [waiting, setWaiting] = useState(null); // the action waiting for its new key
  const [note, setNote] = useState(null);       // { text, warn }: the result line
  // a layout effect: the key listener is on as soon as the key shows that it waits (an Esc right after the click must
  // end the wait, never reach the dialog's own Esc)
  useLayoutEffect(() => {
    if (!waiting) return undefined;
    const name = t(HOTKEY_NAMES[waiting]);
    const onKey = (e) => {
      const r = captureHotkey(e);
      if (r.kind === 'leave') { setWaiting(null); return; } // Tab: the focus moves on
      // ahead of the dialog's own Esc (it stays open), a focused button's Enter / Space and every other key handler
      e.preventDefault();
      e.stopImmediatePropagation();
      if (r.kind === 'ignore') return;
      const cur = settingsStore.get().keys;
      if (r.kind === 'cancel') {
        setWaiting(null);
        setNote({ text: t('已取消，「{action}」仍是 {key}', { action: name, key: hotkeyLabel(cur[waiting]) }) });
        return;
      }
      if (r.kind === 'refuse') {
        setNote({ warn: true, text: r.reason === 'modifier' ? t('快捷键只能是单个按键，不能搭配 Ctrl、Alt 或 ⌘')
          : t('{key} 不能设为快捷键：Esc、Tab、Enter、方向键和功能键留给界面使用', { key: r.name }) });
        return;
      }
      const res = rebindHotkey(cur, waiting, r.code);
      updateSettings({ keys: res.keys });
      setWaiting(null);
      const key = hotkeyLabel(r.code);
      setNote({ text: res.swapped
        ? t('「{action}」已改为 {key}；「{other}」原来用 {key}，已换成 {old}', { action: name, key, other: t(HOTKEY_NAMES[res.swapped]), old: hotkeyLabel(res.keys[res.swapped]) })
        : t('「{action}」已改为 {key}', { action: name, key }) });
    };
    // a press anywhere but the waiting key ends the wait (another key starts its own)
    const onDown = (e) => { if (!(e.target instanceof Element) || !e.target.closest('.set-key.is-waiting')) setWaiting(null); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [waiting]);

  const status = note ? note.text : waiting ? t('请按下「{action}」的新按键（Esc 取消）', { action: t(HOTKEY_NAMES[waiting]) }) : '';
  const list = html`<ul class="set-keys__list">
    ${HOTKEY_ACTIONS.map((a) => {
      const on = waiting === a;
      const label = hotkeyLabel(keys?.[a]);
      return html`<li key=${a} class="set-keys__row">
        <span class="set-keys__name">${t(HOTKEY_NAMES[a])}</span>
        <button type="button" class=${cx('set-key', on && 'is-waiting')} data-action=${a} aria-pressed=${on ? 'true' : 'false'}
          aria-label=${t('更改「{action}」的快捷键（当前：{key}）', { action: t(HOTKEY_NAMES[a]), key: label })}
          onClick=${() => { setNote(null); setWaiting((w) => (w === a ? null : a)); }}>
          ${on ? html`<span class="set-key__wait">${t('按下新按键…')}</span>` : html`<kbd>${label}</kbd>`}
        </button>
      </li>`;
    })}
    <li class="set-keys__row is-fixed">
      <span class="set-keys__name">${t('取消 / 关闭')}</span>
      <span class="set-key is-fixed"><kbd>Esc</kbd><small>${t('不可更改')}</small></span>
    </li>
  </ul>
  <p class=${cx('set-keys__note', note?.warn && 'is-warn')} role="status" aria-live="polite">${status}</p>`;
  return html`<section class="set-keys" aria-labelledby="set-keys-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-keys-title">${t('快捷键')}<${MicroLabel}>HOTKEYS<//></span>
      <${Button} variant="ghost" size="sm" icon="refresh" class="set-keys__reset" disabled=${isDefaultHotkeys(keys)}
        onClick=${() => { setWaiting(null); updateSettings({ keys: DEFAULT_HOTKEYS }); setNote({ text: t('已恢复默认快捷键') }); }}>${t('恢复默认')}<//>
    </div>
    ${touchUi ? html`<p class="set-hint">${t('快捷键需要实体键盘；触屏设备连接键盘后可用')}</p>
      <details class="set-keys__more"><summary>${t('查看 / 更改快捷键')}</summary>${list}</details>` : list}
  </section>`;
}

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  const mtNote = machineTranslationNote(); // a pack marked as machine translation says so under the switch
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('设置')} micro="SETTINGS" width="7.4rem"
    actions=${html`<${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>${t('玩法说明')}<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="set-list">
      <div class="set-row">
        <span class="set-row__label">${t('语言')}<${MicroLabel}>LANGUAGE<//></span>
        <${LangToggle} class="set-lang" />
      </div>
      ${mtNote ? html`<p class="set-hint set-lang-note" data-testid="lang-mt-note">${mtNote}</p>` : null}
      <${Slider} label=${t('背景音乐')} micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <label class="set-row">
        <span class="set-row__label">语音语言<${MicroLabel}>VOICE LANGUAGE<//></span>
        <select class="set-voice-lang" aria-label="语音语言" value=${s.voiceLang} onChange=${e => updateSettings({ voiceLang: e.currentTarget.value })}>
          <option value="cn">中文</option><option value="jp">日语</option><option value="en">英语</option><option value="off">关闭语音</option>
        </select>
      </label>
      <${Slider} label=${t('干员语音')} micro="VOICE" icon="mic" value=${s.voice} onInput=${(v) => updateSettings({ voice: v })} />
      <${Slider} label=${t('音效')} micro="SFX" icon="signal" value=${s.sfx}
        onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Toggle} label=${t('静音')} micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <${Toggle} label=${t('显示伤害数字')} micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
      <${Toggle} label=${t('官方伤害数字')} micro="OFFICIAL NUMBERS" value=${s.officialDamageNumbers} onChange=${(v) => updateSettings({ officialDamageNumbers: v })} />
      <p class="set-hint">${t('只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。')}</p>
      <${Toggle} label=${t('弹药数量')} micro="AMMO COUNT" value=${s.ammoCount} onChange=${(v) => updateSettings({ ammoCount: v })} />
      <p class="set-hint">${t('弹药类技能开启时，在弹药条下方显示剩余弹药 / 总弹药数（如 13/14）。官方界面没有这个数字。')}</p>
      <div class="set-row">
        <span class="set-row__label">${t('画面质量')}<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${t(label)}</button>`)}
        </div>
      </div>
      <div class="set-row">
        <span class="set-row__label">${t('画面帧率')}<${MicroLabel}>FRAME RATE<//></span>
        <div class="set-seg" role="radiogroup" aria-label=${t('画面帧率')}>
          ${[60, 30].map(fps => html`<button key=${fps} type="button" role="radio" aria-checked=${s.frameRate === fps ? 'true' : 'false'}
            style=${touchUi ? 'min-height:44px;min-width:48px' : undefined}
            tabIndex=${s.frameRate === fps ? 0 : -1} class=${s.frameRate === fps ? 'is-on' : ''}
            onKeyDown=${e => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const next = e.key === 'Home' ? 60 : e.key === 'End' ? 30 : fps === 60 ? 30 : 60;
              updateSettings({ frameRate: next });
              e.currentTarget.parentElement.querySelectorAll('button')[next === 60 ? 0 : 1]?.focus();
            }} onClick=${() => updateSettings({ frameRate: fps })}>${fps} FPS</button>`)}
        </div>
      </div>
      <p class="set-hint">${t('手机卡顿时可选低画质、30 FPS并关闭伤害数字。帧率只影响画面绘制，战斗计算速度保持不变。')}</p>
      <${HotkeySection} keys=${s.keys} touchUi=${touchUi} />
      <${ResourceCacheSetting} open=${open} />
      <p class="set-hint">${touchUi ? t('触屏操作：点击单位选中（撤退 / 出售）· 长按单位或卡牌查看详情 · 拖动部署后滑动选择朝向') : t('右键查看详情')}</p>
    </div>
  <//>`;
}
