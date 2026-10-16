import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, Panel } from './components.js';
import { net } from '../net.js';
import { toastError } from './toasts.js';
import { t } from '../../../shared/i18n.js';

export function RoomExtensionsPanel({ room, editable }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(room.extensions || {});
  const saved = JSON.stringify(room.extensions || {});
  useEffect(() => { setDraft(room.extensions || {}); }, [saved]);
  if (!room.extensionCatalog?.length) return null;
  const active = room.extensionCatalog.filter(d => room.extensions?.[d.id] !== d.default).length;
  const disabled = !editable || busy || room.gameMode === 'versus';
  const save = async () => {
    if (disabled) return;
    setBusy(true);
    try { await net.request('room.setExtensions', { extensions: draft }); setOpen(false); }
    catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  return html`<div class="room-extensions-entry">
    <${Button} size="sm" onClick=${() => setOpen(true)}>${t('房间扩展设置')}${active ? t(' · {active}项已开启', { active }) : t(' · 原版规则')}<//>
    ${open ? html`<${Modal} open=${true} onClose=${() => !busy && setOpen(false)} width="min(860px,94vw)">
      <${Panel} class="room-extensions" tone="mint">
        <header><h3>${t('房间扩展设置')}</h3><${Button} size="sm" onClick=${() => setOpen(false)}>${t('关闭')}<//></header>
        <p>${t('房主开局前统一配置；修改后全员重新准备。本场开局后锁定，默认使用原版规则。')}</p>
        ${room.gameMode === 'versus' ? html`<p role="status">${t('对抗测试暂不支持扩展设置，切回正常或克隆模式后可用。')}</p>` : null}
        <div class="room-extensions__list">${room.extensionCatalog.map(d => html`<label key=${d.id} class=${`room-extension${d.options ? ' room-extension--select' : ''}`}>
          <span><b>${d.label}</b><small>${d.description}</small></span>
          ${d.type === 'boolean' ? html`<input type="checkbox" aria-label=${d.label} checked=${!!draft[d.id]} disabled=${disabled}
            onChange=${e => { const checked = e.currentTarget.checked; setDraft(v => ({ ...v, [d.id]: checked })); }} />`
            : d.options ? html`<select aria-label=${d.label} value=${draft[d.id] ?? d.default} disabled=${disabled}
              onChange=${e => { const value = Number(e.currentTarget.value); setDraft(v => ({ ...v, [d.id]: value })); }}>
              ${d.options.map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
            </select>` : html`<span class="room-extension__number">× <input type="number" aria-label=${d.label} min=${d.min} max=${d.max} step="1"
              value=${draft[d.id] ?? d.default} disabled=${disabled}
              onInput=${e => { const value = Number(e.currentTarget.value); setDraft(v => ({ ...v, [d.id]: value })); }} /></span>`}
        </label>`)}</div>
        <footer><span>${editable ? t('其他玩家可以查看全部设置。') : t('由房主修改，所有玩家同步查看。')}</span>
          <${Button} disabled=${disabled} onClick=${() => setDraft(Object.fromEntries(room.extensionCatalog.map(d => [d.id, d.default])))}>${t('恢复默认')}<//>
          <${Button} variant="primary" loading=${busy} disabled=${disabled || !room.extensionCatalog.every(d => d.type === 'boolean' || Number.isInteger(draft[d.id]) && draft[d.id] >= d.min && draft[d.id] <= d.max)} onClick=${save}>${t('保存并重新准备')}<//>
        </footer>
      <//>
    <//>` : null}
  </div>`;
}
