# r28 Server Selector Fix

Published 2026-10-12. Current generation: `ab085fdd8778-19`.

## Cause And Fix

The selector previously fetched icu health statistics only. The 8443 request
to `/lobby/ping` measured reachability but returned no population statistics.

The 8443 homepage publishes its CORS-enabled, read-only endpoint:
`https://weishuxieyiwangye.cn:8443/lobby/status.json`.
The selector now reads the endpoint's `nodes.8443` entry independently of icu.
It deliberately ignores the friend's `nodes.icu` entry, retaining our own
healthy-generation aggregation and avoiding duplicate or conflicting counts.
An unavailable or malformed response leaves only that node unknown.
Polling remains every 30 seconds while the page is visible.

## Verification

- Local browser regression: all 8 scenarios passed, including unavailable
  friend, missing node, malformed JSON, partial data, and unavailable own server.
- Production Edge: 1440x1000 desktop and 390x844 mobile, both passed.
- Displayed friend metrics exactly matched the response captured by the browser.
- Both server links worked; no horizontal overflow or page script errors.
- Evidence: `D:/Codex/2026-10-10/a/outputs/r28-selector/production-browser.json`.

## Deployment

Cloned r27 into `/home/ubuntu/stronghold-hot/releases/r28` using hardlinks,
then atomically replaced only `public/server-lobby.html` in the new release.
The r27 runtime inventory remained unchanged. The resource manifest and CDN
configuration are reused unchanged from r27. Restart pointer is `/releases/r28`.
Gateway, r26, and r27 worker PIDs remained running; no existing matches restarted.

Open the unversioned homepage to obtain the updated selector. An already pinned
r27 selector remains the old snapshot; its game links and existing games are
intentionally retained. Three healthy workers now exist, so another release
must check capacity and safely drain an idle older worker before publishing.
