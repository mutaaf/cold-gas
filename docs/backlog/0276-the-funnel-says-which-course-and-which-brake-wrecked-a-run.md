---
id: 0276
title: The funnel says which course a run was on and which braking mistake wrecked it
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-18
pr:
by: critic
---

## Why
On 2026-11-18 production had its first real day: 11 human sessions, 20 runs, **4 landed, 9 wrecked, 7 quit** before
the card. The brake was the coach's first finding on **5 of the 9** wrecks (`wreck-brake`). The gates say Assist
lands 95–100 %, so the gap is the most important number in the game right now. But the funnel can't say where it is:
- `wreck-brake` folds three different mistakes into one: `no-brake`, `late-brake` and `late-land`
  (src/obs/signature.js `WRECK_OF`). Each one has a different fix (the guide, auto-land's timing, the HUD).
- No run event carries its course, so a Show wreck, a Wall wreck and a Lineup wreck look the same, and 5 of today's
  runs were on the Daily (`daily-miss` 5).

Every agent is told to steer by this funnel (control.json focus), and today it can't tell the Builder which fix to ship.

## What
- `src/obs/signature.js`: `WRECK_OF` keeps the coach's own id for the three brake findings: `wreck-no-brake`,
  `wreck-late-brake` and `wreck-late-land` (new PLAY_EVENTS). `wreck-brake` stays counted beside them for one
  release, as `daily-run` did (0136).
- `src/obs/run-end.js`: on a decided card, also count `on-show|on-wall|on-lineup` and `landed-<course>` /
  `wrecked-<course>`. That's six counts, numbers only, and nothing about the player.
- The Worker already accepts any name in `PLAY_EVENTS` (src/worker/obs.js:38 imports it), so `src/worker/`
  (frozen) does not change.

## Acceptance criteria
- [ ] A wreck whose coach's first finding is `late-land` counts `wreck-late-land` and `wreck-brake` (unit test on
      `wreckCause`).
- [ ] A landed Show run counts `on-show` and `landed-show`, and a wrecked Wall run counts `on-wall` and
      `wrecked-wall`, once per run (unit test on run-end).
- [ ] `/api/obs` accepts the new names: `cleanObs` keeps them (unit test against src/worker/obs.js, read-only).
- [ ] The beacon is still ≤ 8 kB, with no id, initials or host (tests/unit/obs*.test.js).
- [ ] The PR says which number it moves: none directly. It makes `wreck-brake` 5/9 actionable.

## Test plan
Unit tests in tests/unit (signature, run-end, the Worker's cleanObs) as above. No e2e needed.

## Out of scope
Per-player data, any free text, the sink value itself, and dashboards.
