import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Modal } from './components.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { mapName, RECRUIT_MAX_LEN, validRecruitment } from '../../../shared/roomDirectory.js';
import { net } from '../net.js';
import { gameModeName } from '../../../shared/cloneMode.js';

// One request every five seconds while the lobby is visible; no discovery traffic during a game.
export function useRoomDirectory(online) {
  const [directory, setDirectory] = useState({ rooms: [], loaded: false, error: false });
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!online) { setDirectory({ rooms: [], loaded: false, error: false }); return; }
    let active = true, pending = false;
    const off = net.on('room.directory', (frame) => {
      if (active) setDirectory({ rooms: Array.isArray(frame.rooms) ? frame.rooms : [], loaded: true, error: false });
    });
    const refresh = async () => {
      if (!active || pending || document.hidden) return;
      pending = true; setLoading(true);
      try { await net.request('room.list', {}); }
      catch { if (active) setDirectory((d) => ({ ...d, error: true })); }
      finally { pending = false; if (active) setLoading(false); }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; clearInterval(timer); off(); document.removeEventListener('visibilitychange', refresh); };
  }, [online, revision]);
  return { ...directory, loading, refresh: () => setRevision((n) => n + 1) };
}

export function RoomDirectoryList({ directory, recruitment = false, online, busy, onJoin, onSpectate }) {
  const [limit, setLimit] = useState(30);
  const rows = recruitment ? directory.rooms.filter((r) => r.recruitment)
    .sort((a, b) => b.recruitment.at - a.recruitment.at) : directory.rooms;
  const empty = !online ? '连接服务器后查看房间'
    : directory.error ? '列表更新失败，点击刷新重试'
    : !directory.loaded ? '正在获取房间…'
    : recruitment ? '暂无招募 · 房主可在公开房间中发布招募' : '暂无公开房间 · 创建同盟邀请博士加入';
  return html`<section class=${`room-directory${recruitment ? ' room-directory--recruit' : ''}`} aria-label=${recruitment ? '同盟招募' : '公开房间'}>
    <header class="room-directory__head"><div><${Icon} name=${recruitment ? 'users' : 'rook'} />
      <h2>${recruitment ? '同盟招募' : '公开房间'}</h2><span class="room-directory__count num">${rows.length}</span>
      <${MicroLabel}>${recruitment ? 'RECRUITMENT' : 'PUBLIC ROOMS'}<//></div>
      <button type="button" class="room-directory__refresh" disabled=${!online || directory.loading}
        onClick=${directory.refresh} aria-label=${recruitment ? '刷新招募' : '刷新公开房间'} title="每5秒自动更新">${directory.loading ? '更新中' : '刷新'} ↻</button>
    </header>
    <div class="room-directory__list" tabIndex="0" aria-label=${recruitment ? '招募列表' : '公开房间列表'}>
      ${rows.length ? rows.slice(0, limit).map((r) => {
        const canJoin = !r.inMatch && r.occupied < r.capacity;
        return html`<article key=${r.code} class="room-directory__row">
          <div class="room-directory__info"><div class="room-directory__title"><strong>${r.name || '博士'}的同盟</strong>
            <span class=${`room-directory__status${r.inMatch ? ' is-playing' : canJoin ? '' : ' is-full'}`}>${r.inMatch ? '模拟中' : canJoin ? '等待加入' : '已满员'}</span></div>
            <p class="room-directory__message">${recruitment ? r.recruitment.text : r.description || '欢迎博士加入'}</p>
            <div class="room-directory__meta"><b class="num">${r.code}</b><span>${DIFFICULTY_NAMES[r.difficulty] || r.difficulty}</span>
              <span>${mapName(r.mapVersion)}</span><span class="num">${r.occupied}/${r.capacity}人</span><span class=${r.gameMode === 'clone' ? 't-mint' : ''}>${gameModeName(r.gameMode)}</span></div>
          </div>
          <${Button} size="sm" variant=${canJoin ? recruitment ? 'amber' : 'secondary' : 'ghost'}
            disabled=${!online || !!busy || (!canJoin && r.spectatorCount >= 2)}
            onClick=${() => canJoin ? onJoin(r.code) : onSpectate(r.code)}>${canJoin ? '加入' : '观战'}<//>
        </article>`;
      }) : html`<p class="room-directory__empty">${empty}</p>`}
      ${rows.length > limit ? html`<button type="button" class="room-directory__more" onClick=${() => setLimit((n) => n + 30)}>查看更多（${rows.length - limit}）</button>` : null}
    </div>
    ${directory.error && rows.length ? html`<p class="room-directory__stale" role="status">暂时无法更新，当前显示上次的房间信息</p>` : null}
  </section>`;
}

export function RoomVisibilityModal({ open, selected, onSelect, onConfirm, onClose, busy, description, onDescription }) {
  return html`<${Modal} open=${open} title="选择同盟公开方式" micro="ALLIANCE ACCESS" class="room-access-modal"
    trapFocus=${true} width="min(620px, 94vw)" onClose=${busy ? null : onClose}
    actions=${html`<${Button} disabled=${busy} onClick=${onClose}>取消<//><${Button} variant="primary" disabled=${!selected || !validRecruitment(description) || busy} loading=${busy}
      onClick=${onConfirm}>确认创建<//>`}>
    <p class="room-access-modal__intro">公开、私有房间都可以聊天、复制密钥和邀请链接。</p>
    <div class="room-access-options" role="radiogroup" aria-label="房间公开方式">
      ${[['public', '公开同盟', '自动出现在公开房间列表；发布招募后，才出现在招募列表。', 'users'],
        ['private', '私有同盟', '不显示在房间与招募列表，只能凭密钥或邀请链接加入。', 'key']].map(([value, title, desc, icon]) => html`
        <button type="button" key=${value} class=${`room-access-option${selected === value ? ' is-selected' : ''}`} role="radio"
          aria-checked=${selected === value} disabled=${busy} onClick=${() => onSelect(value)}>
          <${Icon} name=${icon} /><strong>${title}</strong><p>${desc}</p><span class="room-access-option__check">${selected === value ? '✓ 已选择' : '选择'}</span>
        </button>`)}
    </div>
    <label class="room-description-field">房间简介 <span>必填 · 最多${RECRUIT_MAX_LEN}字</span>
      <textarea value=${description} onInput=${(e) => onDescription(e.currentTarget.value)} maxLength=${RECRUIT_MAX_LEN}
        placeholder="例如：终极挑战，欢迎熟悉联防的博士；或休闲娱乐，新手一起练阵容。" disabled=${busy} rows="2" required></textarea>
    </label><p class="room-access-modal__intro">发布招募时直接使用这段简介，让玩法相近的博士找到你。</p>
  <//>`;
}
