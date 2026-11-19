---
id: 0300
title: The iPhone app is instrumented: signposts in Instruments, a session's performance and feature use in the health batch, read by obs:report
status: shipped
priority: P1
size: M
lens: tech-health
created: 2026-11-18
pr: 443
by: operator
---

## Why
The owner (2026-11-18) wants the features "hardened, observable and instrumented". 0293 made every failure seen. Nothing yet
says how the app *performs* in testers' hands (frame time, hitches, heat, memory, launch) or which of the new features
(the three looks, the driving aids, the handbrake, roams and their challenges, Wreck Club) anyone uses, and nothing marks
the app's flows for Instruments.

## What
- **Signposts** (`Signs`, ios/ColdGas/App/Instruments.swift): `os_signpost` intervals on the Points of Interest lane for
  launch, stage build, run (start → result or home), replay, roam, Free Drive, board fetch and board post.
- **A session's performance summary** (ColdGasClient `Perf`, pure and tested; fed once a frame by `PerfCenter`):
  frame-time p50/p95 and the web's 13-bucket histogram, hitches, cadence (120/60), render scale, the look drawn most, peak
  thermal state, peak memory footprint and launch time, in coarse buckets. Cut on going to the background (or every ten
  minutes from the title or the results) and sent in the existing `/obs` batch from a quiet screen, behind Settings →
  Privacy, never during a countdown, a run or a replay.
- **Feature use**: which new features a session touched, as flags, in the same batch and behind the same switch.
- **`npm run obs:report`**: a performance table per iPhone build, the features used, and the newest TestFlight build
  against the one before it (exit 1 when it's slower or hotter).
- **Docs**: docs/AUDIT-2026-11-18.md "Instrumented (0300)" and backend proposal B4; ios/store/app-privacy.md and the
  privacy policy say what the summary carries (no new App Privacy row).

The Worker is frozen: the summary uses `cleanObs`'s existing shape (a histogram in `fr` and two rows with frames
`perf@<build>` and `use@<build>`). B4 is the proposal to give it its own field.

## Acceptance criteria
- [x] The meter takes the web's buckets and percentiles (values from Node), drops NaN, infinity, negative and away
      intervals, is bounded, and needs 1,200 frames for a summary (ColdGasClientTests/PerfTests)
- [x] The summary's words survive the Worker's normalisation, and a batch carrying it passes `cleanObs` with its rows and
      histogram kept and nothing about the device (tests/fixtures/obs-ios-session.json, written by the Swift test, read by
      tests/unit/obs-native.test.js)
- [x] A queue saved before this change still reads (its faults aren't lost on the update)
- [x] `obs:report` reads the rows into a table per build, never alerts on them as faults, and compares the newest build
      with the one before (tests/unit/obs-report.test.js)
- [x] On the simulator a session's summary is cut on going to the background, logged under `com.mutaafaziz.coldgas:perf`,
      and leaves the queue in the next batch (`-obs-dry`)
- [x] No sim or scorer change: `npm test` and `make test` (52 run vectors) pass

## Test plan
- `cd ios && make test` (PerfTests, ObsTests, the vectors); `npm test` (obs-native, obs-report, privacy).
- Simulator (the shared "ColdGas iPhone", `-mute -play -autopilot -obs-dry`): fly a run, send the app to the background,
  then `log show --predicate 'subsystem == "com.mutaafaziz.coldgas"'` shows the `perf` line and the queue is empty after.
- Instruments → Points of Interest on a simulator run shows `launch`, `stage`, `run` and `replay` intervals.
- `npm run obs:report` against production prints the three new blocks ("none yet" until a 1.2.0 build sends).
