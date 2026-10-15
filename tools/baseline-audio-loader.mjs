import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const baseline = new URL('../.cache/v026-integration/before/public/js/audio.js', import.meta.url);
// Run the existing tests against the saved source without swapping any workspace files.
export async function load(url, context, nextLoad) {
  if (url.endsWith('/public/js/audio.js')) return { format:'module', source:readFileSync(fileURLToPath(baseline),'utf8'), shortCircuit:true };
  return nextLoad(url, context);
}
