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
