---
id: 0019
title: The Wall starts parked at the foot of the curl and spools up like run 1, not 120 m away
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: critic
---

## Why
Run 1's telemetry (docs/REVEAL_RESEARCH.md §2.1.2, TELEMETRY at 1 Hz) starts with the car **parked
at the base of the ramp, fans idle** (t 5–7 s, 0.6–1.9 kgf, pitch 0.8°), then **fans spooling**
(t 8: 79 kgf), **rolling** (t 9: 186 kgf, 1.5°), and already **on the curl at t 10–11** (279 kgf at
6.6°, 434 kgf at 25.5°). From rest to 25° of pitch took about 3 s. It was "a slow, suction-held
crawl, not a momentum-driven loop" (§2.1.2, climb speed 3.5–4.5 m/s).

The game's Wall starts at `start: { z: -120 }` (`src/sim/courses.js:35`). Measured 2026-10-21 on
the reference (`createAutopilot('wall')`, docs/critique/2026-10-21-0345.md): **20 s of driving at
6.0–6.1 m/s** before the fan arms (127 kgf at 20.0 s) and the ramp begins at 21.0 s; the whole
run is 35.2 s, of which the stunt is the last 14. The fan's spool from rest, which 0012 fitted to
the telemetry (`fanSpool` 1.5 s, `tests/unit/fan.test.js`), can't be seen on the course because
the car arrives rolling with the fan already armed. Anyone who watched the reveal sees the car
start at the foot of the wall; ours starts out of frame.

## What
- `src/sim/courses.js` WALL: start the car at rest a short run-up from the arc (≤ 25 m before
  z = 0; the reveal's was a few metres), fans idle, so the climb starts within ≈ 3–5 s.
- `src/sim/autopilot.js` wall plan: arm the fan at rest, roll at the reveal's crawl, and let the
  spool happen on camera as in run 1.
- `scripts/naive-players.mjs`: keep all 32 strategies. Approach speeds the shorter run-up can't
  reach become "full throttle from rest" (state that in the script), so the grid still covers a
  crawl, a medium and a floored entry. Do not drop strategies to get green.
- `src/render/*` / director: the Wall's start camera frames the car at the foot.
- SIM_VERSION bump (course geometry changes outcomes), CHANGELOG, replay fixtures.

## Acceptance criteria
- [ ] Wall reference: from the run's first tick to 25° of pitch takes 2.5–5 s (run 1: ≈ 3 s from
      fans spooling at rest to 25.5°).
- [ ] Wall reference, fan force against run 1 with t measured from the fan arming at rest:
      ≥ 50 kgf and ≤ 250 kgf at +1 s (telemetry 186 kgf at t 9), 300–600 kgf at 25° pitch
      (telemetry 434), and the existing `tests/unit/fan.test.js` pitch bands still pass.
- [ ] Wall reference: whole run (start → settled) ≤ 22 s (today 35.2 s); still 96 ± 3 and
      release → touchdown 4.0–5.0 s (`tests/unit/gtrace.test.js` unchanged and green).
- [ ] `node scripts/naive-players.mjs` 32/32 with all 32 strategies; `naive-show` ≥ 51/54;
      `human-show.mjs 300 assist --cues=new` ≥ 95 %.
- [ ] The first frame of a Wall run at 1280×720 and 390×844 shows the car and the curl together
      (screenshot).

## Test plan
A unit test in `tests/unit/fan.test.js` (or a new wall-start test) that flies the Wall reference
from its new start and asserts the spool and time-to-25° bands above; replay determinism fixtures
regenerated with the SIM_VERSION bump.

## Out of scope
The lip height (27.7 m, the operator's call, see the critique), the Show and Lineup starts.
