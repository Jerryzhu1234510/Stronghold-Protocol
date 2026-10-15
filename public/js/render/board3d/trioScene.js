// The third defence field copies normal tiles by (+8, -7); never reuse the boss terrain occupying that space.
const SOURCE = [ -.5, 8.5, 12.5, 12.5 ];
const TARGET = [ 7.5, 1.5, 20.5, 5.5 ];
const cache = new WeakMap();

function split(poly, axis, edge, sign) {
  const inside = [], outside = [];
  let a = poly.at(-1), da = sign * (a[axis] - edge);
  for (const b of poly) {
    const db = sign * (b[axis] - edge);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db), hit = a.map((v, i) => v + t * (b[i] - v));
      inside.push(hit); outside.push(hit);
    }
    (db >= 0 ? inside : outside).push(b);
    a = b; da = db;
  }
  return [inside, outside];
}

function slice(chunk, rect, keepInside, dx = 0, dy = 0) {
  const vertices = [], indices = [];
  const append = poly => {
    if (poly.length < 3) return;
    const base = vertices.length;
    vertices.push(...poly);
    for (let i = 1; i < poly.length - 1; i++) indices.push(base, base + i, base + i + 1);
  };
  const planes = [[0, rect[0], 1], [0, rect[2], -1], [1, rect[1], 1], [1, rect[3], -1]];
  for (let i = 0; i < chunk.index.length; i += 3) {
    let poly = Array.from(chunk.index.subarray(i, i + 3), v => [
      ...chunk.position.subarray(v * 3, v * 3 + 3), ...chunk.uv.subarray(v * 2, v * 2 + 2),
      ...chunk.uv1.subarray(v * 2, v * 2 + 2), ...chunk.normal.subarray(v * 4, v * 4 + 4),
      ...chunk.color.subarray(v * 4, v * 4 + 4),
    ]);
    for (const [axis, edge, sign] of planes) {
      if (poly.length < 3) break;
      const [inside, outside] = split(poly, axis, edge, sign);
      if (!keepInside) append(outside);
      poly = inside;
    }
    if (keepInside) append(poly);
  }
  if (!indices.length) return null;
  const position = new Float32Array(vertices.length * 3), uv = new Float32Array(vertices.length * 2);
  const uv1 = new Float32Array(uv.length), normal = new Int8Array(vertices.length * 4), color = new Uint8Array(normal.length);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  vertices.forEach((v, i) => {
    const p = [v[0] + dx, v[1] + dy, v[2]];
    position.set(p, i * 3); uv.set(v.slice(3, 5), i * 2); uv1.set(v.slice(5, 7), i * 2);
    normal.set(v.slice(7, 11).map(Math.round), i * 4); color.set(v.slice(11, 15).map(Math.round), i * 4);
    p.forEach((n, a) => { bounds[a] = Math.min(bounds[a], n); bounds[a + 3] = Math.max(bounds[a + 3], n); });
  });
  return { ...chunk, group: '', position, uv, uv1, normal, color, bounds,
    index: vertices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices) };
}

const overlaps = (b, r) => b && b[0] < r[2] && b[3] > r[0] && b[1] < r[3] && b[4] > r[1];
export function trioSceneChunks(pack) {
  if (cache.has(pack)) return cache.get(pack);
  const out = [];
  for (const chunk of pack.chunks || []) {
    // Preserve the distant background plane, but remove the boss's floors and props under the third field.
    const background = chunk.bounds?.[5] < -1;
    const base = !background && overlaps(chunk.bounds, TARGET) ? slice(chunk, TARGET, false) : chunk;
    if (base) out.push(base);
    if (!background && overlaps(chunk.bounds, SOURCE)) {
      const copy = slice(chunk, SOURCE, true, 8, -7);
      if (copy) out.push(copy);
    }
  }
  cache.set(pack, out);
  return out;
}
