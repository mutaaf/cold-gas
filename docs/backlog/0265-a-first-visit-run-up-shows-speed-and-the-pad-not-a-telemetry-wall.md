---
id: 0265
title: A first-ever run-up shows the pad and one number, not four telemetry rows
status: ready
priority: P2
size: S
lens: player-feel
created: 2026-11-16
pr:
by: scout
---

## Why
Played at 390×844 with `coldgas_howto=new`, the run-up (4 s in) shows a four-row readout on the left edge (SPEED,
HEIGHT, G, GAS, plus MORE) over the dark road, a "HOLD TO GO · SKIP" cue and the Hold pad. For someone who has never
flown, HEIGHT, G and GAS are zero or constant during the run-up and compete with the one instruction. Progressive
disclosure (show only what the current step needs, reveal the rest as it becomes relevant) is the standard fix for a
first-run screen (Nielsen Norman Group, https://www.nngroup.com/articles/progressive-disclosure/). The funnel
(2026-11-01…16: 9 new visits, 3 landed, 0 shares) says first runs are where players are lost.

## What
`src/main.js` / `src/styles.css` (HUD only): while this device's `howtoSeen` is false, the run-up shows SPEED only;
HEIGHT, G and GAS appear when the car leaves the ramp (they are live then) and everything stays as today for returning
players. No sim, scorer or layout change for returning players; the MORE toggle still works.

## Acceptance criteria
- [ ] With `coldgas_howto=new` at 390×844, during the run-up only SPEED is visible in the left readout; the other rows
  appear at launch.
- [ ] A returning player's HUD is pixel-identical to today's.
- [ ] `npm run audit` (no overlap) passes at 390×844 and 1280×720.
- [ ] Moves: `run-landed` per `run` for first visits.

## Test plan
E2E (hud spec): `coldgas_howto='new'` run-up asserts only the speed row is visible, then all rows after launch;
a returning context asserts all four from the start.

## Out of scope
Removing rows for returning players; the pad; the how-to card.
