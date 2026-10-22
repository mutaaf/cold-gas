---
id: 0036
title: The replay behind the results and the ghost glide instead of stepping
status: ready
priority: P0
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
The replay loop is what players watch while the judges talk. In src/main.js ~620-631 `k = min(1,
replayT - i0)` is computed after `replayT` advanced, against the old `i0`, so at each frame boundary it
clamps to 1: the car stalls then jumps (at 0.45× slow-mo the steps go 0.45, 0.45, 0.1, 0.8). The
attitude isn't interpolated at all (`fquat = f[3..6]`), so the roll steps ~27 times a second. The ghost
uses the integer `run.tick` (~154) and judders against the interpolated car at 120/144 Hz; wheels use
the current tick (~398-401). Flicker probe: show-replay car 2.95 (desktop) / 4.43 (phone) jitter, 32–51‰ pops.

## What
Take `i0` and `k` after advancing; slerp the quaternion as the parked bodies already are (~634-639);
interpolate wheel compression/steer; drive the ghost from the fractional tick.

## Acceptance criteria
- [ ] Drawn car z per frame in the replay has a second difference within 2× the live run's
- [ ] `scripts/flicker.mjs` show-replay and show-replay-rigs car pops ≤ 10‰ desktop and phone
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Unit test for the replay sampler (pure function: frames, t → pose) covering frame boundaries;
flicker.mjs before/after numbers in the PR.

## Out of scope
New replay camera rigs.
