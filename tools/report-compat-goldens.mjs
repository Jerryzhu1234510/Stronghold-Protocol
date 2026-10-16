// Compare the saved upstream corpus with the intentional local gameplay baseline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { FAMILY_NAMES, compareFamily, storedDigests } from './golden.mjs';

const root = path.resolve(import.meta.dirname, '..');
const work = path.dirname(root);
const saved = path.join(work, 'official-golden-before-compat-20261016/golden');
const families = {};
for (const family of FAMILY_NAMES) {
  const old = storedDigests(JSON.parse(await fs.readFile(path.join(saved, family + '.json'), 'utf8')));
  const current = storedDigests(JSON.parse(await fs.readFile(path.join(root, 'test/golden', family + '.json'), 'utf8')));
  families[family] = {
    count: Object.keys(current).length,
    changed: compareFamily(old, current).map(row => row.scenario),
    added: Object.keys(current).filter(id => !(id in old)),
    removed: Object.keys(old).filter(id => !(id in current)),
  };
}
const report = {
  upstream: 'c24e17eec3af1e6dedfa9935a6d15245cf2f4586',
  total: Object.values(families).reduce((n, f) => n + f.count, 0),
  families,
};
await fs.writeFile(path.join(work, 'repair-golden-moves.json'), JSON.stringify(report, null, 2) + '\n');
const rows = Object.entries(families).map(([name, f]) => `| ${name} | ${f.count} | ${f.changed.length} | ${f.added.length} |`);
const details = Object.entries(families).map(([name, f]) => `### ${name}\n\n${f.changed.length ? f.changed.map(id => '- `' + id + '`' + (f.added.includes(id) ? ' (new)' : '')).join('\n') : 'No moved scenarios.'}`);
const body = `# DESIGN §35 — Local 0.3.0 compatibility golden changes\n\nPart of [DESIGN.md](../DESIGN.md). This section belongs to the local fork.\n\n## 35. Intentional local golden changes\n\nCompared against upstream commit \`${report.upstream}\`; the original 288-scenario corpus is saved outside the release at \`../official-golden-before-compat-20261016/golden/\`. The local corpus has ${report.total} scenarios. This is an intentional custom baseline, not a claim that upstream results stayed identical.\n\n## Why results move\n\n- The maintainer retained the old shop-form Clementia, Sakiko and Makoto. The extra shop entry changes sorted roster groupings, bond representatives, common Boss/helper lineups, random shop draws and match lineups; the two DIY operators add three corpus groups. Existing official operator records and official Clementia skills win when overlapping.\n- The maintainer explicitly retained the upper water-map Boss passage. The adapter preserves both patrol directions, waits and teleports, closes the patrol at its first movement checkpoint, and avoids leaking through the goal sentinel. This affects water Boss fields and match outcomes.\n- Official 0.3.0 shared-stock and skill rules remain the default. PvP-specific economy, cap and projection fixes stay scoped to that retained optional mode. The whole local baseline was regenerated after these intentional gameplay differences; no golden was relaxed to hide a nondeterministic result.\n\n| Family | Current | Moved, including new | Added |\n| --- | ---: | ---: | ---: |\n${rows.join('\n')}\n\nEvery moved scenario is named below. The per-field old/new diff can be regenerated with \`compareFamily\` in \`tools/golden.mjs\` and the saved corpus. Recompute the baseline with \`node tools/golden.mjs --update\`; check it with \`node tools/golden.mjs\` and \`node tools/golden.mjs --twice\`.\n\n${details.join('\n\n')}\n`;
await fs.writeFile(path.join(root, 'docs/history/0.3.0-compat-goldens.md'), body);
console.log(JSON.stringify(report));
