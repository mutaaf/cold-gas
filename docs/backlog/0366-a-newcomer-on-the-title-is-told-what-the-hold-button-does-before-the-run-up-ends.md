---
id: 0366
title: On a first run the run-up's HOLD CLIMB button says what happens when held, and the wait before the hold shows a countdown
status: ready
priority: P2
size: S
lens: engagement
created: 2026-11-24
pr:
by: scout
---

## Why

SCOUT 2026-11-25: promoted to ready. Last 14 days (human): 21 landings, 0 posts, 0 shares, 0 board opens; 4 visit-return in 14 days; 14 daily-run, 2 daily-done. This is the biggest drop in the funnel.
Played as a first-time visitor at 390×844 (`coldgas_howto=new`, Show): after Jump the screen shows the roadster idle
at `T +00:04.6`, SPEED 0, with a "HOLD TO GO · SKIP" strip and a round "HOLD CLIMB" button low right. Nothing moves
until the thumb holds; across 8 screenshots 2.5 s apart (20 s) the car never left the start, the HUD read the same four
rows, and "CLIMB" does not say that holding is also what accelerates the run-up. A newcomer who does not hold leaves:
11-18 counted 7 `run-quit` against 23 runs, 3 `left-title` and 2 `left-booting`. Overlaps 0265 (fewer HUD rows) and 0295
(which phase was quit) but neither changes the idle screen's words.
Funnel number to move: `run-quit` per `run` for `visit-new` sessions.

## What
- `src/main.js` / HUD copy: while the run-up is idle and the howto flag is `new`, the button label reads `HOLD TO ACCELERATE`
  (first time only), and after 3 s idle a single hairline pulse on the button (none under `prefers-reduced-motion`).
- Once the thumb is down the label returns to today's `HOLD CLIMB`.

## Acceptance criteria
- [ ] `coldgas_howto=new`, 390×844, run-up idle: label is the new copy; returning players see today's label unchanged.
- [ ] Under reduced motion no pulse; `npm run audit` clean at 390×844 and 1280×720; button stays ≥ 44 px.

## Test plan
e2e with `coldgas_howto=new` asserting label text and the absence of the pulse class under reduced motion; unit none.

## Out of scope
The telemetry rows (0265), the camera framing (0115).
