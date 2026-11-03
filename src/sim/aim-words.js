// How a device walks the touchdown onto the mark, in the coach's words (0124): src/sim/coach.js's 'mark' fix and
// src/pointer.js coachWords' `aim`. A leaf module, so the pointer's wording doesn't pull the sim in.
export const AIM_LEAN = 'lean toward the pad (pitch or roll) above 5 m to walk the touchdown marker onto the rings, then level';
export const AIM_THUMB = 'hold the pad in the air and slide onto the amber dot: the touchdown follows it onto the rings';
// Out of braking at the bottom (0125): how this device brakes to the ground. On one thumb with Assist the held pad
// is the brake and the computer paces the sink (no green band, no separate brake), so the one thing the thumb adds
// is the slide: it tilts the lift jets, and a tilted jet brakes less (held sideways from the release: none 1.0 m/s, 30 px 1.2, 40 px 1.3; letting go of it by 3–6 m changed
// nothing measurable, and below 1.5 m the pad ignores it, so the words say how big, not when).
export const RANOUT_LEAN = 'Stay on the brake through the last 2 m: hold the sink in the green band to the ground.';
export const RANOUT_THUMB = 'Keep holding the pad to the ground, and keep the slide small: a big slide tilts the jets off the brake.';
