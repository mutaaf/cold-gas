// How a device walks the touchdown onto the mark, in the coach's words (0124): src/sim/coach.js's 'mark' fix and
// src/pointer.js coachWords' `aim`. A leaf module, so the pointer's wording doesn't pull the sim in.
export const AIM_LEAN = 'lean toward the pad (pitch or roll) above 5 m to walk the touchdown marker onto the rings, then level';
export const AIM_THUMB = 'hold the pad in the air and slide onto the amber dot: the touchdown follows it onto the rings';
// Out of braking at the bottom (0125): how this device brakes to the ground. On one thumb with Assist the held pad
// is the brake and the computer paces the sink (no green band, no separate brake). Since 0164 the slide flies LAND's
// own hold-the-line law, and a held slide brakes as well as none (the Show held sideways from the release: none 1.05 m/s,
// ±24 px 1.06–1.09, ±48 px 1.04–1.09), so the words no longer tell a thumb to keep it small.
export const RANOUT_LEAN = 'Stay on the brake through the last 2 m: hold the sink in the green band to the ground.';
export const RANOUT_THUMB = 'Keep holding the pad all the way to the ground: the held pad is the brake.';
// The Lineup's run-up and lift (0367), for the coach's row / no-lift fixes and the pointer's line. The reveal ran up at
// ≈ 7–9 m/s (docs/REVEAL_RESEARCH.md §2.2, ESTIMATE), 25–30 km/h as the HUD shows it. About half a second of LIFT at
// the line is what lands: the 200-player keys population (scripts/lib/daily-reach.mjs flyKeysLineup, seed 777) lands at
// 0.5 s from 23–32 km/h and comes down on the row at 0.35–0.4 s whatever the speed.
export const LINEUP_RUNUP_KMH = [25, 30];
export const LINEUP_LIFT_HOLD = 0.5;
// km/h either side of the band before a fix names the speed: the keys players who land reach the line at 23–32 km/h.
export const LINEUP_SPEED_SLACK = [3, 4];
// A LIFT press that ends this far (m) before the line is a tap on the run-up, not the lift (0367): the hold read is the
// press at the line.
export const LINEUP_TAP_BEFORE = 5;
// A LIFT press at the line that began more than this (m, the car's centre past LINEUP_LINE) late is named as late (0370):
// of the 90 keys players in the band (22–34 km/h, a hold ≥ 0.45 s), 0 of 69 who pressed before 1.25 m crashed and 7 of 21
// at 1.25 m or later did, every one with the nose into the first car on the way up.
export const LINEUP_LIFT_LATE = 1.25;
// 0371: an Assist card on a course judged on the rings (the Show, the Wall) whose Precision is under 10 missed the 2 m
// bullseye (SHOW_PRECISION in judge.js, 0360), so its clean step is the ring, not Pro: the card's own padMiss (at its 0.1),
// or -1 when the ring isn't the step (Pro and Advanced keep "chase the details", which names the ring; no card; the Lineup).
export function ringMiss(card) {
  const f = card?.facts, p = card?.categories?.precision;
  const course = card?.course || f?.course || 'lineup';   // a Lineup card carries no course (as pointsLeft reads it)
  if (!f || card.tier !== 'assist' || (course !== 'show' && course !== 'wall') || !(p < 10) || !Number.isFinite(f.padMiss)) return -1;
  return f.padMiss;
}
