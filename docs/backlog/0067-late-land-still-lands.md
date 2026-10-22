---
id: 0067
title: A player who presses LAND late still lands: the Show's learnability gate back to ≥ 95 %
status: ready
priority: P0
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
AGENTS.md invariant 4 sets the learnability gate: `node scripts/human-show.mjs 300 assist --cues=new`,
players who follow the cue or the HUD land ≥ 95 %. On main it is **189/300 (63 %)**. It is not a recent
regression: a bisect across the physics changes since the gate was written read 53 % (#26 era), 55 %
(Rapier, #33), 62 % (#44) and 63 % now; the gate hasn't held in this history. The failures are one
population: **every player who presses LAND late fails** — "LAND 4" 0/27, "LAND 4 +steer" 0/28,
"LAND 8" 0/17, "LAND 8 +steer" 0/26 — by contact with the row (74) and hard touchdowns > 6 m/s (29),
while LAND on the HUD's cue lands 54–58/62 and with-boost 38/38. The operator asked for driving that is
"easier and more advanced" across all modes (2026-10-21); a beginner who reacts late is exactly who
Assist exists for, and since 0013 the late, hard brake leaves no slack (LESSONS: "A late, hard brake has
no slack").

## What
In Assist only (src/sim/vehicle.js flight computer / src/onethumb.js / the cue timing in src/main.js),
make a late LAND survivable, within the nitrogen budget and the published brake profile where possible:
- the governor plans from the current state when LAND arrives late (a max-effort brake with the carry
  over the row first, then the set-down), instead of the profile it would have flown from 12 m;
- the cue that says LAND arrives early enough for a 0.3–0.4 s reaction (LESSONS: a naive bot is not a person);
- if the physics truly can't save a LAND at 4 m, the HUD and cue must make that impossible to reach
  (e.g. the one-thumb hold auto-arms LAND at the brake line) — say which and why.
SIM_VERSION bump and CHANGELOG note if Assist outcomes change; Pro/Advanced untouched.

## Acceptance criteria
- [ ] `node scripts/human-show.mjs 300 assist --cues=new` ≥ 95 % (≥ 285/300); every LAND population ≥ 80 %
- [ ] `node scripts/naive-players.mjs` 32/32; `node scripts/naive-show.mjs` no worse than today
- [ ] `node scripts/human-phone.mjs` (both schemes) ≥ 95 %
- [ ] The reveal reference (Assist autopilot) still matches its telemetry tests (`npm test`)
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
The gate scripts above (numbers before/after in the PR); a unit test that a LAND pressed at 4 m and at
8 m above the pad, from the reference's release state, touches down < 3 m/s clear of the row.

## Out of scope
Pro and Advanced flight; the Lineup and the Wall (measure them, file separately if they fail similarly).
