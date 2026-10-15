export const KALTS2_START_MAX_RISE = 0.35;

/** Limit this model's oversized entrance translation, including its mix into the next clip. */
export function entrancePoseOffsetY(info, actor, scale, modelScale) {
  if ((info?.spine || info?.defId) !== 'char_1052_kalts2' || !actor
    || !Number.isFinite(scale) || !Number.isFinite(modelScale) || !(scale > 0) || !(modelScale > 0)) return 0;
  const deploy = actor.entry?.anims?.deploy;
  if (!deploy) return 0;
  let entering = actor.current === deploy;
  for (let track = actor.spine?.state?.tracks?.[0], depth = 0; track && depth < 4; track = track.mixingFrom, depth++) {
    if (track.animation?.name === deploy) entering = true;
  }
  if (!entering) return 0;
  const skeleton = actor.spine?.skeleton;
  const bone = skeleton?.findBone?.('Front_A') || skeleton?.findBone?.('Back_A');
  if (!Number.isFinite(bone?.y) || !Number.isFinite(bone?.data?.y)) return 0;
  const excess = bone.y - bone.data.y - KALTS2_START_MAX_RISE / modelScale;
  return Math.max(0, excess) * scale;
}
