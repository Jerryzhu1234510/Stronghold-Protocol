import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Button } from '../ui/components.js';
import { useGameData } from '../ui/gameComponents.js';
import { MatchInfo, matchInfoModel } from '../ui/matchInfo.js';
import { StepHeader } from '../ui/matchChrome.js';
import { actions, act } from '../ui/gameActions.js';
import { net } from '../net.js';
import { store, useStore, emptyMatch } from '../store.js';
import { emptyChat } from '../ui/chatState.js';
import { PHASE } from '../../../shared/constants.js';
import { audio } from '../audio.js';
import { createVersusAudioSync, playVersusCommandSound } from '../versus/audio.js';

const versusFrameUrl = new URL('../../versus.html?embedded=1', import.meta.url).href;

export function VersusScreen() {
  const pub = useStore(s => s.match.public), packet = useStore(s => s.match.versus);
  const myId = useStore(s => s.me.playerId), frame = useRef(null), ready = useRef(false);
  const gd = useGameData();
  const audioSync = useRef(null);
  if (!audioSync.current) audioSync.current = createVersusAudioSync(audio);
  useEffect(() => { if (packet) audioSync.current(packet); }, [packet]);
  useEffect(() => {
    const receive = async e => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const post = value => frame.current?.contentWindow.postMessage(value, location.origin);
      if (e.data?.type === 'versus-ready') { ready.current = true; post(store.get().match.versus); return; }
      if (e.data?.type === 'versus-gesture') { audio.unlock(); return; }
      if (e.data?.type !== 'versus-command') return;
      const c = e.data.command;
      if (c?.action === 'return') {
        if (store.get().match.public?.phase === PHASE.RESULT) store.set({ match: emptyMatch() });
        return;
      }
      if (c?.action === 'leave') {
        if (await act('g.leave')) store.set({ room: null, chat: emptyChat(), match: emptyMatch(), ticker: [], emotes: [] });
        return;
      }
      try {
        await net.request(c.action === 'watch' ? 'g.watch' : 'g.versus', c.action === 'watch'
          ? { fieldId: c.id, ...(c.playerId ? { playerId: c.playerId } : {}) } : { command: c });
        post({ type: 'ack', action: c.action });
        playVersusCommandSound(audio, c.action);
      } catch (err) { post({ type: 'error', message: err.detail || err.message || '操作失败' }); }
    };
    addEventListener('message', receive);
    return () => { removeEventListener('message', receive); ready.current = false; };
  }, []);
  useEffect(() => { if (ready.current && packet) frame.current?.contentWindow.postMessage(packet, location.origin); }, [packet]);
  if (!pub) return null;
  if (pub.phase !== PHASE.INFO_CHECK) return html`<iframe ref=${frame} src=${versusFrameUrl} title="对抗模式（测试）" allow="fullscreen" style="position:absolute;inset:0;width:100%;height:100%;border:0" />`;
  const me = pub.players.find(p => p.playerId === myId);
  const model = matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess });
  return html`<div class="screen brief">
    <${StepHeader} step=${1} of=${1} title="对抗模式（测试） · 确认本局信息" micro="VERSUS // INFO CHECK" pub=${pub} total=${25} onExit=${() => act('g.leave')} />
    <main class="brief__main">
      <section class="brief__left">
        <div class="brief-stage"><span class="brief-stage__k">战场</span><span class="brief-stage__name">${gd.stage(pub.stageId)?.name || pub.stageId}</span></div>
        <h3 class="brief-h">4 人攻守淘汰赛（测试）</h3>
        ${pub.players.map(p => html`<div class="brief-stage"><b>${Array.from(p.name)[0]}</b><span>${p.name}</span><span>${p.ready ? '已就绪' : '确认中'}</span></div>`)}
      </section>
      <section class="brief__right"><${MatchInfo} model=${model} /></section>
    </main>
    <footer class="brief__foot"><div class="brief-ready">已就绪 ${pub.players.filter(p => p.ready).length}/${pub.players.length}</div>
      <${Button} variant="primary" size="xl" icon="check" disabled=${!me || me.ready} onClick=${actions.infoReady}>${me?.ready ? '已就绪' : '准备就绪'}</${Button}>
    </footer>
  </div>`;
}
