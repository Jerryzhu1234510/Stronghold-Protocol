import { html, Button } from './components.js';
import { useStore } from '../store.js';
import { openLoadout, loadoutStore, installLoadoutSync, installOwnershipSync, installDiySync } from './loadoutSync.js';
import { t } from '../../../shared/i18n.js';

let synchronizers = [];
export function installProfiles(net) {
  synchronizers = [installLoadoutSync({ net }), installOwnershipSync({ net }), installDiySync({ net })];
}
export async function flushProfiles() {
  await Promise.all(synchronizers.map(sync => sync.flush()));
}
export function DiyButton({ size = 'sm' }) {
  const picks = useStore(s => s.diy, Object.is, loadoutStore);
  const count = Object.values(picks || {}).filter(Boolean).length;
  return html`<${Button} variant="secondary" size=${size} icon="users"
    onClick=${() => openLoadout('lobby', null, 'diy')}>${t('自选编队')} ${count}/4<//>`;
}
