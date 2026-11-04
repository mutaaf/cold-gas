---
id: 0145
title: The car hangs still under the ledge as long as the real one did, and a hang is never a crash or a 26 m fall
status: shipped
priority: P0
size: M
lens: authenticity
created: 2026-11-04
pr:
by: critic
---

## Why
The reveal's signature moment is the hang. On the official telemetry the car stopped under the ledge and
**hung inverted, still, for about 10 s** (`docs/REVEAL_RESEARCH.md` §2.1, rows 24–30: pitch 170°, 67–69 ft,
TELEMETRY). The maker's claim is "enough suction to hold the vehicle upside down, even when stationary"
(same section, Car and Driver). In the game, a car that sits still on the deck for 6 s ends the run
(`src/sim/run.js:323` `offTicks`, `:335` `end = 'stalled'`). The sim then treats that like a crash: the
aftermath cuts the fan as if a crash sensor fired (`src/sim/run.js:362`), and the car drops 26 m off the ledge.

- **Production, 390×844 touch, first visit, one thumb** (critique 2026-11-04 16:03): a newcomer does what the
  title said ("hold to climb") and keeps the thumb down on the ledge. The car stops there, held by the fan.
  The HUD then turns red with **"07 CRASH"** while the car hangs perfectly still at 87.0 ft, 1 mph, 0.9 g
  (`docs/critique/2026-11-04-1603/phone-hold-hang-crash.jpg`). Next it falls to the floor, and the sheet says
  **"Stalled on the wall · 22.0"**, "You hung 11.1 s inverted but never released"
  (`phone-hold-sheet.jpg`).
- **Node, the one-thumb Show as `tests/unit/thumb-lift.test.js` flies it**, with the thumb held on the ledge
  for W seconds after the car stops, then lifted for 0.3 s and tapped:

  | W | result |
  |---|---|
  | 0 / 2 / 5 / 5.42 s | Stuck it 85.7–86 |
  | 5.75 s | **Stalled on the wall 22** |
  | 6 s / never lifted | **Stalled on the wall 22** |

  A third of a second of extra hang costs 64 points. The real car hung almost twice as long.
- **This is the funnel's first-run problem.** The PLAYERS focus puts first runs first, and a newcomer who
  hesitates on the scariest frame of the stunt gets a crash, a fall and a 22. The stall rule exists to end a
  car that gave up low on the curl, not a car doing the reveal's own move.

## What
- In `src/sim/run.js`, don't count a hang as a stall. A car on the deck at the ledge (`t.progress ≥ 0.92`,
  the one-thumb `tapAt`), on its tyres, with the fan holding it, may stay there **at least 20 s**: twice the
  telemetry's ≈10 s. Past that, or below the ledge, `stalled` keeps its 6 s.
  - Pick the cap and comment it in `spec.js`/`run.js` with the source (rows 24–30, TELEMETRY).
  - It must still sit inside `MAX_TICKS` (90 s).
- A `stalled` end is not a crash.
  - The aftermath for `stalled` keeps the fan on and brakes, so the car stays where it stopped. It doesn't
    drop 26 m.
  - `crashStep` (`src/ui.js:23`) doesn't say "Crash" for it. Show "Stalled" or "Never let go", the coach's
    word.
  - The HUD's timeline doesn't go red with `07 CRASH` while the car is still on its tyres.
- This changes outcomes, so it's a sim change: bump `SIM_VERSION` and re-run the gates (AGENTS.md §3.4). The
  reference runs don't stall, so their hashes should not move.

## Acceptance criteria
- [ ] A unit test flies the one-thumb Show and holds the thumb on the ledge for 6, 10, 15 and 19 s after the
      car stops, then taps. Every flight lands. None ends `stalled`, and the scores are within 1.0 of the 0 s
      hold.
- [ ] The same test, held forever: the run ends `stalled` after **≥ 20 s** stationary on the ledge, never
      sooner, and `facts.crashed` doesn't make the HUD or `crashStep` say "Crash".
- [ ] A car stopped low on the curl (progress < 0.92) still ends `stalled` at 6 s, as today.
- [ ] After a `stalled` end, the aftermath leaves the car within 0.5 m of where it stopped (no fall). Test it
      in Node with `aftermathStep`.
- [ ] `node scripts/ref-hash.mjs` gives show `fedae05c`, wall `bacb4720` and lineup `8b2c2c9a` unchanged, or a
      bump with `naive-players` 32/32 and `naive-show` 54/54. `node scripts/human-phone.mjs 150 --scheme=thumb
      --skill=careful --daily` stays 150/150 clean with median ≥ 92.7. `npm run determinism` is IDENTICAL.
- [ ] 390×844 touch on production after deploy, first visit (`coldgas_howto = 'new'`): hold the pad the whole
      way and stay on the ledge for 10 s. The HUD never says CRASH and the car is still under the ledge
      (screenshot). Then a tap flies the stunt and the sheet scores it.

## Test plan
- Unit: a new `tests/unit/ledge-hang.test.js`, in Node, with the one-thumb harness from `thumb-lift.test.js`.
  No new e2e boot.

## Out of scope
- The ledge's cue and the pad's "TAP · LET GO" copy, and a nudge on the ledge (0144 is the run-up's).
- The Wall's own scoring of the hang time (`invertedS`).
