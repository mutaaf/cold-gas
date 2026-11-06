---
id: 0164
title: On one thumb, a held sideways slide moves the touchdown the way it points, more for more, and never off the pad
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-05
pr:
by: critic
---

## Why
The slide is the one skill input on one thumb (0121), and the focus's item 1 is "skill that shows in the score". A
skill input has to be monotonic: more slide, more move, in the direction of the slide. On the Show it isn't. Critique
`docs/critique/2026-11-05-1300.md` §1 flew the one-thumb Show in Node with the page's own code (`createOneThumb`, the
`thumb-mastery.test.js` harness): hold from the tap, and once the pad's sight is drawn (roof up, `src/thumb-aim.js`),
slide the thumb sideways by X px and hold it there. Without a slide, the car lands 5.3 m left of the mark (padMiss 6.0,
Stuck it 85.7). The sight draws the mark ≈ 36 px right.

| held slide (px) | lateral at touchdown | padMiss | verdict |
|---|---|---|---|
| 0 | −5.3 m | 6.0 | Stuck it 85.7 |
| +8 | −4.8 | 5.5 | Stuck it 88.0 |
| +10 | −3.9 | 4.6 | Perfect 10 92.0 |
| **+12** | **−9.3** | **9.8** | **Clean 74.7** (further left than no slide) |
| +14 | −6.9 | 7.4 | Clean 79.0 |
| +16 | −5.2 | 5.7 | Stuck it 87.0 |
| +18 | −3.4 | 4.1 | Perfect 10 93.7 |
| +20 | −1.7 | 2.7 | Perfect 10 95.3 |
| +32 | +6.0 | 7.1 | Clean 78.7 |
| **+36** (the dot drawn on the mark) | **+16.7** | **16.9** | **Rough landing 67.0**, 1.1 m over the roofs |
| +40 … +48 | +14.3 … +16.5 | 14.8 … 16.7 | Rough landing 67–68 |
| **−12** (a 2 mm slip the wrong way) | **−17.4** | **17.9** | **Rough landing 67.3** |
| −24, −36 | −28.0, −32.8 | 28.6, 33.4 | Rough landing 66, 65.7 |

So between 10 and 18 px the touchdown swings ±3 m for every 2 px, and the wrong direction half the time. A thumb put
where the sight puts the dot (≈ 36–40 px, `inv(shape)` of the drawn mark) and held turns a Stuck it into a Rough
landing 16 m off. A 12 px slip the wrong way does the same 18 m the other way. `AIM_PX_PER_M = 6` (`src/onethumb.js:187`)
promises 6 px a metre. The flight gives anywhere from 0 to 0.6 m a pixel, of either sign.

A thumb that keeps re-reading the dot (0.2–0.3 s late, 100–1000 px/s) still lands 2.0–3.2 m off (Perfect 10,
95.3–95.7), because it corrects the swings. So the skill is reachable, but the control under it is a cliff, and a
newcomer who slides once and holds, as the sheet's "slide onto the amber dot" reads, gets punished for doing it.

The likely causes are in `src/onethumb.js:155-168`. The roll is live from ≈ 23 m up, as soon as the car is roof up,
over the row, for about 3 s. `flankAhead` gates it on and off each tick, and that on/off is the non-monotonic part.
Diagnose before changing.

## What
In `src/onethumb.js` (and only there, unless the diagnosis says otherwise), make the sideways slide a proportional
control over the touchdown, the way `AIM_PX_PER_M` says. A held slide of X px moves the predicted touchdown
≈ X / 6 m toward the side slid, and it saturates at the full command, not past the pad's outer ring. Options to measure:
- a rate limit on the slide's roll, scaled by the time left to touchdown
- a closed loop on `predict`'s touchdown, the way `steerToPad` does in `src/sim/autopilot.js`
- a flank gate with hysteresis instead of tick-by-tick on/off

This is a sim-input change, not a sim change: the log, replay and scorer are untouched. If the ref-hash moves,
`SIM_VERSION` and vectors follow the usual rules.

## Acceptance criteria
- [ ] Unit (extend `tests/unit/thumb-mastery.test.js`): the one-thumb Show held from the tap, a held sideways slide
      from −48 to +48 px in 2 px steps. Lateral at touchdown is monotonic in the slide (non-decreasing within 0.3 m
      noise). Every flight lands ≤ 8 m from the mark (the outer ring is 7 m, `src/sim/courses.js:192`), with no
      Rough landing and no contact.
- [ ] Unit: a slide held where the sight draws the dot at its first frame lands ≤ 3.5 m from the mark (the mark Daily's
      bar, `src/daily.js:45`).
- [ ] Unit: the re-reading thumb above (0.2–0.3 s late) still lands ≤ 3.5 m, and `naive-players` stays 32/32.
- [ ] `node scripts/human-phone.mjs 150 --scheme=thumb --skill=careful` lands no worse than today: write both numbers in
      the PR.
- [ ] Funnel number to move: `run-landed` per `run` and `retry` per `run` among one-thumb runs (digest `players`).

## Test plan
Add the slide sweep to `thumb-mastery.test.js`, with the harness from `docs/critique/2026-11-05-1300.md` §1 (the probe
is described there). Keep the existing "no slide, however wild, lands on the row" test.

## Out of scope
- The along-track (up/down) half of the slide: that's 0165.
- The sight's drawing (`src/thumb-aim.js`), unless the scale changes.
- Classic touch, keys and Advanced.

## Critic sharpen 2026-11-06
Two things to add (`docs/critique/2026-11-06-0400.md` §1–2):
- **The Wall has the same shape, and today's Daily is on the Wall** (soft-wall, Nov 6). One-thumb Wall, held from the
  tap, Node harness. No slide lands 6.1 m right and 9.7 m long (padMiss 11.4, Stuck it 90.7). Held sideways
  slides give lateral **−12 px → +8.7 m** (worse than no slide, the wrong way), **−24 → −1.9**, **−36 → −7.6**,
  **−48 → −5.8**, **+12 → +16.2**, **+24 → +26.6**, **+36 → +29.7**. Again there's a sign flip between 12 and 24 px,
  and a 10.6 m swing for 12 px. The Wall's up/down half does work (0, −24 → landZ −9.8, padMiss 7.2, 93), so the
  sideways defect isn't only the Show's row gate.
- **0169 may feed this on the Show.** The down-jets' mid-brake gap opens at the row's last roof, and its timing
  depends on the car's x (slide +12: 0.20 s off from 6.7 m; +32: 0.32 s off from 5.4 m). Re-measure this ticket's
  table after 0169 lands, before tuning `AIM_PX_PER_M` or `flankAhead`.
- [ ] The monotonic and proportional criteria above hold on the Wall too (held sideways slides −48 … +48 px, step 4).
