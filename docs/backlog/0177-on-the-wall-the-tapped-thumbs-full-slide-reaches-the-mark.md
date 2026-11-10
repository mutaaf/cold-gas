---
id: 0177
title: On the Wall, a tapped thumb's slide acts as early as a held one's, and a full slide reaches the mark
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-09
pr: 287
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
- [x] Unit (`tests/unit/thumb-mastery.test.js`): on the Wall, tapped and pressed again at 0.75, 1.0, 1.5 and 2.0 s,
      the first non-zero roll from a held slide comes ≤ 0.3 s after the held-from-the-tap thumb's (today 1.90 s vs
      2.50–2.87 s).
- [x] Unit: on those lines, −48 px moves the touchdown ≥ 1.6× as far as −24 px does, and ≥ 0.75 × 8 m (today
      1.0× and 3.3–3.7 m). The touchdown stays inside the 7 m ring (`src/sim/courses.js` Wall pad rings).
- [ ] (moved to 0179, see Builder's notes) Unit: the careful thumb on the dot (re-read every 0.3 s, 60 ticks late) lands ≤ 3.5 m from the mark on the
      Wall, pressed again at 1.0, 1.5 and 2.5 s (today 4.3 / 5.9 / 8.9 m).
- [x] 0164's existing sweeps (Show and Wall, held and tapped) pass unchanged. `naive-players` 32/32. `ref-hash` per
      the usual rules.
- [x] `node scripts/daily-reach.mjs`: every Wall objective stays over the floor; write the before and after in the PR.
- [ ] (named in the PR; it moves once players fly it) Funnel number to move: `run-landed` / `run` and `retry` / `run` among one-thumb Wall runs (digest `players`).

## Test plan
Extend `thumb-mastery.test.js` with a Wall sweep: the tapped thumb and the held thumb, logging the first roll tick
and the lateral at −24 and −48 px. Add the careful dot-follower from the critique (the file's `careful()` with a
60-tick reaction queue) on the Wall.

## Out of scope
- The Show (its tapped thumb reaches; the stop over the semi is 0170, the along dot's jump is 0174).
- The sight's drawing, except where the timing change needs the dot to follow.
- Classic touch, keys and Advanced.

## Builder's notes (2026-11-10)
Diagnosis (Node, the test's `flyThumb`): the reach was lost to the wait. Pressed again in the air, the Wall's car comes
roof up 2.1 s after the tap, 14 m up, falling at 16 m/s and still banked ≈ 12°. The body-axis read took 3.4 m/s of that
fall for drift (`ref` 12.4 m against the ≈ 8 it settles to), so the settle held the slide off until 2.87 s and 4 m up,
where the bank cap had already tapered. `AIM_BANK` was not the limit: acting from the first roof-up tick, the same cap
reaches 10 m.

The fix (`src/onethumb.js`, mirrored in `OneThumb.swift`): a hold pressed in the air on the Wall reads the place with
REF_LEAK (0.2) of the fall through the bank, acts on its first roof-up tick, and never rolls less than LAND's own hold
the way slid. Held thumbs and the Show fly bit for bit as before (ref-hash unchanged).

| again | first roll (was) | 0 px | −24 px (was) | −48 px (was) |
|---|---|---|---|---|
| held | 1.90 s (1.90) | 6.1 | 0.6 (0.6) | −5.1 (−5.1) |
| 0.75 s | 1.60 s (2.50) | 6.0 | −0.4 (0.6) | −5.9 (−1.3) |
| 1.0 s | 1.88 s (2.78) | 6.1 | 1.5 (2.5) | −4.1 (2.5) |
| 1.5 / 2.0 s | 2.07 s (2.87) | 7.2 | 1.9 (4.0) | −3.2 (4.0) |

Not met: the careful dot-follower ≤ 3.5 m (now 3.7–4.1 at 1.0 s, 6.2–8.2 at 1.5 s, 8.2 at 2.5 s). The reach is there: a
fixed (−34, −34) px slide lands 1.8 m from the mark at 1.5 s. The follower misses for three reasons:
- On the Wall the sight's along-run part takes most of the dot's 44 px radius, so the first read is (−20, +39), not the
  ≈ −40 px sideways the place needs.
- Its 0.25 s reaction plus 0.3 s re-reads eat half of a ≈ 1 s aimable window.
- At 2.5 s the press comes 7.9 m up, and even a full (−48, −48) lands 7.2 m off. No slide can reach 3.5 m from there.

That is the sight and the bar, not this slide, so it is filed as 0179.
