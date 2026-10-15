# Personal Settlement Layout

Status: local only, not uploaded to RainYun.

- The supplied screenshot is a layout reference, not player or reward data.
- Landscape composition is retained on phones and desktop: verdict and player
  identity on the left, two rows of five portrait slots on the right, then bonds.
  There is no stacked portrait-phone layout. The application's existing rotate
  hint still handles phones held vertically.
- Player name and avatar use the actual settlement player and the existing
  PlayerAvatar component. Player selection changes the identity, trophies,
  rounds, damage, lineup, equipment and bonds together.
- The simplified-Chinese locale shows the existing labels: terminal simulation,
  simulation complete/failed and trophies earned. Other locale support remains.
- Account certification, experience and level-progress UI is omitted. Underlying
  reward calculations and saved history payloads are not changed.
- Operator portraits resolve selected skins, DIY picks and stand-ins through the
  existing asset APIs. Equipment remains attached to each actual lineup unit;
  each equipment icon is roughly one third of the portrait width, not half.
- All active bonds remain available in the horizontally scrollable strip, with
  paging arrows, keyboard scrolling and the existing hidden-layer rules.
- The first screen includes actual damage dealt. Large values are abbreviated,
  with an exact number in the value's tooltip.
- The central TARGET POINT diagram uses the original target/quarter-ring/arrow
  bitmaps: concentric rings, centre, caption and five rays. The native quarter's
  origin is its bottom-left corner; all four quarters share that fixed centre.
  It is an aria-hidden, pointer-inert background layer and never intercepts
  player selection or the footer. Victory/defeat use gold/red ring sprites.
- Next opens the existing per-player statistics, followed by the previous
  return-to-room/lobby/history callback. Archive replay shares the new layout.

## Verification

- 82 result, game-logic, history and UI-regression tests passed.
- Focused lint, browser build and import-boundary checks passed.
- `node tools/qa-result-portrait.mjs`: real Edge checks at 1920x1080, 1440x900,
  1280x720, 1024x600, 844x390, 768x360 and 640x360. Assertions cover live image
  loading, no horizontal overflow, distinct portrait columns, compact equipment,
  landscape placement and footer separation.
- Interaction checks cover teammate selection, keyboard tabs, damage switching,
  statistics/back navigation, defeat with no lineup, and archive replay with
  twelve units and a long custom player name.
- Reports and screenshots: `.cache/result-portrait/`.

Local preview (sample data):
`http://127.0.0.1:14529/dev/game-mock.html?phase=RESULT&shot=1`
