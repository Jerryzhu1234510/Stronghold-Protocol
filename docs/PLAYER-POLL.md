# Player Poll Operations

The Clementia poll is live in r24 (`697fa9f5a02f-15`). It is an anonymous,
single-choice poll. A random UUID retained in browser preferences identifies one
ballot. Changing a choice replaces that ballot. Clearing browser storage or
using another browser creates a new identity; this is not account-level voting.
Only a SHA-256 digest of the identity is stored on the server.

## Service And State

- Container: `stronghold-player-poll`, `node:22-bookworm-slim`, restart policy
  `unless-stopped`; 128 MB memory limit, 0.35 CPU, read-only application mount.
- Source: `/home/ubuntu/stronghold-hot/releases/r24/server/playerPollService.js`.
- State directory: `/home/ubuntu/stronghold-hot/player-poll-state` mounted at
  `/state`; ballots are in `player-poll.json`. Never replace this directory during
  a game release. Back it up independently of release artifacts.
- Port: host `127.0.0.1:14530`; container listens on `0.0.0.0:14530`.
- Health: `GET /healthz` on that private port. Public results use
  `GET /api/player-poll`. POST actions `read` and `vote` require the poll ID and a
  valid UUID. Only `vote` changes state. Avoid casting acceptance-test ballots.
- Caddy routes both `/api/player-poll` and `/_build/*/api/player-poll` to the
  stable service, rewriting the latter to `/api/player-poll`. Preserve this
  route: the pinned game entry rewrites browser fetch paths to its generation.

Writes are serialized, flushed to disk, and atomically renamed before success is
acknowledged. Corrupt state causes startup failure instead of silently resetting
the tally. Browser errors expose retry without treating a failed vote as saved.
Counts refresh every 15 seconds while the dialog is open.

## Future Releases

Carry forward the poll frontend modules, shared definition and CSS. The game
release and the independent poll service have separate lifecycles; changing a
game release does not restart or clear the poll service. To launch a different
poll, archive the current state and use a new poll ID and state filename.

The authoritative r24 startup entry is
`/home/ubuntu/stronghold-https/config/loading-r24/index.html`, not the repository's
local preview entry. It includes `player-poll.css` plus the inline
`player-poll-mobile-r24` fix for narrow lobby headers. Copy this startup entry when
making a subsequent pinned release, or incorporate the equivalent rules from
the current local `public/css/player-poll.css`. Do not overwrite immutable r24
assets or stop old game workers to apply a UI-only fix.

## Verification

`node --test test/player-poll-service.test.js test/ui/player-poll.test.js`
validates ballot replacement, concurrent writes, restart persistence, input and
origin validation, request limits and the four options. Browser scripts:

- `tools/check-player-poll-preview.mjs`: local UI-only preview.
- `tools/check-player-poll-server.mjs`: real service in temporary storage; tests
  two browser identities, changing a vote, shared counts and retry after failure.
- `tools/check-live-player-poll.mjs`: production read-only acceptance across six
  viewport sizes; explicitly blocks attempts to submit a real ballot.
