import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, confirmDialog } from '../ui/components.js';
import { matchHistory } from '../ui/matchHistory.js';
import { ResultScreen } from './result.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { gameModeName } from '../../../shared/cloneMode.js';

export function MatchHistoryPanel() {
  const [entries, setEntries] = useState(matchHistory.list());
  const [selected, setSelected] = useState(null);
  useEffect(() => matchHistory.subscribe(setEntries), []);
  if (selected) return html`<div class="history-detail"><${ResultScreen} archive=${selected} onBack=${() => setSelected(null)} /><//>`;
  const clear = async () => {
    if (await confirmDialog({ title: '清空对局记录', text: '清空本机保存的对局记录？此操作无法撤销。', okText: '清空' })) matchHistory.clear();
  };
  return html`<main class="match-history" aria-label="对局记录">
    <header class="match-history__head"><h2>对局记录 <small>本机 · 最近20局</small></h2>
      <${Button} variant="ghost" size="sm" icon="close" disabled=${!entries.length} onClick=${clear}>清空记录<//></header>
    <div class="match-history__list">
      ${entries.length ? entries.map(entry => {
        const result = entry.result, pub = entry.public || {};
        const own = result.players.find(player => player.playerId === entry.myId);
        return html`<button type="button" class="history-row" key=${entry.id} onClick=${() => setSelected(entry)} data-history-id=${entry.id}>
          <span class=${result.victory ? 'history-row__outcome is-win' : 'history-row__outcome'}><${Icon} name=${result.victory ? 'check' : 'close'} />${result.victory ? '模拟完成' : '模拟失败'}</span>
          <span class="history-row__meta"><b>${DIFFICULTY_NAMES[result.difficulty || pub.difficulty] || '模拟'} · ${gameModeName(result.gameMode || pub.gameMode)}</b>
            <small>${new Date(entry.savedAt).toLocaleString('zh-CN', { hour12: false })} · ${result.players.length}人 · 通过${result.roundsPassed || 0}回合</small></span>
          <span class="history-row__player">${own?.name || result.players.map(player => player.name).slice(0, 2).join('、')}</span>
          <${Icon} name="chevronRight" />
        </button>`;
      }) : html`<p class="match-history__empty">暂无对局记录</p>`}
    </div>
  </main>`;
}
