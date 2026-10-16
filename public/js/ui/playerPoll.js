import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, Tooltip } from './components.js';
import { Img } from './gameComponents.js';
import { chessAvatarUrl } from './assetUrls.js';
import { data, getChess, useData } from '../data.js';
import { loadPref, savePref, useStore } from '../store.js';
import { releaseNotesStore } from './releaseNotes.js';
import { CLEMENTIA_POLL, validPollChoice, previewPollResults } from '../../../shared/playerPoll.js';
import { isLivePoll, requestPlayerPoll } from './playerPollClient.js';
import { t } from '../../../shared/i18n.js';

const storageKey = `pollPreview.${CLEMENTIA_POLL.id}`;
export function readPreviewPollChoice() {
  const choice = loadPref(storageKey, null);
  return validPollChoice(choice) ? choice : null;
}

export function PlayerPollModal({ open, onClose }) {
  useData('chess', 'assets');
  const live = isLivePoll();
  const initialChoice = () => live ? null : readPreviewPollChoice();
  const [committed, setCommitted] = useState(initialChoice);
  const [selected, setSelected] = useState(initialChoice);
  const [results, setResults] = useState(() => !!initialChoice());
  const [serverState, setServerState] = useState(null);
  const [busy, setBusy] = useState(live);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const requestSequence = useRef(0);
  const submitting = useRef(false);
  const tally = live ? serverState || previewPollResults(null) : previewPollResults(committed);
  useEffect(() => {
    if (!open || !live) return;
    const controller = new AbortController();
    let first = true;
    setBusy(true);
    const refresh = async () => {
      if (submitting.current) return;
      const sequence = ++requestSequence.current;
      try {
        const state = await requestPlayerPoll('read', null, { signal: controller.signal });
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setServerState(state); setCommitted(state.choice); setError(null);
        if (first) { setSelected(state.choice); setResults(!!state.choice); }
        first = false;
      } catch (err) { if (!controller.signal.aborted && sequence === requestSequence.current) setError(err.message); }
      finally { if (!controller.signal.aborted && sequence === requestSequence.current) setBusy(false); }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [open, live, retry]);
  const portrait = chessAvatarUrl(data.get('assets'), getChess('chess_char_4_27_a'));
  const submit = async () => {
    if (busy || !validPollChoice(selected)) return;
    submitting.current = true; requestSequence.current++;
    setBusy(true); setError(null);
    try {
      if (live) {
        const state = await requestPlayerPoll('vote', selected);
        setServerState(state); setCommitted(state.choice);
      } else { savePref(storageKey, selected); setCommitted(selected); }
      setResults(true);
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; setBusy(false); }
  };
  return html`<${Modal} open=${open} title=${CLEMENTIA_POLL.title} micro=${t('玩家投票 · 单选')}
    class="player-poll" width="min(760px, calc(100vw - 24px))" onClose=${onClose} trapFocus=${true}
    actions=${html`<span class=${`player-poll__status${error ? ' is-error' : ''}`} role="status" aria-live="polite">${error || (busy ? t('正在连接…') : live ? (committed ? t('已提交') : t('尚未投票')) : results && committed ? t('已提交 · 本地预览') : t('本地预览'))}</span>
      <${Button} variant="ghost" size="sm" onClick=${onClose}>${t('暂不参与')}<//>
      ${error && live ? html`<${Button} variant="secondary" size="sm" icon="refresh" onClick=${() => setRetry(value => value + 1)}>${t('重试')}<//>` : !results ? html`<${Button} variant="secondary" size="sm" icon="eye" disabled=${busy || (live && !serverState)} onClick=${() => setResults(true)}>${t('查看结果')}<//>` : null}
      <${Button} variant="primary" size="sm" icon=${results ? 'edit' : 'check'} loading=${busy} disabled=${(live && !serverState) || (!results && !validPollChoice(selected))}
        class="player-poll__submit" onClick=${results ? () => setResults(false) : submit}>${results ? t('修改投票') : t('提交投票')}<//>`}>
    <${Tooltip} text=${t('关闭投票')} class="player-poll__close-anchor"><${Button} variant="ghost" size="sm" square=${true} icon="close"
      class="player-poll__close" onClick=${onClose} aria-label=${t('关闭投票')} /><//>
    <div class="player-poll__intro">
      <${Img} src=${portrait} alt=${t('克莱门莎')} class="player-poll__portrait" />
      <div><p class="player-poll__question">${t('你希望采用哪种调整方案？')}</p>
        <p class="player-poll__meta">${results ? `${live ? t('累计票数') : t('预览票数')} ${tally.total}` : t('克莱门莎 · 特质与所属盟约调整')}</p></div>
    </div>
    <fieldset class="player-poll__options" disabled=${results || busy}>
      <legend class="player-poll__legend">${t('调整方案（单选）')}</legend>
      ${CLEMENTIA_POLL.options.map((option, index) => {
        const count = tally.options[index];
        const chosen = (results ? committed : selected) === option.id;
        return html`<label key=${option.id} class=${`player-poll__option${chosen ? ' is-selected' : ''}${results ? ' is-result' : ''}`} data-poll-option=${option.id}>
          <input type="radio" name="clementia-adjustment" value=${option.id} checked=${chosen}
            aria-label=${option.title} onChange=${() => setSelected(option.id)} />
          <span class="player-poll__copy">
            <span class="player-poll__option-head"><strong>${option.title}</strong>
              <span class="player-poll__bonds">${option.bonds.join(' / ')}</span>
              ${results ? html`<span class="player-poll__count num">${t('{votes}票 · {percent}%', { votes: count.votes, percent: count.percent })}</span>` : null}</span>
            <span class="player-poll__description">${option.description}</span>
            ${results ? html`<span class="player-poll__bar" aria-hidden="true"><i style=${`width:${count.percent}%`}></i></span>` : null}
          </span>
        </label>`;
      })}
    </fieldset>
  <//>`;
}

export function PlayerPollEntry({ onClick }) {
  return html`<${Button} variant="danger" size="sm" icon="check" class="lobby-poll-entry"
    data-testid="player-poll-open" onClick=${onClick}>${t('投票')}<//>`;
}

export function PlayerPollHost({ open, onOpen, onClose }) {
  const autoShown = useRef(false);
  const notesOpen = useStore(s => s.open, Object.is, releaseNotesStore);
  useEffect(() => {
    if (notesOpen || autoShown.current) return;
    autoShown.current = true;
    onOpen();
  }, [notesOpen]);
  return html`<${PlayerPollModal} open=${open} onClose=${onClose} />`;
}
