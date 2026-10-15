# Hidden Pipe Model Position

Status: local fix only. Not uploaded to RainYun.

## Cause

`enemy_9021_acduml_2` spawns at `(x=9,y=3)`. Its fixed hit rectangle has
`dx=1`, so its horizontal centre is at `x=10`. The ordinary and hidden pipe
use the same skeleton, whose visible body is offset from its root.

Previously the left-facing hidden model was mirrored around the spawn origin
at `x=9`, instead of its body centre at `x=10`. This put the model approximately
two tiles toward the allied frontline. It reproduces in a fresh preparation
scene without any previous Phantom battle.

## Fix

`public/js/render/enemyPose.js` scopes the visual pivot to this hidden enemy.
`UnitView` uses the fixed centre for the model, shadow and HUD, and compensates
the body origin when flipping. Native right-facing artwork keeps its original
absolute position. Direct Spine and impostor rendering share the correction.

Logical spawn coordinates, snapshot coordinates, hit area, paths and combat
values are unchanged. Other enemies retain the previous rendering behaviour.
The existing Kal'tsit entrance-height correction is preserved.

## Verification

- 34 focused renderer tests passed, including the two new hidden-pipe tests.
- 40 picking and impostor-bounds regression tests passed.
- Browser build and import-boundary checks passed.
- Focused lint: no errors; two existing warnings in unrelated assignments.
- Real Edge/WebGL QA at 1440x900 and 844x390 checks both board sides, ordinary
  pipe and Phantom controls, hidden preparation and battle, direct rendering
  and cached impostors. Assertions check logical coordinates, pivot projection,
  body projection, nonblank model pixels and a nonblank 3D board.

Reproduce browser QA with `node tools/qa-hidden-pipe-position.mjs --after`.
Reports and screenshots are under `.cache/hidden-pipe-position/after/`.
