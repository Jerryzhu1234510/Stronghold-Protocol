import { useRef } from '../../vendor/hooks.module.js';
import { html, Icon, useTicker } from './components.js';
import { fmtNum } from './gameLogic.js';
import { UnitThumb } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { useOutsideDismiss } from './outsideDismiss.js';

function OpenDamageReport({ runner, ownerId, ownerName, round, onClose }) {
  const panel = useRef(null);
  useOutsideDismiss(panel, onClose, '.gm__damage');
  useTicker(500);
  const report = runner?.damageReport?.(ownerId);
  return html`<section ref=${panel} class="damage-report" role="dialog" aria-label=${t('伤害统计')} onKeyDown=${e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
    <div class="damage-report__head"><div><small>DAMAGE REPORT</small><b>${ownerName || t('伤害统计')}</b></div>
      <span role="status">${report?.done ? t('已结算') : report ? t('进行中') : t('等待战斗')}</span>
      <button type="button" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button></div>
    <div class="damage-report__total"><span>${t('实际伤害')}</span><strong class="num">${fmtNum(report?.total || 0)}</strong>
      <small>${t('第 {round} 回合', { round: report?.round ?? round })} · ${report?.done ? t('保留至下一次开战') : t('每半秒更新')}</small></div>
    <div class="damage-report__rows" tabIndex="0" aria-label=${t('干员伤害排行')}>
      ${report?.rows?.length ? report.rows.map((row, index) => html`<div class="damage-report__row" key=${row.key}>
        <span class="damage-report__rank">${index + 1}</span><${UnitThumb} kind=${row.kind === 'op' ? 'chess' : 'token'} id=${row.defId} size="xs" showTier=${false} />
        <div class="damage-report__unit"><b>${row.name || row.defId}</b><span class="damage-report__bar" aria-hidden="true"><i style=${{ width: `${row.dmg / report.total * 100}%` }}></i></span></div>
        <div class="damage-report__value"><b class="num">${Math.round(row.dmg).toLocaleString()}</b><small>${(row.dmg / report.total * 100).toFixed(1)}%</small></div>
      </div>`) : html`<p class="damage-report__empty">${report ? t('本战场尚未造成伤害') : t('开战后可查看当前玩家的干员伤害')}</p>`}
    </div>
    <details><summary>${t('统计口径')}</summary><p>${t('统计实际扣除敌方生命的伤害；不计过量伤害、治疗和敌方自损。召唤物按类型单独统计。')}</p></details>
  </section>`;
}

export function DamageReport({ open, ...props }) {
  return open ? html`<${OpenDamageReport} ...${props} />` : null;
}
