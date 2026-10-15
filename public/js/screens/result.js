// Result screen (research 06 §10.6): victory / defeat hero with rounds passed, boss medallions, and a
// card per player — band, final lineup avatars with elite marks, stats, title (评语) with its icon —
// plus 返回同盟.
//
// Expected m.result (free-form in DESIGN §8.2; fields read tolerantly, see gameLogic.normalizeResult):
//   { victory, roundsPassed, lastRound?, hiddenCleared?, bossId?, hiddenBossId?, difficulty?, modeId?, durationMs?,
//     players: [{ playerId, seat, name, isBot, alive, lp, bandId, roundsPassed?,
//                 title: 'comment_1' | { id, name? } | null,
//                 lineup: [{ id /* chessId, golden id if elite */, golden?, tier?, items?: [itemId],
//                            diy? /* 0.2.0 自选编队: a DIY slot's pick { charId, skillIndex, uniEquipId } — the card
//                                    draws the operator (gameLogic diyRecordFor) */,
//                            standInFor? /* 0.2.0 补位: the replaced operator's charId — the card draws the stand-in
//                                           with a small 「替补」 mark (gameLogic standInOf; the owner's recall, 2026-10-06) */ }],
//                 bonds?: [{ bondId, layers, active }],
//                 stats: { dmgDealt, kills, leaks, gold /* funds SPENT */, refreshes, merges, bossDamage?, itemsEquipped?,
//                          activatedLayers?, lpLost?, perfectRounds? } }] }

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, DifficultyTag, TierChip } from '../ui/components.js';
import { useGameData, Img, UnitThumb, BandIcon, PlayerAvatar, BondGlyph, LpTower, Sprite } from '../ui/gameComponents.js';
import { normalizeResult, fmtNum, diyRecordFor, cardStandIn, standInForText } from '../ui/gameLogic.js';
import { data } from '../data.js';
import { enemyIconUrl, titleIconUrl, uiUrl, chessPortraitUrl, chessAvatarUrl, tokenAvatarUrl, profIconUrl } from '../ui/assetUrls.js';
import { store, useStore, emptyMatch } from '../store.js';
import { audio } from '../audio.js';
import { sentText } from '../ui/lang.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';
import { resultBonds } from '../ui/gameLogic/result.js';

export { resultBonds } from '../ui/gameLogic/result.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const TARGET_RAYS = [{ length: 170, angle: -28 }, { length: 225, angle: -5 },
  { length: 175, angle: 38 }, { length: 145, angle: 65 }, { length: 120, angle: 83 }];

function TargetDiagram({ victory }) {
  const ring = 'settle/target_round_' + (victory ? 's' : 'f');
  return html`<div class="result__target" aria-hidden="true">
    ${['outer', 'inner'].map(size => html`<div key=${size} class=${'result__target-ring result__target-ring--' + size}>
      ${[0, 90, 180, 270].map(angle => html`<${Sprite} key=${angle} k=${ring} class="result__target-quarter" />`)}
    </div>`)}
    <${Sprite} k="settle/target_dot" class="result__target-centre" />
    <div class="result__target-title"><${Sprite} k="settle/target_title_up" /><${Sprite} k="settle/target_title_down" /></div>
    ${TARGET_RAYS.map((ray, i) => html`<span key=${i} class="result__target-ray" style=${`width:${ray.length}%;transform:rotate(${ray.angle}deg)`}>
      <${Sprite} k="settle/arrow_01" class="result__target-arrow" /><${Sprite} k="settle/target_dot" class="result__target-end" />
    </span>`)}
  </div>`;
}

// The first seven present are shown (+ remaining LP = a 4×2 grid); the title (评语) stats come first.
// `gold` is the funds a player SPENT (server/match/player/economy.js spend(); the 挥金如土 title stat).
const STAT_ROWS = [
  ['dmgDealt', N_('造成伤害')], ['kills', N_('击倒敌人')], ['bossDamage', N_('领袖伤害')], ['activatedLayers', N_('盟约层数')],
  ['merges', N_('晋升次数')], ['itemsEquipped', N_('配发装备')], ['gold', N_('消耗资金')], ['perfectRounds', N_('完美作战')],
  ['refreshes', N_('刷新次数')], ['leaks', N_('未击倒')], ['lpLost', N_('损失生命')],
];

/**
 * One unit of a final lineup: a 自选 piece draws its operator; a 补位 piece (`standInFor`) its stand-in, with the small
 * 「替补」 mark — the title names the chess it fielded for.
 */
export function LineupThumb({ u, gd }) {
  const chess = u.kind === 'token' ? null : gd.chess(u.id);
  const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
  const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
  return html`<${UnitThumb} kind=${u.kind === 'token' ? 'token' : 'chess'} id=${u.id} golden=${!!u.golden} tier=${u.tier} size="sm" rec=${dr || si}
    title=${si ? t('{name}（{note}）', { name: si.name, note: standInForText(chess.name) }) : undefined} />`;
}

function LineupPortrait({ u, gd }) {
  if (!u) return html`<div class="result-unit result-unit--empty" aria-label=${t('空位')}><span>NO INFO</span><div class="result-unit__items"><i></i><i></i></div></div>`;
  const chess = u.kind === 'token' ? null : gd.chess(u.id);
  const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
  const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
  const rec = dr || si || chess;
  const src = u.kind === 'token' ? tokenAvatarUrl(gd.m, u.id) : chessPortraitUrl(gd.m, rec) || chessAvatarUrl(gd.m, rec);
  const name = rec?.name || gd.token(u.id)?.name || u.id;
  const level = rec?.status?.level;
  const items = Array.isArray(u.items) ? u.items : [];
  return html`<article class=${cx('result-unit', u.golden && 'is-golden')} title=${si ? t('{name}（{note}）', { name, note: standInForText(chess.name) }) : name}>
    <${Img} src=${src} class="result-unit__portrait" alt=${name} fallback=${html`<span class="result-unit__fallback">${name}</span>`} />
    <${TierChip} tier=${u.tier || rec?.tier || 1} golden=${!!u.golden} class="result-unit__tier" />
    <${Img} src=${profIconUrl(gd.m, rec?.profession)} class="result-unit__profession" />
    ${Number.isFinite(level) ? html`<span class="result-unit__level" title=${t('等级')}><${Icon} name="chevronDown" /><b class="num">${level}</b></span>` : null}
    ${si ? html`<span class="result-unit__standin">${t('替补')}</span>` : null}
    <div class="result-unit__items">
      ${Array.from({ length: Math.max(2, items.length) }, (_, i) => items[i]
        ? html`<${UnitThumb} key=${i} kind="item" id=${typeof items[i] === 'string' ? items[i] : items[i].id} size="sm" showTier=${false} />`
        : html`<i key=${i} aria-label=${t('未配发装备')}><span>NO INFO</span></i>`)}
    </div>
  </article>`;
}

function SettlementBonds({ bonds, gd }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: true, right: bonds.length <= 4 });
  const updateEdges = () => {
    const el = ref.current;
    if (el) setEdges({ left: el.scrollLeft <= 1, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  };
  useEffect(() => {
    updateEdges();
    if (!globalThis.ResizeObserver || !ref.current) return;
    const observer = new globalThis.ResizeObserver(updateEdges);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [bonds.length]);
  const scroll = dir => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * .8,
    behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return html`<div class="result__bond-strip">
    <button type="button" class="result__bond-arrow" title=${t('上一页')} aria-label=${t('上一页')} disabled=${edges.left} onClick=${() => scroll(-1)}><${Icon} name="chevronLeft" /></button>
    <div class="result__bond-list" ref=${ref} onScroll=${updateEdges} tabIndex="0" aria-label=${t('盟约')}>
      ${bonds.length ? bonds.map(b => html`<span key=${b.bondId} data-bond=${b.bondId} class="rbond result__bond is-on" title=${gd.bond(b.bondId)?.name || b.bondId}>
        <span class="result__bond-ring"><${BondGlyph} bondId=${b.bondId} /></span>
        ${b.hideLayers ? html`<span class="result__bond-name">${gd.bond(b.bondId)?.name}</span>` : html`<b class="num">${b.layers ?? 0}</b>`}
      </span>`) : html`<span class="result__no-bonds">${t('暂无激活盟约')}</span>`}
    </div>
    <button type="button" class="result__bond-arrow" title=${t('下一页')} aria-label=${t('下一页')} disabled=${edges.right} onClick=${() => scroll(1)}><${Icon} name="chevronRight" /></button>
  </div>`;
}

function PlayerCard({ p, myId, titles, best, solo = false }) {
  const gd = useGameData();
  const titleRec = p.title ? titles.find((x) => x.id === p.title.id) || null : null;
  // (the server sends the title's Chinese name: the localized config.titles record when it is that record's)
  const rawTitle = p.title ? (data.getRaw('config')?.titles || []).find((x) => x && x.id === p.title.id) || null : null;
  const titleName = sentText(p.title?.name, rawTitle?.name, titleRec?.name) || titleRec?.name || null;
  const stats = STAT_ROWS.filter(([k]) => Number.isFinite(p.stats[k])).slice(0, 7);
  const band = p.bandId ? gd.band(p.bandId) : null;
  const lineup = p.lineup.slice(0, 10);
  const bonds = resultBonds(p.bonds, (id) => gd.bond(id));
  return html`<article class=${cx('rcard', p.playerId === myId && 'is-self', p.alive === false && 'is-dead')}>
    <header class="rcard__head">
      <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
      <div class="rcard__who">
        <b class="rcard__name">${p.name}${p.isBot ? html`<span class="rcard__ai">AI</span>` : null}${p.playerId === myId ? html`<span class="rcard__you">${t('你')}</span>` : null}</b>
        <span class="rcard__band">${band ? html`<${BandIcon} bandId=${band.bandId} size="xs" />${band.name}` : '—'}</span>
      </div>
      <div class="rcard__mid">
        <div class="rcard__lineup">
          ${lineup.length ? lineup.map((u, i) => html`<${LineupThumb} key=${i} u=${u} gd=${gd} />`)
            : html`<span class="rcard__noinfo">${p.alive === false ? t('阵容已撤离') : 'NO INFO'}</span>`}
        </div>
        ${bonds.length ? html`<div class="rcard__bonds">${bonds.map((b) => html`<span key=${b.bondId} data-bond=${b.bondId} class=${cx('rbond', b.active && 'is-on')} title=${gd.bond(b.bondId)?.name || b.bondId}>
          <${BondGlyph} bondId=${b.bondId} />${b.hideLayers ? null : html`<b class="num">${b.layers ?? 0}</b>`}</span>`)}</div>` : null}
      </div>
      <div class="rcard__round"><${MicroLabel}>ROUNDS</${MicroLabel}><b class="num">${p.roundsPassed}</b>
        ${p.trophies > 0 ? html`<span class="rcard__gain"><span title=${t('获得奖杯')}><${Icon} name="crown" /><b class="num">+${p.trophies}</b></span></span>` : null}
      </div>
      ${titleName ? html`<div class="rcard__title" title=${titleRec?.text || p.title?.text || ''}>
        <${Img} src=${titleIconUrl(gd.m, titleRec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_'))} class="rcard__ticon" fallback=${html`<${Icon} name="crown" />`} />
        <span><${MicroLabel} tone="gold">${t('评语')}</${MicroLabel}><b>${titleName}</b></span>
      </div>` : html`<span class="rcard__title rcard__title--none" aria-hidden="true"></span>`}
    </header>
    <div class="rcard__stats">
      ${stats.map(([k, label]) => html`<div key=${k} class=${cx('rstat', best[k] === p.playerId && 'is-best')}><span>${t(label)}</span><b class="num">${fmtNum(p.stats[k])}</b></div>`)}
      ${Number.isFinite(p.lp) ? html`<div class="rstat" title=${p.lpShared && !solo ? t('最终攻势起全队共享目标生命值') : ''}><span>${p.lpShared && !solo ? t('同盟剩余生命') : t('剩余生命')}</span><${LpTower} value=${p.lp} size="sm" /></div>` : null}
    </div>
  </article>`;
}

/** RESULT screen. */
export function ResultScreen({ archive = null, onBack = null } = {}) {
  const liveRes = useStore((s) => s.match.result);
  const livePub = useStore((s) => s.match.public);
  const liveId = useStore((s) => s.me.playerId);
  const res = archive ? archive.result : liveRes;
  const pub = archive ? archive.public : livePub;
  const myId = archive ? archive.myId : liveId;
  const hasRoom = useStore((s) => !!s.room);
  const gd = useGameData();
  const r = normalizeResult(res, pub);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(false);
  const selected = r.players.find(p => p.playerId === selectedId) || r.players.find(p => p.playerId === myId) || r.players[0];
  const bonds = resultBonds(selected?.bonds, id => gd.bond(id));
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const best = {};
  for (const [k] of STAT_ROWS) {
    let top = null;
    for (const p of r.players) if (Number.isFinite(p.stats[k]) && p.stats[k] > 0 && (top == null || p.stats[k] > top.v)) top = { v: p.stats[k], id: p.playerId };
    if (top && r.players.length > 1) best[k] = top.id;
  }
  useEffect(() => { if (!archive) audio.sfx(r.victory ? 'settlementSucceed' : 'settlementFail'); }, []);
  const back = archive ? onBack : () => store.set({ match: emptyMatch() });
  const boss = r.bossId ? gd.boss(r.bossId) : null;
  // the Hidden Core medal (and its corrupted leader) only once R15 was actually fought
  const hidden = r.hiddenBossId && r.hiddenReached ? gd.boss(r.hiddenBossId) : null;
  const bg = uiUrl(gd.m, r.victory ? 'settle/settlemen_personal_success' : 'settle/settlemen_personal_fail');
  const mins = r.durationMs ? Math.round(r.durationMs / 60000) : null;

  return html`<div class=${cx('screen', 'result', 'result--portrait', details && 'is-details', r.victory ? 'is-win' : 'is-lose')}>
    <div class="result__bg" aria-hidden="true" style=${bg ? `--result-bg:url("${bg}")` : undefined}></div>
    <${TargetDiagram} victory=${r.victory} />
    <div class="result__grid" aria-hidden="true"></div>
    <main class="result__main">
      <section class="result__hero">
        <div class="result__logo"><${Sprite} k="entry/season_logo_settle" class="result__logoimg" /><span class="result__wordmark">STRONGHOLD<br />PROTOCOL</span></div>
        <div class="result__verdict">
          ${selected?.bandId ? html`<${BandIcon} bandId=${selected.bandId} size="lg" class="result__strategy" />` : null}
          <div>${r.difficulty ? html`<${DifficultyTag} difficulty=${r.difficulty} size="lg" />` : null}
          <h1 class="result__headline">${r.victory ? t('模拟完成') : t('模拟失败')}</h1></div>
        </div>
        <div class="result__progress"><div class="result__rounds">
          <span class="result__rlabel">${t('通过回合')}</span>
          <b class="result__rnum num">${selected?.roundsPassed ?? r.roundsPassed}</b>
        </div>
        <div class="result__medals">
          ${boss ? html`<div class=${cx('medal', r.victory && 'is-done')} title=${boss.name}>
            <${Img} src=${enemyIconUrl(gd.m, boss.enemyKey)} /><span class="medal__check">${r.victory ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${t('敌方领袖')}</span></div>` : null}
          ${hidden ? html`<div class=${cx('medal', 'medal--hidden', r.hiddenCleared && 'is-done')} title=${hidden.name}>
            <${Img} src=${enemyIconUrl(gd.m, hidden.enemyKey)} /><span class="medal__check">${r.hiddenCleared ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${t('隐秘核心')}</span></div>` : null}
        </div></div>
        ${selected ? html`<div class="result__identity" data-player=${selected.playerId}>
          <${PlayerAvatar} player=${selected} self=${selected.playerId === myId} class="result__avatar" />
          <div class="result__identity-text"><b class="result__player-name">${selected.name}</b>
            <div class="result__identity-metrics"><div><span class="result__trophy-label"><${Icon} name="crown" />${t('获得奖杯')}</span><b class="result__trophies num">${selected.trophies}</b></div>
              <div class="result__damage"><span class="result__trophy-label"><${Icon} name="sword" />${t('造成伤害')}</span><b class="num" title=${Number.isFinite(selected.stats.dmgDealt) ? selected.stats.dmgDealt.toLocaleString('zh-CN') : '0'}>${fmtNum(Number.isFinite(selected.stats.dmgDealt) ? selected.stats.dmgDealt : 0)}</b></div>
            </div>
            ${r.trophyPolicy ? html`<span class=${cx('result__trophy-policy', r.trophyPolicy.custom && 'is-custom')}>${r.trophyPolicy.custom ? t('自定义对局 · 杯数减半') : t('标准计杯')}</span>` : null}
          </div>
        </div>` : null}
        ${mins ? html`<p class="result__time t-lo">${tParts('本局耗时 {n} 分钟', { n: html`<b class="num">${mins}</b>`, mins })}</p>` : null}
      </section>
      ${details ? html`<section class="result__players"><h2 class="brief-h"><span>${t('作战统计')}</span><${MicroLabel}>ALLIANCE REPORT</${MicroLabel}></h2>
        ${r.players.length ? r.players.map(p => html`<${PlayerCard} key=${p.playerId} p=${p} myId=${myId} titles=${titles} best=${best} solo=${r.players.length < 2} />`) : html`<p class="t-dim">${t('暂无结算数据')}</p>`}
      </section>` : html`<section class="result__showcase" aria-label=${t('最终阵容')}>
        ${r.players.length > 1 ? html`<div class="result__player-tabs" role="tablist" aria-label=${t('同盟成员')} onKeyDown=${e => {
          const index = r.players.indexOf(selected);
          const next = e.key === 'ArrowRight' ? (index + 1) % r.players.length : e.key === 'ArrowLeft' ? (index + r.players.length - 1) % r.players.length
            : e.key === 'Home' ? 0 : e.key === 'End' ? r.players.length - 1 : -1;
          if (next < 0) return;
          e.preventDefault(); setSelectedId(r.players[next].playerId); e.currentTarget.querySelectorAll('button')[next]?.focus();
        }}>
          ${r.players.map(p => html`<button type="button" key=${p.playerId} role="tab" id=${'result-tab-' + p.seat} aria-controls="result-lineup" aria-selected=${p === selected} tabIndex=${p === selected ? 0 : -1} class=${cx(p === selected && 'is-selected')} onClick=${() => setSelectedId(p.playerId)}>${p.name}${p.playerId === myId ? html`<small>${t('你')}</small>` : null}</button>`)}
        </div>` : null}
        ${selected ? html`<div id="result-lineup" role="tabpanel" aria-labelledby=${r.players.length > 1 ? 'result-tab-' + selected.seat : undefined} class="result__lineup-grid">${Array.from({ length: Math.max(10, selected.lineup.length) }, (_, i) => html`<${LineupPortrait} key=${selected.playerId + ':' + i} u=${selected.lineup[i]} gd=${gd} />`)}</div>
          <${SettlementBonds} key=${selected.playerId} bonds=${bonds} gd=${gd} />` : html`<p class="t-dim">${t('暂无结算数据')}</p>`}
      </section>`}
    </main>
    <footer class="result__foot">
      ${details ? html`<button type="button" class="result__summary-back" onClick=${() => setDetails(false)} title=${t('返回结算')} aria-label=${t('返回结算')}><${Icon} name="chevronLeft" /></button>` : null}
      <${Button} variant="primary" size="xl" icon=${details ? 'exit' : 'chevronRight'} class="result__next" onClick=${details ? back : () => setDetails(true)}>${details ? archive ? t('返回记录') : hasRoom ? t('返回同盟') : t('返回大厅') : t('下一步')}<//>
    </footer>
  </div>`;
}
