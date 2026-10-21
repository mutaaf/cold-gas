---
id: 0022
title: The reference flight's phase timeline advances past HANG, and ROLL reads attitude
status: ready
priority: P1
size: S
lens: authenticity
created: 2026-10-21
pr:
by: critic
---

## Why
"Watch the reveal" (`startRun('reveal')`) is the flight people watch to learn what the real car did.
Its HUD lies twice (production, 2026-10-21, docs/critique/2026-10-21-0945/):

1. **The timeline sticks on 03 HANG** through the release, the carry over the row and the brake,
   then jumps to 07 TOUCHDOWN (`desk-5-over-row.jpg` at T+12.5 s, 6.2 m, 11.7 m/s sink, and
   `phone-5-over-row.jpg`, `phone-6-rollout.jpg`). Cause: `flightPhase` (`src/main.js:445`) waits for
   `S.released`, which only `wallAssist` sets (`src/main.js:307`), and the autopilot path
   (`src/main.js:357`) never calls `wallAssist`.
2. **The ROLL dial reads 177° with the car on its wheels** (`desk-7-touchdown.jpg`, ATT "0° 0°" in
   the same frame), and 0° while the car hangs upside down on the ledge (`desk-3-inverted.jpg`). It
   is the accumulated roll (`run.t.rollAccum`), labelled as if it were attitude, next to an attitude
   ball. On the same screen over the row, ATT says R16° and the dial says ROLL 192°
   (`phone-5-over-row.jpg`).

## What
- `src/main.js`: set `S.released`/`S.releaseTick` from the run itself (the first `air` tick, or the
  ramp tick with lift, for any input source), so the reference, replays and players share one rule.
- `src/ui.js` / `index.html`: label the accumulated figure as what it is (e.g. "ROLLED 177°") or
  show the bank angle under the dial; one roll number per meaning on screen.

## Acceptance criteria
- [ ] e2e: during the Show reference, the timeline's active phase is RELEASE within 0.6 s after
      the first `air` tick, CARRY or BRAKE while `phase === 'air'` afterwards, never HANG.
- [ ] e2e: at the reference touchdown, no element labelled ROLL reads more than 5° while the car
      is upright on its wheels (or the label says it is accumulated).
- [ ] Player runs unchanged: the Show reference fast-forwarded by a player log still advances
      the timeline as before.
- [ ] 390×844 and 1280×720 screenshots in the PR.

## Test plan
An e2e on the reveal run that samples the timeline's active `data-ph` at the release, over the row
and at touchdown, and reads the ROLL text at touchdown.

## Out of scope
The livestream telemetry block itself (0018: pitch 0–180°, N₂ kg and bar, G window).
