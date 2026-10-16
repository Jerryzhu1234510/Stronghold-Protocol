import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { browserSimPlugin } from './browser-sim-plugin.mjs';
const root = path.resolve(import.meta.dirname, '..');
const paths = {
  name: 'compat-root-paths',
  setup(builder) {
    builder.onResolve({ filter: /^\/(sim|shared)\// }, args => ({ path: path.join(root, args.path.startsWith('/sim/') ? 'server' : '', args.path.slice(1)) }));
    builder.onLoad({ filter: /\.js$/ }, async args => {
      let contents = await fs.readFile(args.path, 'utf8');
      if (contents.includes('import.meta.url') && args.path.startsWith(path.join(root, 'public'))) {
        const relative = '/' + path.relative(path.join(root, 'public'), args.path).replaceAll('\\', '/');
        contents = contents.replaceAll('import.meta.url', `new URL(${JSON.stringify(relative)},location.origin).href`);
      }
      return { contents, loader: 'js' };
    });
  },
};
await fs.mkdir(path.join(root, 'public/js/browser'), { recursive: true });
await fs.copyFile(path.join(root,'public/index.html'),path.join(root,'public/game.html'));
const options = { absWorkingDir: root, bundle: true, platform: 'browser', minify: true, target: 'es2022', banner: {js:'// i18n-ignore-file: generated bundle; translate its source modules.'}, plugins: [browserSimPlugin, paths] };
await build({ ...options, entryPoints: ['public/js/training/app.js'], outfile: 'public/js/browser/training.js', format: 'iife' });
await build({ ...options, entryPoints: ['public/js/ui/compat.js'], outfile: 'public/js/browser/compat.js', format: 'iife' });
await build({ ...options, stdin: { contents: "export * as spec from './server/sim/spec.js';export * as simdata from './server/sim/simdata.js';export * as support from './server/sim/content/support/index.js';export { KITS } from './server/sim/content/kits/index.js';", resolveDir: root }, outfile: 'public/js/browser/sim.js', format: 'esm' });
console.log('Local training pages built against the current official simulation.');
