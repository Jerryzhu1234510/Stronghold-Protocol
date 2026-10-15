import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { assets } from '../assets.js';
import { sanitizeCosmetics } from '../../../shared/cosmetics.js';

export const cosmeticsStore = createStore({ choices: sanitizeCosmetics(loadPref('cosmetics', {})) });
const apply = () => {
  const choices = cosmeticsStore.get().choices;
  const manifest = data.get('assets');
  if (manifest) manifest.cosmeticChoices = choices;
  assets.setCosmetics(choices);
};
cosmeticsStore.subscribe(({ choices }) => { savePref('cosmetics', choices); apply(); });
data.subscribe(name => { if (name === 'assets') apply(); });
apply();

export function setSkin(charId, skinId) {
  const manifest = data.get('assets');
  if (skinId && !Object.hasOwn(manifest?.chars?.[charId]?.skins || {}, skinId)) return false;
  const choices = { ...cosmeticsStore.get().choices };
  if (skinId) choices[charId] = skinId;
  else delete choices[charId];
  cosmeticsStore.set({ choices: sanitizeCosmetics(choices) });
  return true;
}
