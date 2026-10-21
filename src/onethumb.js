// One-thumb Assist: the Show (and the Wall) on a single control, for a phone held in one hand.
//
//   run-up, curl   HOLD to climb. A crawl governor holds ≈5 m/s, eases to 2 m/s near the top and
//                  brakes onto the ledge by itself. Let go and the car brakes (a dead-man pedal).
//   on the ledge   TAP to let go: a 0.15 s push-off on the down-jets, as the reveal did.
//   flight         HOLD to land: Assist's LAND (the roll-out, the brake governor) plus the carry
//                  over the row (the rear jets, until the row is behind you; Assist caps the carry
//                  at 10 m/s and the governor shuts them when it brakes).
//   touchdown      it brakes to a stop on its own.
//
// It writes ordinary sim inputs (assist = 1), sampled once per 240 Hz tick, so the input log
// quantises, packs and replays bit-exactly like any other run (src/sim/run.js). Nothing here reads
// the DOM: scripts/human-phone.mjs flies it in Node with the same code the page runs.
import { wallProgress } from './sim/run.js';
import { dhypot } from './sim/dmath.js';
import { SHOW } from './sim/courses.js';

export const THUMB = {
  crawl: 5.5,      // m/s on the run-up
  climb: 5,        // m/s up the curl
  top: 2,          // m/s over the last part of the curl
  slowAt: 0.85,    // curl progress where it eases off
  ledgeAt: 0.95,   // curl progress where it brakes onto the ledge
  tapAt: 0.92,     // from here a tap lets go (the HUD's "on the ledge")
  push: 36,        // ticks of RELEASE push-off (0.15 s)
  carry: 10,       // m/s: the most carry it will ask for (Assist caps it at 10)
  roof: 5,         // m: aim the carry over this height (the tallest roof in the row, and a margin)
  margin: 2,       // m past the far roof
  k: 0.45,            // tuning
};

// Which part of the flight the thumb is in: what the control says and does.
export function thumbStage(run, released) {
  if (!run) return 'idle';
  if (run.phase === 'landed' || run.phase === 'done') return 'landed';
  if (run.phase === 'air' || released) return 'fly';
  if (run.phase === 'ramp' && run.t.progress >= THUMB.tapAt) return 'ledge';
  return 'climb';
}

export function createOneThumb() {
  const st = { held: false, pressed: false, push: 0, wasStage: 'idle' };
  return {
    // Pointer events: `pressed` latches a tap shorter than a tick until the next sample reads it.
    down() { st.held = true; st.pressed = true; },
    up() { st.held = false; },
    reset() { st.held = false; st.pressed = false; st.push = 0; st.wasStage = 'idle'; },
    get held() { return st.held; },
    // Fill `out` (a newInput()) for this tick. `steer` is an extra steer (tilt), driver-relative.
    sample(run, released, out, steer = 0) {
      const c = run.car, stage = thumbStage(run, released);
      const v = dhypot(c.vel.x, c.vel.y, c.vel.z);
      const press = st.pressed; st.pressed = false;
      out.assist = 1; out.manual = 0;
      if (stage === 'climb' || stage === 'ledge') {
        // Hold the line up the middle of the deck (the run-up is straight), plus any tilt.
        out.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25 + steer));
        if (stage === 'ledge' && press) st.push = THUMB.push;
        if (st.push > 0) { out.lift = 1; st.push--; }   // RELEASE: main.js lets go of the Wall on lift
        else if (!st.held) out.brake = 1;
        else {
          const p = run.phase === 'ramp' ? wallProgress(c.pos) : 0;
          const want = run.phase === 'drive' ? THUMB.crawl : p >= THUMB.slowAt ? THUMB.top : THUMB.climb;
          if (run.phase === 'ramp' && p >= THUMB.ledgeAt) out.brake = 1;
          else if (v < want) out.throttle = 1;
          else if (v > want + 1.5) out.brake = 1;
        }
      } else if (stage === 'fly') {
        if (st.push > 0) { out.lift = 1; st.push--; }   // finish the push-off begun on the ledge
        // The carry over the row (the Show only): the tap that lets go also carries you out over
        // the roofs on the rear jets, whether or not the thumb stays down (the row is the one thing
        // a late thumb can't recover from).
        // Only as much carry as the far roofs need from this height (a free fall to just over the
        // tallest roof): every extra m/s lands you ≈4 m further past the mark.
        if (run.course === 'show' && !run.t.crossedRow && c.pos.z > SHOW.rowNear) {
          const fall = Math.sqrt((2 * Math.max(0.5, c.pos.y - THUMB.roof)) / 9.81);
          const need = Math.min(THUMB.carry, (c.pos.z - SHOW.rowFar + THUMB.margin) / fall * THUMB.k);
          if (dhypot(c.vel.x, c.vel.z) < need) out.thrust = 1;
        }
        if (st.held) out.level = 1;
      } else if (stage === 'landed') {
        out.brake = 1;
      }
      st.wasStage = stage;
      return out;
    },
  };
}
