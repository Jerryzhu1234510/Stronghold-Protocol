import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, confirmDialog } from '../ui/components.js';
import { matchHistory } from '../ui/matchHistory.js';
import { ResultScreen } from './result.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { gameModeName } from '../../../shared/cloneMode.js';
import { t } from '../../../shared/i18n.js';

export function MatchHistoryPanel() {
  const [entries, setEntries] = useState(matchHistory.list());
  const [selected, setSelected] = useState(null);
  useEffect(() => matchHistory.subscribe(setEntries), []);
  if (selected) return html`<div class="history-detail"><${ResultScreen} archive=${selected} onBack=${() => setSelected(null)} /><//>`;
  const clear = async () => {
    if (await confirmDialog({ title: t('清空对局记录'), text: t('清空本机保存的对局记录？此操作无法撤销。'), okText: t('清空') })) matchHistory.clear();
  };
  return html`<main class="match-history" aria-label=${t('对局记录')}>
    <header class="match-history__head"><h2>${t('对局记录')} <small>${t('本机 · 最近20局')}</small></h2>
      <${Button} variant="ghost" size="sm" icon="close" disabled=${!entries.length} onClick=${clear}>${t('清空记录')}<//></header>
    <div class="match-history__list">
      ${entries.length ? entries.map(entry => {
        const result = entry.result, pub = entry.public || {};
        const own = result.players.find(player => player.playerId === entry.myId);
        return html`<button type="button" class="history-row" key=${entry.id} onClick=${() => setSelected(entry)} data-history-id=${entry.id}>
          <span class=${result.victory ? 'history-row__outcome is-win' : 'history-row__outcome'}><${Icon} name=${result.victory ? 'check' : 'close'} />${result.victory ? t('模拟完成') : t('模拟失败')}</span>
          <span class="history-row__meta"><b>${DIFFICULTY_NAMES[result.difficulty || pub.difficulty] || t('模拟')} · ${gameModeName(result.gameMode || pub.gameMode)}</b>
            <small>${new Date(entry.savedAt).toLocaleString('zh-CN', { hour12: false })} ${t('· {n}人 · 通过', { n: result.players.length })}${result.roundsPassed || 0}${t('回合')}</small></span>
          <span class="history-row__player">${own?.name || result.players.map(player => player.name).slice(0, 2).join('、')}</span>
          <${Icon} name="chevronRight" />
        </button>`;
      }) : html`<p class="match-history__empty">${t('暂无对局记录')}</p>`}
    </div>
  </main>`;
}
