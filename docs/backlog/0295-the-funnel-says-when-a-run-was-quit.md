---
id: 0295
title: The funnel says in which phase a run was quit: before the first hold, on the climb, or in the air
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-19
pr:
by: scout
---

## Why
2026-11-18, `human` sessions: 23 runs, **7 `run-quit`**, 30 % of runs, more than the 6 that landed. `run-quit`
(src/obs/run-end.js) means a Jump run left before its card (Pause → Home or Restart, a drill opened mid-run, the page
closed), and says nothing about *when*. The three candidate causes have three different fixes: a newcomer who never
found "hold to go" on the run-up (the readout wall, 0265 / 0272), a player who restarted after a bad climb (the
Retry path), or one who left in the air (the brake HUD, 0276's wreck-brake family). Played at 390×844 with
`coldgas_howto=new` this run, the run-up sits at SPEED 0 under "HOLD TO GO · SKIP" until the thumb goes down, so a
visitor who looks and leaves there is plausible, and is today indistinguishable from a quit at 20 m. The control
file says to steer by the funnel; this makes the biggest bar in it legible. Depends on nothing; touches the same
file as 0276, so build after it (or rebase).

## What
- `src/obs/run-end.js` (and the `disposeRun` path that calls it): on `run-quit`, also count exactly one of
  `quit-runup` (no launch yet: the car never left the ramp), `quit-climb` (launched, still on the climb or the
  Wall's curl), `quit-air` (released and not yet landed). Phase comes from the run's own state (tick vs. the launch
  tick, `run.launched` or the existing phase field the HUD's "01 RUN-UP" label reads), never from a clock.
- Add the three names to `PLAY_EVENTS` (`src/obs/signature.js`); the Worker accepts any name in that list
  (src/worker/obs.js imports it). If it does not, drop the counters and note it. Numbers only.
- `run-quit` itself stays, counted as today.

## Acceptance criteria
- [ ] Home or Restart pressed during the run-up counts `run-quit` and `quit-runup`, and no other phase name.
- [ ] The same press after launch on the climb counts `quit-climb`; in the air, `quit-air`; a page close mid-run counts its phase once.
- [ ] A run that reaches its card counts no quit name; once per run.
- [ ] No behaviour change for the player; works at 390×844 touch and 1280×720 keys.

## Test plan
Unit on the phase function over a run at tick 0, mid-climb, and post-release. e2e: start a run, press Home at
three moments (`__coldgas.skipCountdown()`, then `liveStep` to each phase), read the counts from the obs buffer.

## Out of scope
Why they quit (that is the next ticket once the phase is known); any change to Pause, Home or Restart.
