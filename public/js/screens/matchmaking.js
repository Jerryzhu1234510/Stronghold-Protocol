// Client components: title entry and the waiting room for four-human quick matching.
// The server owns membership and starting; cancelling never clears a match that already started.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DEFAULT_SEATS, roomCapacity } from '../../../shared/constants.js';
import { html, Button, AvatarFrame, DifficultyTag, PingPill } from '../ui/components.js';
import { toastError } from '../ui/toasts.js';
import { net } from '../net.js';
import { loadPref, savePref, useStore, shallowEqual } from '../store.js';
import { LoadoutButton } from './loadout.js';
import { ReleaseNotesButton } from '../ui/releaseNotes.js';
import { PopulationStrip } from '../ui/population.js';
import { RoomCapacityPicker } from '../ui/roomCapacity.js';
import { flushProfiles } from '../ui/profileEntry.js';
import { MULTIPLAYER_PENDING } from '../../../shared/integrationStage.js';

export function QuickMatchEntry({ beforeMatch, disabled = false }) {
  const conn = useStore((s) => s.connection, shallowEqual);
  const [difficulty, setDifficulty] = useState(() => {
    const value = loadPref('lobby.difficulty', 'FUNNY');
    return DIFFICULTIES.includes(value) ? value : 'FUNNY';
  });
  const [busy, setBusy] = useState(false);
  const [capacity, setCapacity] = useState(DEFAULT_SEATS);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const connected = ['connected', 'handshaking', 'online'].includes(conn.status);
  const match = async () => {
    if (disabled || !connected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (beforeMatch && !beforeMatch()) return;
      await flushProfiles();
      await net.request('room.matchmake', { difficulty, capacity, experimentalAccepted: capacity > DEFAULT_SEATS });
    } catch (error) { toastError(error); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return html`<div class="quick-match-entry">
    <${RoomCapacityPicker} value=${capacity} onChange=${setCapacity} disabled=${busy} />
    <label class="quick-match-entry__difficulty">匹配难度
      <select value=${difficulty} disabled=${busy} onChange=${(event) => {
        setDifficulty(event.target.value); savePref('lobby.difficulty', event.target.value);
      }}>
        ${DIFFICULTIES.map((d) => html`<option key=${d} value=${d}>${DIFFICULTY_NAMES[d]}</option>`)}
      </select>
    </label>
    <${Button} variant="primary" size="xl" block=${true} icon="users" loading=${busy}
      disabled=${disabled || !connected} onClick=${match}>快速匹配<//>
    ${capacity > 4 ? html`<p class="stage-warning">${MULTIPLAYER_PENDING}</p>` : null}
    <p class="quick-match-entry__hint">同难度、同人数组队 · ${capacity > 4 ? `满${capacity}人完成分组 · 战斗下一阶段开放` : `满${capacity}人开局`}</p>
  </div>`;
}

export function MatchmakingScreen({ room, online }) {
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); return () => { alive.current = false; }; }, []);
  const capacity = roomCapacity(room.mode, room.capacity);
  const seats = Array.from({ length: capacity }, (_, index) => room.seats?.[index] || null);
  const count = seats.filter((seat) => seat && !seat.isBot && seat.connected).length;
  const party = !!room.matchmakingParty;
  const cancel = async () => {
    if (!online || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await net.request('room.cancelMatchmaking'); }
    catch (error) { toastError(error); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return html`<div class="screen matchmaking-screen">
    <main class="matchmaking-screen__body">
      <div class="matchmaking-screen__heading">
        <p class="matchmaking-screen__eyebrow">ALLIANCE // ${party ? 'PARTY MATCH' : 'QUICK MATCH'}</p>
        <h1 ref=${heading} tabIndex=${-1}>${party ? '好友整队匹配中' : '正在匹配队友'}</h1>
        <${DifficultyTag} difficulty=${room.difficulty} size="lg" />
      </div>
      <p class="matchmaking-screen__status" role="status">${online
        ? capacity > 4 ? `已找到 ${count} / ${capacity} 名博士，满员后进入验收等待室` : party ? `${count} 人好友队 · 正在寻找 ${capacity - count} 位队友，满${capacity}人自动开始` : `已找到 ${count} / ${capacity} 名博士，满员自动开始`
        : party ? '连接中断，全队匹配已暂停，重连后回到同盟' : '连接中断，重连后可重新匹配'}</p>
      <ol class="matchmaking-seats" aria-label="匹配队伍">
        ${seats.map((seat, index) => html`<li key=${index} class=${`matchmaking-seat${seat ? ' is-filled' : ''}`}>
          <${AvatarFrame} name=${seat?.name || ''} seat=${index} self=${seat?.playerId === me.playerId} size="lg" />
          <strong>${seat ? seat.name : '等待博士加入'}</strong>
          <span>${seat ? (seat.playerId === me.playerId ? '你 · 已加入' : '队友 · 已加入') : '空缺席位'}</span>
        </li>`)}
      </ol>
      ${capacity > 4 ? html`<p class="stage-warning">${MULTIPLAYER_PENDING}</p>` : null}
      <p class="matchmaking-screen__hint">${party
        ? `只匹配同难度的${capacity}人房间，好友不会拆队。等待和开局后均可聊天；取消匹配回到原同盟。`
        : `同一难度的${capacity}名博士组成同盟。人数已锁定，需要调整请先取消匹配。`}</p>
      <div class="matchmaking-screen__actions">
        <${ReleaseNotesButton} size="lg" />
        <${LoadoutButton} from="room" size="lg" />
        <${Button} variant="secondary" size="lg" disabled=${!online} loading=${busy} onClick=${cancel}>${party ? '取消全队匹配' : '取消匹配'}<//>
      </div>
      <${PingPill} ms=${conn.ping} online=${online} />
      <${PopulationStrip} />
    </main>
  </div>`;
}
