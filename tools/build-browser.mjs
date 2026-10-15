import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserSimPlugin } from './browser-sim-plugin.mjs';
import { createHash } from 'node:crypto';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'public/js/browser');
const targets = ['chrome80', 'firefox78', 'safari15'];
const inputs = new Set();
await mkdir(out, { recursive: true });

// Keep original URL bases for workers and the version-pinned versus iframe after bundling.
const sourceUrls = {
  name: 'browser-source-urls',
  setup(builder) {
    builder.onResolve({ filter: /^\/(shared|sim)\// }, args => ({
      path: path.join(repo, args.path.startsWith('/sim/') ? 'server' : '', args.path.slice(1)),
    }));
    builder.onLoad({ filter: /\.js$/ }, async args => {
      let contents = await readFile(args.path, 'utf8');
      if (contents.includes('import.meta.url')) {
        const relative = path.relative(path.join(repo, 'public'), args.path).replaceAll('\\', '/');
        if (relative.startsWith('../')) throw new Error(`Unexpected browser import.meta.url: ${args.path}`);
        contents = contents.replaceAll('import.meta.url', `new URL(${JSON.stringify('/' + relative)}, location.origin).href`);
      }
      return { contents, loader: 'js' };
    });
  },
};

for (const [name, entry] of Object.entries({ main: 'public/js/main.js', versus: 'public/js/versus/app.js', compat: 'public/js/ui/compat.js', training: 'public/js/training/app.js' })) {
  const result = await build({
    absWorkingDir: repo, entryPoints: [entry], outfile: path.join(out, `${name}.js`),
    bundle: true, format: 'iife', platform: 'browser', target: targets,
    minify: true, legalComments: 'eof', metafile: true, plugins: [sourceUrls],
  });
  for (const file of Object.keys(result.metafile.inputs)) inputs.add(file);
  console.log(`${name}: ${Object.keys(result.metafile.inputs).length} modules -> ${result.metafile.outputs[`public/js/browser/${name}.js`].bytes} bytes`);
}

const simulation = await build({
  absWorkingDir: repo,
  stdin: { contents: "export * as spec from './server/sim/spec.js'; export * as simdata from './server/sim/simdata.js'; export * as support from './server/sim/content/support/index.js'; export { KITS } from './server/sim/content/kits/index.js';", resolveDir: repo },
  outfile: path.join(out, 'sim.js'), bundle: true, format: 'esm', platform: 'browser',
  target: targets, minify: true, legalComments: 'eof', metafile: true, plugins: [browserSimPlugin, sourceUrls],
});
for (const file of Object.keys(simulation.metafile.inputs)) inputs.add(file);
const sourceHashes = {};
for (const file of [...inputs].sort()) {
  if (file === '<stdin>' || file.startsWith('browser-game-data:')) continue;
  sourceHashes[file] = createHash('sha256').update(await readFile(path.join(repo, file))).digest('hex');
}
await writeFile(path.join(out, 'source-hashes.json'), JSON.stringify(sourceHashes, null, 2));

let html = await readFile(path.join(repo, 'public/index.html'), 'utf8');
html = html.replace(/\s*<!-- startup-preloads:start -->[\s\S]*?<!-- startup-preloads:end -->/, '');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/g, '');
html = html.replace('<script type="module" src="/js/main.js"', '<script defer src="/js/browser/main.js"');
html = html.replace('href="./css/match-history.css"', 'href="/css/match-history.css"');
html = html.replace('<head>', '<head><script>window.__SP_BROWSER_SIM__="/js/browser/sim.js";</script>');
html = html.replace(/\s*<script nomodule>[\s\S]*?<\/script>/, '');
await writeFile(path.join(out, 'game.html'), html);

let versus = await readFile(path.join(repo, 'public/versus.html'), 'utf8');
versus = versus.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/g, '');
versus = versus.replace('<script type="module" src="/js/versus/app.js">', '<script defer src="/js/browser/versus.js">');
await writeFile(path.join(out, 'versus.html'), versus);

let selector = await readFile(path.join(repo, 'public/server-lobby.html'), 'utf8');
const scripts = [...selector.matchAll(/<script>([\s\S]*?)<\/script>/g)];
for (const [tag, source] of scripts) {
  const compiled = await transform(source, { target: targets, minify: true });
  selector = selector.replace(tag, `<script>${compiled.code}</script>`);
}
selector = selector.replace('</head>', '<script src="/js/browser/compat.js"></script>\n</head>');
await writeFile(path.join(out, 'server-lobby.html'), selector);
