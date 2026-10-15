# CDN First-Navigation Repair - 2026-10-14

## Cause

The deployed gateway served `/game.html` and then rewrote its visible URL with
`history.replaceState`. Registering a worker for `/_build/<generation>/` did not
control that original document. Registration activation alone was not sufficient;
first model requests bypassed the CDN worker, whereas a subsequent reload worked.

Live validation exposed a second issue: the gateway rewrote `HASHED_ROOTS` URL
literals inside the served shared parser. After removing the release prefix, the
worker could no longer strip `~<hash>`, looked up the wrong directory shard (404),
and silently downloaded models from the origin. Parser roots are now constructed
from root names so namespace rewriting cannot modify their canonical meaning.

## Repair

- Main and versus boot detect a history-only entry via the navigation timing URL.
  They reload the already-pinned URL before starting the application. Reload is
  intentional: replacing an identical URL with a fragment can remain same-document.
- Direct pinned documents do not reload or migrate to a newer release.
- Field loading waits up to 2.5 seconds for the correct generation's controller.
  Unavailable, blocked or stalled worker registration falls back to the origin.
- Future gateway starts redirect all GET/HEAD entry documents into their release
  scope with a no-store HTTP 302. Queries and bootstrap fragments are retained.
- The live gateway was not restarted; the frontend compatibility repair works with
  its existing history-only bootstrap. DNS, firewall and CDN account routing were
  not changed. This does not guarantee a geographically closer Cloudflare edge.

## Verification

- 162 focused regression tests passed, covering resource transport/cache, reward
  rounds, cooperative rendering, mobile cameras, voting and result-related code.
- 23 gateway/browser/compatibility tests passed in a separate run, including actual
  matches and reconnection across activation. Browser build and import checks passed.
- `tools/qa-resource-first-control.mjs` uses fresh Edge contexts, actual bundled
  game code, real model bytes and their existing verified CDN mappings. CDN responses
  are deterministic test fixtures; source model downloads are deliberately rejected.
- HTTP-redirect, legacy-bootstrap, pinned-old and blocked-worker cases all passed.
  Three Spine models parsed and rendered nonblank pixels in desktop/mobile captures.
  Blocked workers still loaded all three models from the origin without a reload loop.
- Artifacts: `.cache/resource-first-control/report.json` and its four screenshots.
- Final additional run: 59 resource, served-parser, asset-path, gateway and browser
  regression tests passed. The real browser fixture now uses production-style
  hashed model paths and rejects their unhashed origin equivalents too.
- Live fresh Edge, `tools/diagnose-model-browser-live.mjs --no-reload`: controller
  attached on first opening, all nine model files returned from R2; directory
  shards returned 200. No download/page errors. Three model loads took 3.67, 1.25
  and 4.12 seconds, with valid Spine animations. This samples one network route,
  not every player's ISP. The local CDN edge still reported LAX.

## Deployment

- Activated generation: `62fca13d586d-3`.
- Runtime: `/opt/stronghold-rainyun/releases/20261014-v026-feedback-cdn-final`.
- Previous generations `5d377f1362e1-1` and `0f5a0e73c40a-2` remain draining for
  existing matches; all three workers were healthy after activation.
- Gateway PID stayed `72145`; no game service restart was performed.
- Delta archive SHA-256:
  `cd76a09a989b5747f61261295ac23c6a52a0781253e3c8d389107810559a532b`.
- Archive: 8,100,591 bytes; all 20,300 resource files reused, 20,210 CDN mappings kept.
- Follow-up parser/browser patch SHA-256:
  `c06432d09863ac09442dbca208ba8648b017129989ca40a790081c1e5293768a`.
- Includes the earlier settlement, hidden-pipe pivot, R3/R9/R11, healing visibility,
  third-field terrain, compact prep vote, mobile framing and announcement changes.
- Mac packaging remains paused and is not part of this runtime release.
