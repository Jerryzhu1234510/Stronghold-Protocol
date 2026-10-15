# Resource Loading Cold Start Fix

Status: local implementation and testing only. No production upload, restart,
firewall, DNS, relay, or friend-server change was performed.

## Findings

- The deployed worker waited for the entire resource manifest during installation.
  That manifest is 7,573,600 bytes uncompressed (1,354,835 bytes gzip). A slow
  manifest prevented CDN interception from activating at all.
- One CDN failure temporarily disabled CDN transport for unrelated resources.
- Requiring Web Locks for worker registration also disabled CDN transport in
  browsers that could fetch resources but could not persist the shared cache.
- Read-only origin checks found no application download throttle. Origin disk
  reads were fast, while tested external transfers showed retransmissions and
  poor throughput. The exact failing network hop remains unidentified.

## Changes

- Activate the worker without downloading the full resource catalog.
- Request a small directory shard only when an asset in that directory is needed.
  Models retain original atlas/texture URL semantics and content-hash verification.
- Use a 101-byte bootstrap index for status, rather than the full catalog.
- Retain the full catalog for explicit bulk preloading only. Before that catalog
  is loaded, status reports cached file/byte totals but does not reconstruct
  per-file bulk-preload completion from directory shards.
- Isolate CDN cooldown to the failed object. Other objects continue using CDN.
- Keep CDN transport available without Web Locks or with denied cache storage.
- Emit plain and gzip directory indexes when binding an R2 release manifest.
- Rebuild browser bundles locally.

## Verification

- 143 focused resource, compatibility, browser-build, asset, and 3D tests passed.
- Fresh desktop/mobile viewport tests passed with the full catalog stalled and
  origin media unavailable: worker activation, verified CDN fixture downloads,
  cache reuse, 3D board rendering, and animated Spine model rendering.
- Missing Web Locks and denied storage have regression coverage.
- Real CDN requests from the allowed game origin passed for map, background,
  skeleton, atlas, and character texture. All sizes and SHA-256 hashes matched;
  PNG decoding succeeded. The 3,289,397-byte map took 1.76 seconds in this sample.
- Real CDN samples and local worker fixture tests are separate. Local fixture
  timings are NOT internet throughput measurements or phone-hardware benchmarks.
- Broader client-static checks retain three unrelated failures: absolute versus
  simulation imports, CSS ordering expectations, and an existing `:has()` rule.
  These existing files/checks were not changed for this fix.

Reports and screenshots:
`D:/Codex/2026-10-10/a/outputs/resource-loading-fix-20261013/`

## Before Future Deployment

1. Wait for explicit user authorization to upload.
2. Bind the matching uploaded R2 manifest with
   `tools/build-r2-resource-manifest.mjs`; it emits the full manifest and
   `resource-routes/` beside it, including gzip counterparts.
3. Copy both into the new generation's served `data/` directory. If Node directly
   serves resource routes, provide its public directory with the same prebuilt
   `data/resource-cache.json` so it preserves the CDN mappings.
4. Confirm the version-pinned worker can fetch its corresponding index/shards,
   including when Caddy serves them as static files without hitting Node.
5. Verify from the actual game origin; R2 CORS intentionally does not allow an
   arbitrary localhost origin. Keep existing battles on their frozen generation.

This fix does not repair the origin's external network path, relay-provider
listener failures, old APK resource integration, or unavailable browser/WebGL
capabilities. Those require separate verification.
