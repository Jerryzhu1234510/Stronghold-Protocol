import { CATALOG, STAGE, RECT, data } from './catalog.js';
import { traitNotes } from './traits.js';

export function versusCatalog(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
    catalog: CATALOG.map(c => ({ ...c, traits: c.kind === 'operator' ? traitNotes(c.id) : [] })),
    stage: STAGE, stages: data.stages, rect: RECT,
  }));
}
