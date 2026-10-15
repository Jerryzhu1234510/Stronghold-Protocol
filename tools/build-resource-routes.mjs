import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { resourceRoutingCatalog } from '../server/http/resourceRoutes.js';

export async function writeResourceRoutes(manifest, outputDir) {
  if (manifest?.version !== 1 || !manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) throw new Error('Invalid resource manifest');
  const catalog = resourceRoutingCatalog(manifest);
  await fs.mkdir(outputDir, { recursive: true });
  for (const [name, value] of catalog) {
    const body = JSON.stringify(value);
    await fs.writeFile(path.join(outputDir, name), body);
    await fs.writeFile(path.join(outputDir, name + '.gz'), gzipSync(body, { level: 6 }));
  }
  return { files: catalog.size, indexBytes: Buffer.byteLength(JSON.stringify(catalog.get('index.json'))), output: path.resolve(outputDir) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node tools/build-resource-routes.mjs <resource-cache.json> <output-directory>');
  console.log(JSON.stringify(await writeResourceRoutes(JSON.parse(await fs.readFile(input, 'utf8')), output)));
}
