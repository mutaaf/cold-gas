// The Lineup's lift-off on keys, a pad and the page's touch buttons, Assist only (0362). Pure: plain sim inputs, no DOM.
//
// The reveal's kickflip was one short burn off flat ground to ≈ 7–8 m (docs/REVEAL_RESEARCH.md §2.2, row 46), and the
// cue says "Space at the line". A held LIFT used to be a throttle: the four down-jets pushed for as long as the key was
// down, so one second of "hold" flew the car to 45 m and spent the nitrogen the landing needed. On the Lineup in
// Assist, a LIFT pressed on the run-up is a lift-off command instead: from that press the down-jets burn until the
// projected apex (pos.y + vy²/2g, the rule src/sim/autopilot.js lineupPilot flies) reaches LIFT_OFF_APEX, whether the
// key is let go early or still held, then stop by themselves. A key still down after
// the burn counts as let go until it is pressed again; a LIFT pressed afresh in the air is LIFT as it always was.
//
// src/input.js sample() runs it on every tick it samples (keys, a pad, the touch buttons); freshRun() resets it.
// The gate writes only `lift`, before stepRun quantises and logs it, so the log records the burn the car flew: the
// Worker's replay, a challenge and the ghost need nothing new, and the sim is unchanged (no version bump). One thumb
// has its own lift-off (src/onethumb.js, 0181; its 720 burns past this apex) and never comes through here; Pro and
// Advanced fly LIFT by hand.
import { G } from './sim/vehicle.js';

// m, the projected apex (the CoM's height) the burn stops at. The reference stops at REVEAL.lineup.apex (5.0) and peaks at
// 8.1 m because it rolls the moment the burn ends: in Assist the roll's jets add lift on the way up. A player who keeps the
// key down rolls later, or never: from 5.0 they peaked at 5.7 m and came down on the row, and a roll begun after a 1 s
// hold (the keys' ramp eases it in) came down on the last roof. From 7.25 the car peaks 7.7–9.1 m over the ground (the
// reveal's 7–9 m, §2.2) however the roll is timed, and the naive keys grid lands the most of any target
// (tests/unit/naive-lineup.test.js through src/input.js: 6.25 → 178 of 225, 6.75 → 193, 7.0 → 189, 7.25 → 196,
// 7.375 → 192, 7.5 → 190; every hold up to 1 s lands from 7.25 on).
export const LIFT_OFF_APEX = 7.25;

/** A run's gate: `gate(phase, car, input)` rewrites input.lift in place and returns the input (`phase` the run's,
 *  `car` its vehicle: the course is car.course.id). One per run (`reset` between). */
export function createLiftOff(apex = LIFT_OFF_APEX) {
  // burning: a lift-off burn is on; spent: it ended, and the LIFT still down then waits for a fresh press.
  const st = { burning: false, spent: false, was: false };
  function gate(phase, car, inp) {
    const down = inp.lift > 0, fresh = down && !st.was;
    st.was = down;
    if (car?.course?.id !== 'lineup' || !inp.assist || inp.manual) { st.burning = false; st.spent = false; return inp; }
    if (st.spent) {
      if (fresh) st.spent = false;   // pressed again: LIFT as it always was
      else if (down) { inp.lift = 0; return inp; }
    }
    if (!st.burning && fresh && phase === 'drive') st.burning = true;
    if (st.burning) {
      const vy = car.vel.y;
      if (car.pos.y + (vy > 0 ? (vy * vy) / (2 * G) : 0) < apex) inp.lift = 1;
      else { st.burning = false; st.spent = down; inp.lift = 0; }
    }
    return inp;
  }
  gate.reset = () => { st.burning = false; st.spent = false; st.was = false; };
  gate.state = st;
  return gate;
}
