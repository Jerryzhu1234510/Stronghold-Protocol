# Lobby predownload release, 2026-10-13

Published to https://weishuxieyi.icu/ with explicit user authorization.

- Release: `r29`, generation `f638115c25cd-20`.
- Compatible browser bundle: `84e638d27fd3`.
- Manual lobby predownload no longer has the 128 KiB/s scheduling limit.
- Up to four unique missing files download concurrently, with a cross-tab lock.
- Explicit start, pause, failure backoff, existing cache verification, and stopping
  new batches on entering a room remain in place. Automatic bulk loading is off.
- The audited R2 manifest is unchanged: 21,404 paths, 19,997 unique objects,
  1,230,362,148 unique bytes.

## Deployment Scope

Cloned r28 without changing its files. Audited 475 compiled-browser inputs
against r28. Published the three predownload runtime files and the three
previously production-served compatibility source changes. Did not publish
unrelated dirty workspace changes, change game balance, or rebuild the APK.

New immutable bundle routes and a new pinned entry were staged before switching
the active backend. Unversioned game and versus entries switched after the new
backend became healthy. The restart pointer now refers to `/releases/r29`.
The existing six-hour Caddy stream-close delay was preserved.

## Retired Versions

Verified r26 and r27 had zero connections, zero online players, and zero online
players in matches immediately before stopping their workers. Added redirects
from retired HTML entries to the server selector, then removed their release
directories and corresponding static mirrors.

Preserved r28's live process, pinned browser bundle, resources, and existing
matches. Do not remove r28 while it still has players in matches.

## Verification

- Local focused tests: 53 passing.
- Remote predownload/cache regression tests: 31 passing.
- Live HTTPS game, versus, immutable bundle byte checks, resource-manifest hash,
  retired-entry redirects, backend health, and restart pointer verified.
- Real Edge browser: entered the live lobby, started concurrent manual warmup,
  observed successful cache progress, and paused with no further new batches.
- Inspected screenshots at 844 x 390 and 1440 x 900; no JavaScript errors.

Evidence, Caddy snapshots, and deployment reports:
`D:/Codex/2026-10-10/a/outputs/preload-r29-deploy/`.
