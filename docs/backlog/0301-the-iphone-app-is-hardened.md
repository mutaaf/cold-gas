---
id: 0301
title: The iPhone app is hardened (and smoke- and soak-tested): bad settings repaired, NaN kept out of the drive and the frame clock, growing lists bounded, interruptions, turns and memory warnings survived
status: shipped
priority: P1
size: M
lens: tech-health
created: 2026-11-18
pr: 451
by: operator
---

## Why
The owner (2026-11-18) wants the features "hardened, observable and instrumented". 0293's audit covered failures that are
reported. This pass covers the inputs from outside the sim that weren't checked at all, and the moments a phone imposes:
- a stored setting this build doesn't know
- a sensor's NaN
- a frame clock that jumped
- a drive that never ends
- a call's banner
- the background
- a turn
- a memory warning

## What
- **Settings:** `Prefs.repair()` at launch puts `cg.look`, `cg.course`, `cg.tier` and `cg.control` back to their defaults when
  they hold a value this build doesn't know or the wrong type, before anything reads them, and reports each once. `Game`
  also checks a launch flag's course and tier.
- **NaN/inf:**
  - The frame's time step and the slow motion are guarded at `Game.frame`. An `Int(t * hz)` of a NaN traps, and a NaN
    `dt` reached the replay's and the encore's index.
  - The drive's input is made finite before the engine (`guardInput`, ColdGasPhysics), and reported once.
  - The tilt ignores a non-finite attitude.
- **Bounds:**
  - A drive's impact list is capped (4,096 → 2,048), and its readers follow: Game by count, CrashFX by tick.
  - The drive track's parked-body poses are trimmed to the newest ticks. They were trimmed by the current body count, which
    misaligns and grows when a set gains or loses a body.
- **Interruptions:** a call's banner, or going to the background mid-roam, used to leave the drive's pedals and stick held.
  They're now let go, as a run's are.
- **Rotation:** the tilt re-centres when the screen turns mid-run, instead of jumping on the other axis.
- **Low memory:** a memory warning drops the title's other flights as well as the idle renderers (0293).
- **Missing resources:** a missing reference run is reported. The stage, props, notes and fonts already fell back (0293).
- **Stage meshes** (every vehicle and set, the new meshes included):
  - an empty or truncated `.bin` is skipped, not a `baseAddress!` trap or a read past its end;
  - a submesh naming indices past its buffer is refused;
  - short JSON arrays fall back to their defaults;
  - the parked cars' paints follow the meshes that loaded.
- **The smoke and the soak:**
  - ColdGasUITests/SmokeUITests runs launch → a run on each course → results → Roam → Free Drive → every look and
    driving option in Settings → back, reading "faults 0" at each stop.
  - `ios/scripts/soak.sh` (DEBUG `-soak <minutes>`, ColdGas/Debug/Soak.swift) loops runs, replays, roams, Free Drive and
    looks for ten minutes on the simulator. `scripts/soak-check.mjs` then fails it on memory that keeps growing or on any
    fault.

## Acceptance criteria
- [x] Pure guards with tests (ColdGasClientTests/GuardsTests):
  - a stored choice is one of its values or the default
  - a stored number is finite and in range
  - a step and a rate are always usable
  - a growing list is trimmed and its cursors follow, bounded over a million appends
- [x] `guardInput` leaves a finite input bit for bit, lets a non-finite control go, and a drive fed NaN for two seconds
      stays finite (ColdGasPhysicsTests/InputGuardTests)
- [x] UI tests (ColdGasUITests/HardeningUITests, `-uitest`'s health probe):
  - corrupt settings are repaired and reported exactly once each, and the repair sticks
  - an interruption mid-run
  - a memory warning mid-run
  - rotation mid-run
  - the background mid-run and mid-replay
  - a roam with an interruption and two seconds of NaN input

  Each one finishes with no other fault.
- [x] The smoke passes with no fault, and a ten-minute soak passes `soak-check` (memory settles, no fault); the rule is
      unit-tested (tests/unit/soak-check.test.js)
- [x] No sim or scorer change: `npm test` and `make test` (52 run vectors) pass

## Test plan
- `cd ios && make test` (GuardsTests, InputGuardTests, the vectors).
- On the shared "ColdGas iPhone" simulator (lock held, the app copied to scratch, `-mute`):
  `xcodebuild test-without-building … -only-testing:ColdGasUITests/HardeningUITests`.
- `xcodebuild test-without-building … -only-testing:ColdGasUITests/SmokeUITests`; `cd ios && scripts/soak.sh` (10 min).
- `npm test`.
