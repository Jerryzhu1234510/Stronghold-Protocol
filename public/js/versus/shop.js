import { html, TierChip } from '../ui/components.js';
import { Img, CoinGlyph } from '../ui/gameComponents.js';
import { ChessCard, ItemCard, SoldCard, PriceHex, LevelCard } from '../ui/shopBar.js';
import { t } from '../../../shared/i18n.js';

export { CoinGlyph, LevelCard };

export function mixedShopOffers(shop) {
  const stocks = shop || {};
  return [['operator', 5], ['monster', 5], ['equipment', 1]].flatMap(([kind, count]) =>
    Array.from({ length: count }, (_, index) => ({ kind, index, id: stocks[kind]?.[index] ?? null })));
}

export function VersusShopCard({ card, kind, index, priv, armed, reason, image, onTap }) {
  const props = { slot: card && { id: card.id, price: card.price }, idx: index, priv, armed, reason, onTap,
    onDetail: () => onTap(index), compact: true };
  return html`<div class=${`shop-offer ${kind || card?.kind || 'sold'}`} data-id=${card?.id} data-shop-kind=${kind || card?.kind} data-shop-index=${index}>
    ${!card ? html`<${SoldCard}/>` : card.kind === 'operator' ? html`<${ChessCard} ...${props}/>`
      : card.kind === 'equipment' ? html`<${ItemCard} ...${props}/>`
      : html`<button type="button" class=${`scard scard--monster scard--t${card.tier} ${armed ? 'is-armed' : ''} ${reason ? 'is-disabled' : ''}`}
          aria-label=${t('{name}，{price}金币，{quantity}只', { name: card.name, price: card.price, quantity: card.quantity })} aria-pressed=${armed} onClick=${() => onTap(index)}
          onContextMenu=${e => { e.preventDefault(); onTap(index); }}>
        <span class="scard__bg" aria-hidden="true"></span>
        <span class="scard__top"><${TierChip} tier=${card.tier}/><${PriceHex} slot=${props.slot} poor=${reason === '资金不足'}/></span>
        <span class="scard__itemart"><${Img} src=${image}/></span>
        <span class="scard__quantity">×${card.quantity}</span>
        <span class="scard__body"><span class="scard__name">${card.name}</span></span>
        ${armed && html`<span class=${`scard__confirm ${reason ? 'is-no' : ''}`} role="status"><b>${reason || t('确认购买')}</b><small>${t('再次点击')}</small></span>`}
      </button>`}
  </div>`;
}
