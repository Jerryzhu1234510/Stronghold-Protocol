# r27 production deployment

Status: published and verified on 2026-10-12.
Generation: `83270655cd7a-18`.

Target: https://weishuxieyi.icu/. The 8443 server is a selector link only.

Production release: `/home/ubuntu/stronghold-hot/releases/r27`.
Previous release: `/home/ubuntu/stronghold-hot/releases/r26`.
Evidence: `D:/Codex/2026-10-10/a/outputs/r27-deploy/`.
Publisher: `D:/Codex/2026-10-10/a/work/deploy-r27.py`.

## Scope

- Native versus shop, detail panel, top-left bonds, mobile camera clearance, active-only settlement bonds, and the tested four-player assault rules.
- Two-server selection, native compact chat, resource preloading, outfits, and voice languages.
- Existing production asset manifests are retained and extended with cosmetics; existing CDN entries remain available.
- The versus iframe resolves relative to its parent module URL, so it stays pinned to the same hot release.
- The selector aggregates healthy hot releases instead of reporting only the newest worker's population.

## Verification

- Final staged server: 371 focused tests passed, including the pinned iframe regression.
- Local deployment-related tests: 29 passed, including the pinned iframe URL.
- Real browser and Playwright: both map appearances passed at 1440 x 900, 844 x 390, and 568 x 320.
- Production browser, before and after cleanup: selector links, outfits, voices, CDN retention, HARD default, pinned iframe, rules, native detail and purchase, open-shop bench access, and all three viewport bounds passed. Temporary private rooms were removed.
- New and old release asset HEAD checks returned 200 after cleanup. Retired HTML entries redirect to the current selector.
- Known pre-existing HUD source/shape assertions are documented in `VERSUS-ASSAULT-LOCAL-TEST.md`; they are not represented as passing.

## Preservation And Cleanup

The initial inspection found 73 online matches on r26. A later health check found 86. Publishing must not restart the gateway or stop that worker.

Only stopped release directories and their unused static mirrors can be deleted. Keep r26, r27, their static mirrors, entry/state directories, and shared CDN/resource-cache configuration. Before deletion, recheck gateway health, connections, process command lines, and canonical absolute paths. Gateway metadata for already-dead workers can remain; it is not a reason to restart the gateway.

A rollback must use another independent release directory cloned from r26. The gateway does not allow `update` to reactivate an already-registered directory. Preserve the corresponding asset mirror and resource-manifest routing when preparing that rollback.

## Completed Cleanup

- Removed 13 stopped releases, r13 through r25.
- Removed 16 unused asset mirrors, including the unused staged generation.
- Removed the two temporary upload archives; measured total reclaimed space: 800,919,552 bytes (about 764 MiB).
- Gateway and both live worker process IDs were unchanged by cleanup. r26 continues its existing games and r27 accepts new players.
- Verified the actual container-mounted restart pointer at `/home/ubuntu/stronghold-hot/recovery-stall-20261009/state/current` contains `/releases/r27`. The older `/home/ubuntu/stronghold-hot/state/current` belongs to a historical deployment and is not the running container's state.
- Added 273 outfits and their associated voice/model resources. The combined preload manifest has 21,404 entries and retains existing CDN mappings.
