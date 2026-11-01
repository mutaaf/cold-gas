---
id: 0124
title: The results name the missed mark when it cost the most points, not "nothing big to fix"
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-01
pr:
by: critic
---

## Why
The operator's focus puts the score right after landing and "skill that shows in the score" first. 0121
(SIM_VERSION 27) moved the Show's weight onto the mark: precision is now 0.36 / 0.28 / 0.34 of the three judges
(`SHOW_W`, `src/sim/judge.js`). The mark is read off `SHOW_PRECISION`, which pays 0.85 at 5 m and 0.45 at 7 m. The
coach that writes the results' **What happened** card was not moved with it. It names the mark only past
**7 m** (`if (f.touch && f.touch.padMiss > 7 …)`, `src/sim/coach.js`). With no other finding, it falls back to
**"Clean: nothing big to fix."** and pitches Pro (`finish()`, same file).

Measured on production `d01a78a` (docs/critique/2026-11-01-0400.md). This was a first-visit phone run at 390×844
touch, one thumb (hold, tap on the cue, hold), with no slide:
- **80.3 Clean**, `padMiss` **6.8 m**, sink 1.3 m/s, gas 27 % (`f-4-results+2.jpg`).
- At 6.8 m the mark scores 10 × 0.49 = 4.9. That costs each judge w × 5.1: 1.84, 1.43 and 1.73 of their 10.
  That is **≈ 16.7 of the 19.7 points** the run is short of 100.
- The same screen says **"What happened · Clean: nothing big to fix. Want more? Try Pro"**. Directly above it, the
  pointer line (`src/pointer.js` `clean`) says *"hold in the air and slide onto the amber dot to land on the mark"*.
  Two panels give two answers, and the one titled *What happened* is wrong about the run's biggest loss.
- This isn't one unlucky run. `node scripts/human-phone.mjs 300 --scheme=thumb --skill=none` lands **300/300
  inside the 7 m ring**, with a median of 83.7. So the 7 m threshold never fires for the default one-thumb
  population, and every one of them is told nothing big went wrong. Aiming players (`--skill=careful`) reach a
  median of 93. The 9-point skill gap exists, but the results card hides it.

## What
- `src/sim/coach.js`: on the Show, raise the `mark` finding wherever the mark cost real points. Derive the
  threshold from `SHOW_PRECISION` (≥ 3.5 m, where it stops paying full marks), not a fixed 7 m. Weight the finding
  by the points it cost the total (the same weighted sum `scoreWall` uses). A 6.8 m miss then outranks a
  2-point finding, and the detail says how much it cost ("6.8 m off the mark: about 17 points").
- When the run was flown on the one-thumb scheme, the fix text is the thumb's ("hold in the air and slide onto
  the amber dot"), not the classic "lean toward the pad (pitch or roll)". The coach already takes `assist` and
  `say`. Pass the scheme the same way, or let `pointer.js` own the line, so both panels say the same thing.
- `finish()`'s "nothing big to fix" fallback appears only when no category cost more than ~3 points of the total.
- The Wall and the Lineup keep their thresholds. No change to `judge.js`, the sim or SIM_VERSION.

## Acceptance criteria
- [ ] Unit (`tests/unit/learn.test.js`, "the coach"): the Show telemetry with `padMiss` 6.8 m, Assist and a soft touchdown yields a
      `mark` item as the first finding (not `clean`). Its detail states the miss in metres and the points it cost,
      within ±1 of the total re-scored with `padMiss` = 0.
- [ ] Unit: `padMiss` 3.0 m with nothing else wrong still yields `clean`.
- [ ] `human-phone.mjs 300 --scheme=thumb --skill=none`: report the share of runs whose first finding is `clean`.
      Today ≈ 100 %. After the change it is under 10 %, and the median score is unchanged (83.7: no sim change).
- [ ] At 390×844 touch, a one-thumb run with no slide shows a *What happened* card that names the mark. Its fix
      text matches the NEXT RUN line in substance (screenshot in the PR). The same at 1280×720 keyboard shows the
      keyboard's words.
- [ ] Determinism, `naive-players` 32/32 and the reference Show 97.7 unchanged. `hud-audit` clean.

## Test plan
Extend `tests/unit/learn.test.js` ("the coach") with the two Show telemetry fixtures above. Extend the `results` e2e (or the phone
rookie spec) to fly the one-thumb Assist with no slide and assert that `[data-coach]` (or the *What happened*
card's first item) mentions the mark.

## Out of scope
Re-weighting the judges (0121 owns that). Changing what the pointer line says on other findings. A coach for Pro or
Advanced beyond the shared threshold.
