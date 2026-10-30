---
id: 0114
title: The obs beacon reports input-to-frame latency per device class
status: proposed
priority: P2
size: M
lens: performance
created: 2026-10-29
pr:
by: scout
---

## Why
The lockdown asks for input that is first-class on every device, but nothing measures how long a tap or key takes to
reach a drawn frame, and INP does not see it: it observes only clicks, taps and keys, and not held controls, drags
or gamepads, so a game needs its own `pointerdown`-to-next-frame timing
(https://web.dev/articles/inp). A phone that holds 60 fps can still answer a thumb 100 ms late if a long task sits
before the sim step. `src/obs/frames.js` already keeps frame histograms per device class and tier; this adds one
more histogram of the same shape, so a regression shows up in `/obs/digest` like any other.

## What
- `src/obs/index.js`: on `pointerdown`/`keydown` in a live run, stamp `performance.now()` in a preallocated
  field; in the frame loop's first render after it, record the delta into a fixed-size histogram (buckets 16, 33,
  50, 100, 200 ms+), then clear the stamp. No allocation, no new event listener per frame.
- Send it in the existing beacon as an `obs_evt` counter set (no worker change; if the beacon needs a new field
  that is a frozen-path change, so use existing counter names, e.g. `lat_<bucket>`), only for runs, never the title.

## Acceptance criteria
- [ ] `npm run obs:bench` allocation stays 0 B/frame and its per-frame cost within the existing budget.
- [ ] A unit test feeds synthetic stamps and asserts bucket counts and that a stamp is consumed once.
- [ ] No new host, no stored identifiers; beacon size stays under 8 kB.
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse.

## Test plan
Vitest for the histogram and stamping logic; an e2e that presses a key in a live run and reads the counter.

## Out of scope
Fixing any latency it finds; gamepad polling latency; Worker or digest changes.
