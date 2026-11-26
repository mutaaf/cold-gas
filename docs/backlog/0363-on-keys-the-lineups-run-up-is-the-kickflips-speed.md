---
id: 0363
title: On keys and a pad, a held ↑ runs up to the Lineup at the kickflip's speed, not 32 m/s into the row
status: shipped
priority: P1
size: S
lens: authenticity
created: 2026-11-23
pr: 524
by: critic
---

## Why
The reveal's kickflip came in "at normal speed" down a guide line. The research puts it at about **7–9 m/s**
horizontally, with an airborne distance of about 20–25 m (docs/REVEAL_RESEARCH.md §2.2 "Approach" and "Distance";
row 48: 8 m/s, range 6–10, ESTIMATE). The car lifted off just short of the first vehicle.

A keyboard player on the Lineup is told "Hold ↑ to go" (`src/guide.js:25`), then "Space at the line" (shown from
z −14, `src/main.js:1527`). Assist doesn't limit the run-up. From the start at z −70, a held ↑ reaches **29.8 m/s at
z −14 and 32.3 m/s at z −4**. That is 4× the reveal's speed. The line is 7 m short of the Cybercab, so the car is in
the row about 0.2 s after the press, before the jets can lift it. The critic's sweep
(`docs/critique/2026-11-23-2136/lineup-floored.mjs.txt` → `lineup-floored.txt`) holds ↑ to the press, then Space for
0.3–0.8 s, ← 0.8 s, then Shift:
- **Space at z −7…0 (at or near the line, as cued): 0 of 16 land.** All hit the row ("Wrecked" or "No jump" 4.0, end
  `contact`).
- **3 of 24** across every press from z −14 land at all, and those are pressed 10–14 m early with a 0.4–0.6 s hold.
- At 7.5 m/s the same presses and holds clear the row (`lineup-lift-sweep.txt`).

So the guide's literal instructions, followed exactly, wreck every time. On 11-23, 3 of 5 human Lineup runs wrecked,
all on keys (`/coldgas/api/obs/digest`, `wrecked-lineup` 3 / `on-lineup` 5, `wreck-other` 3). This and 0362 are the
two ways a keyboard player can do that.

Players: operator focus (1), the first run on an event. Number to move: `wrecked-lineup / on-lineup`.

## What
In Assist (not Pro), on the Lineup's run-up, a held ↑ (or RT, or the touch GO) eases off at the kickflip's run-up
speed (`REVEAL.lineup.speed` 7.5 m/s, `src/sim/autopilot.js:23`, already the reference's and one thumb's), like a
cruise limit. Releasing it and pressing again behaves the same. Pro keeps the full throttle. The HUD can show the
run-up speed against the kickflip's band.
- `src/sim/vehicle.js` or `src/sim/run.js`: an Assist run-up limit on the Lineup's `drive` phase before the line.
- This is a sim change, so bump the run version, regenerate the vectors and explain any ref-hash change. The Lineup
  reference drives at 7.5 m/s already and should be unchanged.

## Acceptance criteria
- [x] Sim, Assist, Lineup: ↑ held from the start reaches the line (z 0) at **7–9 m/s** (§2.2). Today it reaches 33.2.
      (8.0 m/s at z −14, −4 and 0: tests/unit/lineup-runup.test.js.)
- [x] With ↑ held to the press, Space at z −6…+1 held 0.4 s, ← 0.8 s, then Shift, **every** press clears the row and lands
      upright, unwrecked. Today 0 of 16 at z −7…0. (8 of 8 at z −6…+1, none touching the row.)
- [x] Pro: ↑ held still reaches > 25 m/s at the line (a unit test pins it).
- [x] The Lineup reference score is unchanged or explained. `naive-players` stays 32/32 and `naive-show` 54/54.
      (ref-hash bit-identical: the reference holds 7.5 m/s itself and the fade starts above it; physics-bench identical.)
- [x] 390×844 touch (the page's GO button) and 1440×900 keys both get the limit.

## Test plan
Add a unit test that drives `createRun('lineup')` with `assist: 1`, throttle 1 from the start, and asserts the speed at
z 0, plus the press grid above. Extend 0362's `scripts/naive-lineup.mjs` gate with a held-↑ run-up.

## Out of scope
- The held LIFT's height (0362).
- The Show's and the Wall's run-ups (they have ramps and their own speeds).
