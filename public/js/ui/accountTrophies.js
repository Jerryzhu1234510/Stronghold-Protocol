import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { accountProfile, isSignedIn } from '../account.js';
import { totalTrophiesOf, formatAccountTrophies, watchAccountTrophies } from './accountTrophyState.js';
import { t } from '../../../shared/i18n.js';

export function AccountTrophies({ class: cls = '' }) {
  const [total, setTotal] = useState(() => totalTrophiesOf(accountProfile(), isSignedIn()));
  useEffect(() => watchAccountTrophies(setTotal), []);
  if (total == null) return null;
  const count = formatAccountTrophies(total);
  return html`<span class=${`account-trophies ${cls}`} title=${t('账号累计杯数')} aria-label=${t('累计杯数 {count}', { count })}>
    <${Icon} name="crown" /><span>${t('累计')} <b class="num">${count}</b> ${t('杯')}</span>
  </span>`;
}
