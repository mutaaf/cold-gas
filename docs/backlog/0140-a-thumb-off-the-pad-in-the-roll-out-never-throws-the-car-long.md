---
id: 0140
title: On one thumb, a thumb off the pad during the roll-out never throws the car 20 m past the mark
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-03
pr:
by: critic
---

## Why
Most players fly the Show on one thumb. 0139 now tells them to "hold the pad from the tap to the ground". A
person who does that and flinches off the pad for a moment during the roll (the scariest second of the
stunt, inverted and falling) is punished far out of proportion to what they did, and the touchdown stops
being something they can learn.

- **The sweep** (critique 2026-11-03 16:30; the one-thumb Show flown in Node with `src/onethumb.js`, the code
  the page runs, as `tests/unit/thumb-gas.test.js` flies it: hold up the curl, tap on the ledge, keep holding,
  lift the thumb N ticks after the tap and never press again):

  | thumb lifted after the tap | touchdown from the mark | over the roofs | verdict / score |
  |---|---|---|---|
  | 0.1–0.7 s (24–168 ticks) | 6.6 m | 1.3 m | Clean 80.7 |
  | 0.8 s (192) | 8.4 m | 2.2 m | Clean 76.0 |
  | 0.9 s (216) | 11.8 m | 5.2 m | Rough landing 70.7 |
  | 1.0 s (240) | 16.1 m | 10.2 m | Rough landing 67.3 |
  | 1.15 s (276) | 19.8 m | 15.8 m | Rough landing 64.3 |
  | 1.25 s (300) | **21.1 m** | **17.1 m** | Rough landing 65.3 |
  | 1.5 s (360) | 7.5 m | 5.6 m | Clean 78.3 |
  | never (held to the ground) | 6.0 m | 4.5 m | Stuck it 85.7 |

  A quarter of a second in when the thumb comes off moves the touchdown by up to 15 m and the clearance by 12 m.
  Pressing again does not recover it: lifted at 1.1 s and back on 0.25, 0.5, 1 or 2 s later, every flight
  still lands 15–16 m off (Rough landing ≈ 67). Sink is 1.0 m/s in all of them: the brake works, the car is
  simply thrown long.
- **The real car** came off the ledge, rolled upright in about 1.1 s and was "helped … gently land" on its pad
  (`docs/REVEAL_RESEARCH.md` §timeline, Car and Driver); nothing in it flies 17 m over the row. Assist's own
  promise on the sheet is "rolls you out, levels and brakes" (`phone-held-results.jpg`). With the thumb off
  mid-roll it rolls out, does not level (`out.level` is only set while `st.held`, `src/onethumb.js` `sample`),
  and the tilted lift vector carries the car down the course.
- **The verdict mislabels it:** a 1.0 m/s touchdown 21 m off the mark is called "Rough landing". The landing
  was soft; the miss is precision.

## What
- In `src/onethumb.js` (and only if needed the Assist LAND governor), make the flight with the thumb off the pad
  after the let-go fly like the hands-off Assist flight it already has for an early lift (≈ 6.6 m off, roof up,
  level): the roll-out finishes level whether or not the thumb is down, and the thumb's slide is the only
  thing that moves the touchdown. A re-press must take over again (LAND + aim) from where the car is.
- If the fix changes any reference flight, it is a sim change: bump `SIM_VERSION` and re-run the gates
  (AGENTS.md); the reference autopilot doesn't use the thumb, so the ref hashes should not move.
- Optional, same PR if it is one line: a soft touchdown (sink ≤ 1.5 m/s) far off the mark is not called
  "Rough landing" (`src/sim/judge.js` verdict); otherwise leave it and say so in the PR.

## Acceptance criteria
- [ ] A unit test sweeps the thumb's lift from 24 to 720 ticks after the tap (step ≤ 24) with no re-press, and
      every flight lands ≤ 8 m from the mark with ≤ 6 m over the roofs, no crash, no contact.
- [ ] The same sweep with a re-press 0.25–2 s after the lift: every flight ≤ 8 m from the mark.
- [ ] Neighbouring lift times (24 ticks apart) differ by ≤ 3 m in touchdown distance.
- [ ] `node scripts/human-phone.mjs 150 --scheme=thumb --skill=careful --daily`: clean landings, median score and
      gas-show met not lower than before (150/150 clean, median 92.7; print the split).
- [ ] `node scripts/ref-hash.mjs`: show `fedae05c`, wall `bacb4720`, lineup `8b2c2c9a` unchanged (or a
      `SIM_VERSION` bump with the gates re-run, `naive-players` 32/32, `naive-show` 54/54).
- [ ] 390×844 touch on production after deploy: a flight that holds from the tap and lifts ≈ 1 s later lands
      within 8 m of the mark (screenshot of the sheet).

## Test plan
- Unit: extend `tests/unit/thumb-gas.test.js` (or `thumb-mastery.test.js`) with the lift sweep above, in Node,
  no new e2e boot.

## Out of scope
- The careful thumb's slide (0121) and the gas Daily's bar (0135).
- The classic touch controls and the keyboard.
