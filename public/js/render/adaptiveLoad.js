// Visual work only: this controller never changes simulation speed, ticks or combat results.
export function createAdaptiveLoad() {
  let level = 0, slowFor = 0, fastFor = 0, frameMs = 16;
  return {
    get level() { return level; },
    get frameMs() { return frameMs; },
    sample(dt, busy, hidden = false, targetFps = 60) {
      if (hidden || !(dt > 0) || !Number.isFinite(dt)) { slowFor = 0; fastFor = 0; return level; }
      // Long frames are precisely when load shedding is needed. Bound a single tab-resume/GC spike's
      // contribution so it cannot by itself trigger a quality change, but count persistent PPT frames.
      const elapsed = Math.min(dt, 0.25);
      frameMs = frameMs * 0.9 + Math.min(dt, 0.5) * 1000 * 0.1;
      const scale = targetFps === 30 ? 2 : 1;
      if (frameMs > 19.5 * scale && busy) { slowFor += elapsed; fastFor = 0; }
      else if (frameMs < 17.6 * scale) { fastFor += elapsed; slowFor = 0; }
      else { slowFor = 0; fastFor = 0; }
      if (slowFor > 1 && level < 3) { level++; slowFor = 0; fastFor = 0; }
      else if (level > 0 && (fastFor > 6 * level || !busy && fastFor > 2)) { level--; fastFor = 0; slowFor = 0; }
      return level;
    },
  };
}
