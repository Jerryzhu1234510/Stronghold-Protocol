import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

export function populationCounts(reports) {
  const totals = { online: 0, inGame: 0, lobby: 0, waiting: 0, spectators: 0 };
  if (!reports.length) throw new Error('population unavailable');
  for (const report of reports) {
    const keys = ['onlinePlayers', 'onlineHumans', 'onlineSpectators', 'onlineInMatches'];
    if (!report.ok || !keys.every(key => Number.isInteger(report[key]) && report[key] >= 0)) throw new Error('invalid population');
    const { onlinePlayers: online, onlineHumans: humans, onlineSpectators: spectators, onlineInMatches: inGame } = report;
    if (humans < inGame || online < humans + spectators) throw new Error('inconsistent population');
    totals.online += online;
    totals.inGame += inGame;
    totals.lobby += online - humans - spectators;
    totals.waiting += humans - inGame;
    totals.spectators += spectators;
  }
  return totals;
}

export async function fetchPopulation({ signal, fetcher = globalThis.fetch, generation = globalThis.__SP_GENERATION } = {}) {
  const read = async url => {
    const response = await fetcher(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('population unavailable');
    return response.json();
  };
  if (!generation) return populationCounts([await read('/healthz')]);
  const status = await read('/__hot/status');
  const ids = status.versions?.filter(v => v.healthy && /^[a-zA-Z0-9_-]{1,64}$/.test(v.id)).map(v => v.id);
  if (!ids?.length) throw new Error('population unavailable');
  return populationCounts(await Promise.all(ids.map(id => read(`/_build/${id}/healthz`))));
}

/** Only mounted on entry/waiting screens; background tabs stop polling. */
export function PopulationStrip() {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    let active = true, request = null;
    const refresh = async () => {
      if (!active || document.hidden || request) return;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const value = await fetchPopulation({ signal: controller.signal });
        if (active) setCounts(value);
      } catch { if (active) setCounts(null); }
      finally { clearTimeout(timeout); if (request === controller) request = null; }
    };
    refresh();
    const interval = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; request?.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return html`<div class="population-strip population-strip--detailed" aria-label=${t('服务器当前人数')}
    title=${t('每10秒更新。在线包括对局中、大厅、房间待开局和观战；仅统计已连接的真人，AI和离线玩家不计。')}>
    <div class="population-strip__summary">
      ${[['online', t('在线')], ['inGame', t('对局中')]].map(([key, label]) => html`<span key=${key} data-population=${key}>
        <small>${label}</small><strong class="num">${counts?.[key] ?? '—'}</strong>
      </span>`)}
    </div>
    <div class="population-strip__details">
      ${[['lobby', t('大厅')], ['waiting', t('待开局')], ['spectators', t('观战')]].map(([key, label]) => html`<span key=${key} data-population=${key}>
        <small>${label}</small><strong class="num">${counts?.[key] ?? '—'}</strong>
      </span>`)}
    </div>
  </div>`;
}
