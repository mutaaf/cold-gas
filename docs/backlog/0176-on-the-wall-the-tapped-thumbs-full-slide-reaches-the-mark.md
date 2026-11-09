---
id: 0176
title: On the Wall, a tapped thumb's slide acts as early as a held one's, and a full slide reaches the mark
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-09
pr:
by: critic
---

## Why
The focus's item 1 is "skill that shows in the score", and on one thumb the slide is the skill. After 0164 the
sideways slide is monotonic and never the wrong way, on both courses and for both thumbs. On the Wall, though, the
commonest thumb (tap on the ledge, lift, press again: 89/120 in `scripts/human-phone.mjs`, LESSONS 2026-11-06) gets
half the reach a held thumb gets. A full slide there moves the touchdown no further than half a slide does.
Critique `docs/critique/2026-11-09-2150.md` §1 (Node, the `thumb-mastery.test.js` `flyThumb` harness on main
`fb2bc3b`; the Wall's pad is at x 0, z −9):

| thumb | first roll after the tap | 0 px lateral | −24 px | −48 px |
|---|---|---|---|---|
| held from the tap | 1.90 s | 6.0 m | 0.4 m | **−5.8 m** (11.8 m moved) |
| tapped, again 0.75 s | 2.50 s | 6.0 | 0.4 | −1.8 |
| tapped, again 1.0 s | 2.78 s | 6.1 | 2.5 | **2.4** (3.7 m moved) |
| tapped, again 1.25–2.0 s | 2.87 s | 7.3 | 4.0 | **4.0** (3.3 m moved) |

- The wheels touch about 5.3 s after the tap. The tapped thumb's slide starts acting only 2.4 s before them.
- −24 and −48 px land in the same place. "More for more" (0164's Why) stops at half a slide.
- `AIM_PX_PER_M = 6` (`src/onethumb.js`) promises 8 m for 48 px. The tapped thumb gets 0.4–0.5× of that.
- **The careful thumb on the dot** (re-reads every 0.3 s, acts 0.25 s late, both axes):

  | thumb | lands |
  |---|---|
  | held | 1.8 m from the mark, 96 |
  | tapped, again 1.0 s | 4.3 m, 94.3 |
  | again 1.5 s | 5.9 m, 94 |
  | again 2.5 s | 8.9 m, past the 7 m ring, 92.3 |

  So the player who does exactly what the sight shows (ink on amber) is still 4–6 m wide, the sight's dot pinned at
  the ring's edge (≈ −31, +31 px) for the whole descent.
- The likely cause is 0164's settle: `ref` is read until it has held still for `REF_WINS` windows, and only then can the
  slide act. The builder noted it ("tapped up to ≈ 0.9 s on the Wall"). Diagnose before changing. The reach could be
  lost to the wait, to `AIM_BANK`'s low-altitude taper, or to both.

The real car's touchdown is a place it chose and flew to (REVEAL_RESEARCH §2.1.4). In this game, a thumb that
pressed a second time can't choose it.

## What
`src/onethumb.js` (mirror in `OneThumb.swift`, vectors regenerated per the usual rules). Make the tapped thumb's
sideways slide act within ≈ 0.3 s of the held thumb's, at the same height, and keep full slide reach to the end.
Options to measure:
- settle `ref` from an attitude-corrected read rather than waiting for it to stop moving
- start the move on the best current `ref` and correct it as `ref` settles
- give the late slide the bank it needs while the car is still high

Keep 0164's guarantees: monotonic, never the wrong way, no contact, no Rough landing, and the no-slide flight bit for bit.

## Acceptance criteria
- [ ] Unit (`tests/unit/thumb-mastery.test.js`): on the Wall, tapped and pressed again at 0.75, 1.0, 1.5 and 2.0 s,
      the first non-zero roll from a held slide comes ≤ 0.3 s after the held-from-the-tap thumb's (today 1.90 s vs
      2.50–2.87 s).
- [ ] Unit: on those lines, −48 px moves the touchdown ≥ 1.6× as far as −24 px does, and ≥ 0.75 × 8 m (today
      1.0× and 3.3–3.7 m). The touchdown stays inside the 7 m ring (`src/sim/courses.js` Wall pad rings).
- [ ] Unit: the careful thumb on the dot (re-read every 0.3 s, 60 ticks late) lands ≤ 3.5 m from the mark on the
      Wall, pressed again at 1.0, 1.5 and 2.5 s (today 4.3 / 5.9 / 8.9 m).
- [ ] 0164's existing sweeps (Show and Wall, held and tapped) pass unchanged. `naive-players` 32/32. `ref-hash` per
      the usual rules.
- [ ] `node scripts/daily-reach.mjs`: every Wall objective stays over the floor; write the before and after in the PR.
- [ ] Funnel number to move: `run-landed` / `run` and `retry` / `run` among one-thumb Wall runs (digest `players`).

## Test plan
Extend `thumb-mastery.test.js` with a Wall sweep: the tapped thumb and the held thumb, logging the first roll tick
and the lateral at −24 and −48 px. Add the careful dot-follower from the critique (the file's `careful()` with a
60-tick reaction queue) on the Wall.

## Out of scope
- The Show (its tapped thumb reaches; the stop over the semi is 0170, the along dot's jump is 0174).
- The sight's drawing, except where the timing change needs the dot to follow.
- Classic touch, keys and Advanced.
