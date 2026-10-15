# R2 Resource Supplement

Completed on 2026-10-12 with explicit authorization to supplement resources only.
Game generation remains `ab085fdd8778-19`; no game code was published.

## Inventory

- Preserved all 12,881 previous CDN mappings and their content identities.
- Added mappings for 8,523 paths: 2,175 outfit resources and 6,348 voice resources.
- Uploaded 7,271 missing content-addressed objects, totaling 521,179,036 bytes.
- The completed manifest has 21,404 paths and 19,997 unique objects.
- Manifest identity: `9a332909f214a39506d105075ce79749df72b13637370b312a85edacf9e2bfbe`.
- Existing objects were reused only after matching size and MD5. New uploads used
  conditional creation and SHA-256 verification; no objects were overwritten or removed.

## Publication

The existing `/home/ubuntu/stronghold-https/config/resource-r27/resource-cache.json`
and its gzip sibling were replaced atomically after upload verification.
Both r27 and r28 already serve this resource configuration. Caddy configuration
and the gateway and worker process IDs were unchanged. Tencent origin files
remain available as backups. Older sessions may retain their previously loaded
manifest until their resource service worker is initialized again.

Backup: `resource-cache.before-r2-20261012.json` and its gzip sibling in the same directory.

Future deployments must retain this updated resource mapping rather than restore
the earlier `resource-r2-r20` manifest or rebuild CDN mappings from an older snapshot.

## Verification

- All 19,997 objects matched the final R2 inventory; format samples passed readback SHA-256 checks.
- 28 cache, CDN fallback, and preload regression tests passed.
- The live HTTP resource manifest reports all 21,404 mappings.
- Fresh Edge on the version-pinned game URL downloaded 10 new outfit and voice files
  through the real service worker. Every response had source `r2`, correct bytes
  and SHA-256, and a cache `HIT` on repeat.
- English and Japanese samples decoded; outfit images decoded. Original Spine
  loading rendered both sides with valid bones, animations, bounds, and nonblank pixels.
- No JavaScript errors occurred in that verification.

First entry through unversioned `/game.html` separately timed out waiting for
resource-cache control. Verification passed on the pinned URL; this does not
establish that initial-entry/browser/network problems are resolved. No entry
fix was published as part of this resource supplement.

Evidence and resumable upload inventory:
`D:/Codex/2026-10-10/a/outputs/r2-supplement-20261012/`.
