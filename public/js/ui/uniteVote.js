import { useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { html, useTicker } from './components.js';
import { serverNow } from '../store.js';
import { actions } from './gameActions.js';

export function UniteVoteControls({ pub, myId }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const ext = pub?.phase === PHASE.UNITE ? pub.uniteSkip : null;
  const vote = ext?.vote;
  useTicker(vote?.status === 'pending' ? 250 : 0);
  const me = pub?.players?.find(p => p.playerId === myId);
  if (!ext || !me || me.isBot || me.alive === false || me.connected === false) return null;
  const pending = ext.enabled && vote?.status === 'pending' && serverNow() < vote.deadline;
  const canVote = pending && vote.eligible.includes(myId) && !Object.hasOwn(vote.votes, myId);
  const send = async fn => { if (busy) return; setBusy(true); try { if (await fn()) setConfirm(false); } finally { setBusy(false); } };
  return html`<section class="unite-vote" aria-label=${t('联防跳过投票')} onKeyDown=${e => e.stopPropagation()}>
    ${!ext.used && ext.enabled ? html`<button type="button" disabled=${busy} aria-expanded=${confirm} onClick=${() => setConfirm(!confirm)}>${t('投票跳过联防')}</button>` : null}
    ${confirm && !ext.used && ext.enabled ? html`<div class="unite-vote__panel">
      <p>${t('通过后立即结束联防，剩余敌人按所属玩家结算扣血。')}</p>
      <small>${t('每次联防可发起一次；10 秒内超过半数在线真人赞成。')}</small>
      <button type="button" disabled=${busy} onClick=${() => send(() => actions.uniteSkip())}>${t('发起投票')}</button>
      <button type="button" onClick=${() => setConfirm(false)}>${t('取消')}</button>
    </div>` : null}
    ${pending ? html`<div class="unite-vote__panel" role="group" aria-label=${t('联防跳过投票')}>
      <b>${t('投票跳过联防')}</b><span> ${Object.values(vote.votes).filter(Boolean).length}/${vote.required} · ${Math.max(0, Math.ceil((vote.deadline - serverNow()) / 1000))}s</span>
      <p>${t('剩余敌人按所属玩家结算扣血')}</p>
      ${canVote ? html`<button type="button" disabled=${busy} onClick=${() => send(() => actions.uniteVote(vote.id, true))}>${t('赞成')}</button>
        <button type="button" disabled=${busy} onClick=${() => send(() => actions.uniteVote(vote.id, false))}>${t('反对')}</button>` : html`<small>${t('已投票，等待结果')}</small>`}
    </div>` : vote ? html`<span role="status">${vote.status === 'passed' ? t('跳过已通过，正在结算') : vote.status === 'pending' ? t('投票结束，等待服务器确认') : t('跳过未通过，继续联防')}</span>` : null}
  </section>`;
}
