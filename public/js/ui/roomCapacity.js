import { useRef, useState } from '../../vendor/hooks.module.js';
import { DEFAULT_SEATS, ROOM_CAPACITIES } from '../../../shared/constants.js';
import { html, confirmDialog } from './components.js';
import { MULTIPLAYER_PENDING } from '../../../shared/integrationStage.js';

export async function confirmExperimentalRoom(capacity, gameMode = 'normal') {
  if (capacity <= DEFAULT_SEATS) return true;
  if (gameMode === 'versus') return confirmDialog({ title: '对抗模式（测试）', text: '对抗测试仅支持4人满员开局，两两攻守，每段8分钟，失守提前交换，双方轮流防守后4进2进1。是否继续？', okText: '了解并选择', cancelText: '取消' });
  const uniteHint = capacity >= 7 ? '采用三人联防及更长倒计时' : '采用双人联防';
  return confirmDialog({ title: '5–8人房间 · 测试内容',
    text: `${capacity}人房间属于测试内容：卡池、玩家生命、干员属性与敌方难度将按人数调整，${uniteHint}。${MULTIPLAYER_PENDING} 是否继续？`,
    okText: '了解并选择', cancelText: '取消' });
}

export function RoomCapacityPicker({ value = DEFAULT_SEATS, onChange, disabled = false, locked = false, confirmOnChange = true, gameMode = 'normal' }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const change = async (event) => {
    const next = Number(event.target.value);
    event.target.value = String(value);
    if (disabled || locked || inFlight.current || next === value) return;
    inFlight.current = true; setBusy(true);
    try { if (!confirmOnChange || await confirmExperimentalRoom(next, gameMode)) await onChange(next); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return html`<label class="room-capacity-picker">房间人数
    <select value=${value} onChange=${change} disabled=${disabled || locked || busy} aria-label="房间人数">
      ${(gameMode === 'versus' ? [4] : ROOM_CAPACITIES).map((size) => html`<option key=${size} value=${size}>${size}人${size > DEFAULT_SEATS ? ' · 测试' : ''}</option>`)}
    </select>
    ${locked ? html`<small>匹配人数已锁定</small>` : null}
  </label>`;
}
