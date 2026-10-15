import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';

const declaration = (ast, name) => ast.body.flatMap(node => {
  const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
  return declaration?.type === 'VariableDeclaration' ? declaration.declarations : [];
}).find(node => node.id.name === name);

function arrayValues(node) {
  if (node.type === 'ArrayExpression') return node.elements.map(value => value.type === 'Literal' ? value.value : arrayValues(value));
  if (node.type === 'CallExpression') return arrayValues(node.callee.property?.name === 'map' ? node.callee.object : node.arguments[0]);
  throw new Error('Browser registry must contain a literal array');
}

function replaceInitializers(source, ast, replacements) {
  const edits = Object.entries(replacements).map(([name, value]) => {
    const node = declaration(ast, name);
    if (!node?.init || node.init.type !== 'AwaitExpression') throw new Error(`Browser registry changed: ${name}`);
    return { start: node.init.start, end: node.init.end, value };
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

// Resolve the existing content lists at build time. All kit/domain implementations stay unchanged.
export const browserSimPlugin = {
  name: 'browser-simulation-registry',
  setup(builder) {
    builder.onResolve({ filter: /(?:^|[/\\])server[/\\]data\.js$|^\.\.\/\.\.\/\.\.\/data\.js$/ }, args => ({ path: args.path, namespace: 'browser-game-data' }));
    builder.onLoad({ filter: /.*/, namespace: 'browser-game-data' }, () => ({
      contents: "import { getSimData } from './sim/simdata.js'; export function getData() { return getSimData(); }",
      resolveDir: builder.initialOptions.absWorkingDir + '/server', loader: 'js',
    }));
    builder.onLoad({ filter: /server[/\\]sim[/\\](?:simdata\.js|content[/\\](?:index\.js|bonds\.js|bands\.js|kits[/\\]index\.js))$/ }, async args => {
      let source = await readFile(args.path, 'utf8');
      const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
      const imports = [];
      const moduleFor = file => {
        const name = '__browserModule' + imports.length;
        imports.push(`import * as ${name} from ${JSON.stringify(file)};`);
        return name;
      };
      if (args.path.endsWith('simdata.js')) {
        const node = ast.body.find(node => node.type === 'IfStatement' && node.test.name === 'IS_NODE');
        if (!node) throw new Error('Browser sim data loader changed');
        source = source.slice(0, node.start) + source.slice(node.end);
      } else if (/kits[/\\]index\.js$/.test(args.path)) {
        const files = name => arrayValues(declaration(ast, name).init);
        source = replaceInitializers(source, ast, {
          MODULES: JSON.stringify(files('KIT_FILES').map(group => group.map(file => moduleFor('./ops/' + file)))).replace(/"(__browserModule\d+)"/g, '$1'),
          STANDIN_MODULES: '[' + files('STANDIN_KIT_FILES').map(file => moduleFor('./ops/' + file)).join(',') + ']',
          OPERATOR_MODULES: '[' + files('OPERATOR_KIT_FILES').map(file => moduleFor('./ops/' + file)).join(',') + ']',
        });
      } else if (/content[/\\](?:bonds|bands)\.js$/.test(args.path)) {
        const node = ast.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : []).find(node => node.init?.type === 'AwaitExpression');
        const list = node?.init.argument.arguments?.[0];
        if (list?.type !== 'ArrayExpression' || list.elements.some(call => call.callee.name !== 'load' || call.arguments[0]?.type !== 'Literal')) throw new Error('Browser domain loader changed');
        const value = '[' + list.elements.map(call => moduleFor(call.arguments[0].value)).join(',') + ']';
        source = source.slice(0, node.init.start) + value + source.slice(node.init.end);
      } else {
        source = replaceInitializers(source, ast, {
          KIT_REGISTRY: moduleFor('./kits/index.js'),
          DOMAINS: '[' + arrayValues(declaration(ast, 'DOMAIN_NAMES').init).map(name => moduleFor('./' + name + '.js')).join(',') + ']',
        });
      }
      return { contents: imports.join('\n') + '\n' + source, loader: 'js' };
    });
  },
};
