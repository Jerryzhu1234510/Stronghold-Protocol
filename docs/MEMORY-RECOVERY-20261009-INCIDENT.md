# 2026-10-09 r19 incident and recovery

At approximately 21:36:36 Asia/Shanghai, an online CPU sampling script attempted a dynamic import through Inspector Runtime.evaluate during cleanup. The rejected import was not handled and Node v22.23.3 exited with ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING. This was caused by the diagnostic operation, not normal game traffic. The script work/profile-current-lag.py is now disabled.

r19 rooms, matches, and reconnect sessions were stored only in that worker's memory. No match checkpoints were present. The exited matches cannot be recovered. r18's original worker was preserved.

At 21:41:41, service was restored using the same r19 release files and the same public generation f98635fe1af8-10, in a separate recovery gateway. No player-facing release changes were made. Live HTTPS verification passed: create a private solo room, start match, disconnect, resume with token, retain identity/room, accept game action, leave test room.

## Superseded 21:41 recovery routing

- New/current r19 container: stronghold-hot-r19-recovery.
- Its host gateway is 127.0.0.1:14518; internal port remains 14517.
- Its entry mount: /home/ubuntu/stronghold-hot/recovery-20261009/entry.
- Its state mount: /home/ubuntu/stronghold-hot/recovery-20261009/state.
- Recovery gateway initial serial is 9, so the r19 initial generation remains f98635fe1af8-10.
- Release files remain /home/ubuntu/stronghold-hot/releases/r19, mounted read-only.
- Caddy's general reverse proxy now targets 127.0.0.1:14518.
- Caddy explicitly routes /_build/f1f917eba035-9/* to the original 127.0.0.1:14517 to preserve r18 games.
- Original container stronghold-hot remains alive for r18. Its active r19 entry is unhealthy; do not confuse its status with the recovered current service.
- Existing loading-r19 and R2 manifest paths are unchanged. Caddy reload keeps stream_close_delay 6h.
- Caddy backup: /home/ubuntu/stronghold-hot/recovery-20261009/Caddyfile.before.
- Recovery JSON and CPU sample evidence: outputs/lag-function-profile.

Do not run previous deployment scripts unchanged: they assume the primary gateway is port 14517 and container stronghold-hot. Future deploys must first read both gateway statuses and preserve both current workers. Do not restart/retire the old container without auditing r18 players.

All further CPU profiling must occur on an isolated clone. Do not send Inspector signals to live game workers.

## 22:34 simulation stall and current production routing

The recovered r19 worker later stopped responding while remaining alive. The isolated worker's paused stack showed repeating Skadi S1 damage transfer and tier-2 坚守 transfer callbacks, including damage below 1e-16. A depth cap still allowed exponentially many sibling callbacks. The real content scenario reproduces this with two S1 Skadis, 坚守 members, and another allied victim.

At 22:38 service was recovered in `stronghold-hot-r19-stall-recovery`, host loopback port 14519 (internal 14517). Its entry and state are `/home/ubuntu/stronghold-hot/recovery-stall-20261009/{entry,state}`. Caddy's default proxy is now 14519. The former `stronghold-hot-r19-recovery` container is network-isolated and paused for evidence; do not unpause it or reconnect it to production. The original `stronghold-hot` still holds r18 on port 14517, with an explicit Caddy route for `/_build/f1f917eba035-9/*`.

Fix: transferred damage is tagged `transfer` and neither redirect transfers it again. Hook guards stop the complete outer chain on depth/work limits, then reset for independent callbacks. Real normal/elite Skadi scenarios and runaway hook scenarios pass. Root-cause and recovery evidence is under `outputs/incident-20261009-stall`.

Additional repairs prepared for r20: final 联防 progress without a result triggers deterministic server takeover after 3 seconds; cosmetic damage-report failures cannot prevent result upload; repeated deployment-skill 突袭 respects its 3-second cooldown; deployment sends facing to the view; slowed bounty enemies turn; failed transient data loads can recover in the background. Brightness protection limits repeated additive explosions and global pulses without changing simulation damage or telegraph duration.

The reported white-screen roster and 澪 (`enemy_10118_ymgprc`) were replayed in headless Edge. The roster, 澪 attacks, every 澪 animation, and clipping on/off were tested; the reported full white screen has not yet been reproduced. Brightness protection is mitigation, not a verified fix for that particular incident.

## r20 published 2026-10-10

Generation `67c6f52a2530-11` is now current on the 14519 gateway; state/current points to `/releases/r20`. r19 (`f98635fe1af8-10`) remains draining on the same gateway, and r18 remains preserved separately on 14517. No old worker was restarted or retired. During activation r19 online-in-match count stayed at 240. A test match created before activation retained room and player identity on reconnect and accepted a subsequent game action.

Local regression passed 237 tests, followed by 15 targeted animation/cooldown/guard checks. The staged release passed 8 isolated regression checks. Public HTTPS serves the exact patched frontend and simulation sources. Live headless Edge loaded the lobby and new release notice without page errors. 澪's atlas, skeleton and texture fetched through the service worker from R2 match the manifest's SHA-256 and lengths.

An additional clipping guard reasserts the mask state after animation updates and keeps released clipping polygons non-renderable, including slots created after quality-mode changes. Its fault-injection regression failed before the guard and passes after it. This protects a possible white-geometry mechanism; the reported 澪 incident remains unconfirmed. Deployment and live verification evidence: `outputs/incident-20261009-stall/r20-deploy`.

## Memory cleanup authorized 2026-10-10

The user explicitly authorized clearing the frozen incident copy and the obsolete r18 service. Immediately before retirement, r18 had zero online humans, zero online matches, and 16 offline matches. The isolated, paused `stronghold-hot-r19-recovery` and the original `stronghold-hot` were stopped, and both restart policies were changed to `no`. Their processes now have PID 0; they must not be restarted into production. The frozen in-memory state and r18 reconnect state were discarded. Container logs and release files remain available as disk evidence.

The r18 entry now redirects to `/`; its explicit 14517 live proxy was removed from Caddy. Caddy was validated and reloaded with the existing six-hour stream-close delay. No current game worker was restarted. The r19 and r20 gateway/worker PIDs remained unchanged, both version health checks and public HTTPS health passed, and only `stronghold-hot-r19-stall-recovery` plus `stronghold-https` remain running as game infrastructure. The current gateway remains on host loopback port 14519, with internal port 14517. Host port 14517 and the frozen recovery host port 14518 are no longer production services.

Available memory increased from approximately 1.23 GB to 2.14 GB; measured system utilization fell from approximately 68% to 45%. Evidence, before/after metrics, saved logs, and Caddy configurations are under `outputs/memory-20261010/cleanup`. The remote Caddy backup is `/home/ubuntu/stronghold-https/Caddyfile.before-memory-cleanup-20261010`.
