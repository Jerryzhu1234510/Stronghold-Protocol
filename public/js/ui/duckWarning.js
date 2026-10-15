import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { activeDuckWarnings } from '../../../shared/duckWarnings.js';
import { battleRunner } from '../battle/runner.js';
import { net } from '../net.js';
import { audio } from '../audio.js';

const MARK = Object.freeze({ group: 'duck-reinforcement', color: 0xffa34c, fill: 0.3, line: 2 });

export function DuckWarning({ field, view, round }) {
  const [clock, setClock] = useState({ field, time: field?.warningTime ?? 0 });
  const [folded, setFolded] = useState('');
  const heard = useRef(new Set());
  useEffect(() => {
    setClock({ field, time: field?.warningTime ?? 0 });
    const onSnap = snap => {
      if (snap?.fieldId !== field?.fieldId || !Number.isFinite(snap.gt)) return;
      const time = Math.floor(snap.gt * 4) / 4;
      setClock(old => old.field === field && old.time === time ? old : { field, time });
    };
    const off = [net.on('b.snap', onSnap), battleRunner?.on('snap', onSnap)];
    return () => off.forEach(fn => fn?.());
  }, [field]);
  const now = clock.field === field ? clock.time : field?.warningTime ?? 0;
  const active = activeDuckWarnings(field?.reinforcements, now);
  const key = active.map(g => g.id).join('|');
  useEffect(() => {
    if (!active.length) return;
    let sound = false;
    for (const g of active) {
      const cue = `${round}:${field?.fieldId}:${g.id}`;
      if (!heard.current.has(cue)) { heard.current.add(cue); sound = true; }
    }
    if (heard.current.size > 128) heard.current = new Set([...heard.current].slice(-64));
    if (sound && !document.hidden) audio.sfx('yourTurn', { volume: 0.55 });
  }, [key, round, field?.fieldId]);
  const tileKey = active.map(g => g.tile?.join(',') || '').join(';');
  useEffect(() => {
    if (!view) return;
    // enterBattle clears all highlight groups. Draw after the parent has entered
    // the new field, even when a reconnect keeps the same entry coordinates.
    const frame = requestAnimationFrame(() => {
      try { view.highlightTiles(active.flatMap(g => g.tile ? [g.tile] : []), MARK); } catch { /* view destroyed */ }
    });
    return () => { cancelAnimationFrame(frame); try { view.highlightTiles([], MARK); } catch { /* optional visual */ } };
  }, [view, field, tileKey]);
  if (!active.length) return null;
  const collapsed = folded === key;
  return html`<aside class=${`duck-warning${collapsed ? ' is-folded' : ''}`} aria-label="鸭爵强敌入场预警">
    <button class="duck-warning__head" type="button" aria-expanded=${!collapsed} onClick=${() => setFolded(collapsed ? '' : key)}>
      <span>⚠ 鸭爵强敌 · ${active[0].arrived ? '已入场' : `${active[0].remaining} 秒后入场`}</span><span>${collapsed ? '展开' : '收起'}</span>
    </button>
    ${collapsed ? null : html`<div class="duck-warning__body" role="status" aria-live="polite">
      ${active.slice(0, 2).map(g => html`<div key=${g.id} class="duck-warning__group">
        <strong>${g.enemies.map(e => `${e.name}（${e.coins}金）`).join(' ＋ ')}</strong>
        <p>${[...new Set(g.enemies.map(e => e.hint))].join(' ')}</p>
      </div>`)}
      ${active.length > 2 ? html`<small>另有 ${active.length - 2} 批增援即将入场，留意标记入口。</small>` : null}
    </div>`}
  </aside>`;
}
