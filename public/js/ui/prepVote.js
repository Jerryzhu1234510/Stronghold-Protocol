import { useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, useTicker } from './components.js';
import { serverNow } from '../store.js';
import { actions } from './gameActions.js';
import { t } from '../../../shared/i18n.js';

export function prepVoteView(pub, myId, priv, now) {
  const ext = pub?.phase === PHASE.PREP ? pub.prepExtension : null;
  const me = pub?.players?.find(p => p.playerId === myId);
  const allowed = !!me && !me.isBot && me.alive !== false && me.connected !== false && priv?.alive !== false;
  const vote = ext?.vote;
  const pending = vote?.status === 'pending' && vote.deadline > now;
  return { ext, me, vote, pending,
    canStart: !!ext?.enabled && allowed && !ext.used && !priv?.ready && pub.deadline > now,
    canVote: allowed && pending && vote.eligible.includes(myId) && !Object.hasOwn(vote.votes, myId),
    yes: vote ? Object.values(vote.votes).filter(Boolean).length : 0,
    remaining: pending ? Math.max(0, Math.ceil((vote.deadline - now) / 1000)) : 0,
    reminder: ext?.reminder?.until > now ? ext.reminder : null,
    allowed };
}

export function prepVoteBadge(pub, playerId) {
  const vote = pub?.phase === PHASE.PREP ? pub.prepExtension?.vote : null;
  if (!vote?.eligible.includes(playerId)) return null;
  const value = vote.votes[playerId];
  const initiator = vote.initiatorId === playerId;
  return { text: initiator ? t('发起 ✓') : value === true ? t('赞成') : value === false ? t('反对') : vote.status === 'pending' ? t('待投票') : t('未投票'),
    tone: value === true ? 'yes' : value === false ? 'no' : 'waiting' };
}

// Small inline controls; the tier chooser only opens on demand, the ballot never blocks the board.
export function PrepVoteControls({ pub, priv, myId }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ticking = pub?.prepExtension?.vote?.status === 'pending' || !!pub?.prepExtension?.reminder;
  useTicker(ticking ? 250 : 0);
  const view = prepVoteView(pub, myId, priv, serverNow());
  if (!view.ext || !view.allowed) return null;
  const { ext, vote, canStart, canVote, pending, reminder } = view;
  const send = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { if (await fn()) setOpen(false); } finally { setBusy(false); }
  };
  const name = pub.players.find(p => p.playerId === vote?.initiatorId)?.name || t('队友');
  const reminderName = pub.players.find(p => p.playerId === reminder?.playerId)?.name || t('队友');
  return html`<section class="prep-vote" aria-label=${t('休整加时')} onKeyDown=${e => { if (e.key === ' ') e.stopPropagation(); }}>
    <div class="prep-vote__tools">
      ${ext.enabled && !ext.used ? html`<button type="button" disabled=${busy || !canStart} aria-expanded=${open && canStart}
        title=${priv?.ready ? t('请先取消准备，再发起加时') : t('每回合一次，超过半数在线真人赞成可加时')}
        onClick=${() => setOpen(!open)}>${t('申请加时')}</button>` : null}
      <button type="button" disabled=${busy || !!reminder} onClick=${() => send(() => actions.readyReminder())}>${t('提醒准备')}</button>
    </div>
    ${open && canStart ? html`<div class="prep-vote__panel">
      <span>${t('本回合申请加时')}</span>
      <div class="prep-vote__choices">
        ${[30, 60].map(seconds => html`<button type="button" disabled=${busy} onClick=${() => send(() => actions.prepExtend(seconds))}>${t('+{seconds} 秒', { seconds })}</button>`)}
      </div>
    </div>` : null}
    ${pending ? html`<div class="prep-vote__panel prep-vote__ballot" role="group" aria-label=${t('{name}申请加时{seconds}秒', { name, seconds: vote.seconds })} title=${t('{name}申请加时，最多30秒内超过半数赞成才通过；未投票视为拒绝', { name })}>
      <div class="prep-vote__headline"><b class="prep-vote__request" role="status"><span class="prep-vote__name">${name}</span> ${t('+{seconds}秒', { seconds: vote.seconds })}</b><strong class="prep-vote__countdown">${t('{remaining}秒', { remaining: view.remaining })}</strong></div>
      ${canVote ? html`<div class="prep-vote__choices">
        <button type="button" disabled=${busy} onClick=${() => send(() => actions.prepVote(vote.id, true))}>${t('赞成 {yes}/{required}', { yes: view.yes, required: vote.required })}</button>
        <button type="button" disabled=${busy} onClick=${() => send(() => actions.prepVote(vote.id, false))}>${t('反对')}</button>
      </div>` : html`<small>${t('已投票 · 赞成 {yes}/{required}', { yes: view.yes, required: vote.required })}</small>`}
    </div>` : vote ? html`<span class="prep-vote__result" role="status">${vote.status === 'passed' ? t('已加时 {addedSeconds} 秒', { addedSeconds: ext.addedSeconds }) : vote.status === 'pending' ? t('投票结束，等待服务器确认') : t('加时未通过')}</span>` : null}
    ${reminder ? html`<span class="prep-vote__result" role="status">${t('{reminderName}：请准备一下', { reminderName })}</span>` : null}
  </section>`;
}
