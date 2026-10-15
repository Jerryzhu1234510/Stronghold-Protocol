import { createHash } from 'node:crypto';

// Models share a tiny directory index instead of downloading the whole art catalog.
export function resourceRoutingCatalog(manifest) {
  const directories = new Map(), hashes = new Set();
  let bytes = 0;
  const group = pathname => {
    const directory = pathname.slice(0, pathname.lastIndexOf('/'));
    const key = createHash('sha256').update(directory).digest('hex') + '.json';
    if (!directories.has(key)) directories.set(key, { version: 1, entries: {}, aliases: {} });
    return directories.get(key);
  };
  for (const [pathname, item] of Object.entries(manifest.entries || {})) {
    if (!/^\/(assets|fonts)\//.test(pathname) || !/^[a-f0-9]{64}$/.test(item?.hash)
      || !(item.bytes > 0 && item.bytes <= 32 * 1048576)) continue;
    group(pathname).entries[pathname] = item;
    if (!hashes.has(item.hash)) { hashes.add(item.hash); bytes += item.bytes; }
  }
  for (const [alias, pathname] of Object.entries(manifest.aliases || {})) {
    if (!alias.startsWith('/media/') || !manifest.entries?.[pathname]) continue;
    const value = group(alias);
    value.aliases[alias] = pathname; value.entries[pathname] = manifest.entries[pathname];
  }
  const index = { version: 1, count: manifest.count ?? Object.keys(manifest.entries || {}).length,
    totalBytes: manifest.totalBytes, preload: { total: hashes.size, totalBytes: bytes } };
  return new Map([['index.json', index], ...directories]);
}
