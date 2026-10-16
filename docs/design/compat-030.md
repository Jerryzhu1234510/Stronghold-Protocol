# DESIGN §34 — 8443 local compatibility rules for 0.3.0

Part of [DESIGN.md](../DESIGN.md). This section belongs to the local fork.

## 34. Local 8443 compatibility decisions

This addendum applies to the local compatibility candidate only. Official 0.3.0 wins on overlapping features unless the maintainer explicitly retained a difference. It does not authorize a production deployment or network gameplay Mod installation.

- Keep the old extra operators: Sakiko `char_4182_oblvns`, Makoto `char_4217_makoto`, and shop-form Clementia `chess_char_4_27_a/b`. The official Clementia kit implements the old shop form too. The retained strategy adds layers to active bonds for every three allied kills (two when elite), only while its carrier is deployed, and excludes union defense. Existing official data records are not overwritten by the compatibility overlay; its roster and member unions are explicit additions. Makoto retains the old Laterano membership as a custom exception.
- On `act2autochess_m04`, ground Boss/Hidden Core leaders cross the upper passage in both directions. Preserve waits/teleports and the patrol sequence; close the patrol at its first movement checkpoint and skip the terminal goal sentinel. Other stages and flying units retain their routes.
- Retain 4–8 player rooms, clone, private card pools, optional HP multipliers, no Boss damage cap and the two Duck tiers. Defaults remain official. Normal 4–8 player Ultimate clears give 8 cups; HP-only increases keep 8; clone/private pool/no-cap/Duck reduce once to 4; training and PvP do not award cups.
- Use official resource import and content identity. PC reads its checked resource archive; the web reuses old content-hash caches. The 8443 policy does not start a bulk preload. Missing local files are reported for completion.
- Keep controlled PC music, art replacement and unit motion Mods. The local launcher turns off server plugins, studio and plugin scripts; this is a test policy, not removal of the official framework.

Implementation and verification: [local compatibility report](../COMPATIBILITY-030-LOCAL.md), [intentional golden changes](../history/0.3.0-compat-goldens.md).
