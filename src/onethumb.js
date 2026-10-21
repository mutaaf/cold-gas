// One-thumb Assist: the Show (and the Wall) on a single control, for a phone held in one hand.
//
//   run-up, curl   HOLD to climb. A crawl governor holds ≈5 m/s, eases to 2 m/s near the top and
//                  brakes onto the ledge by itself. Let go and the car brakes (a dead-man pedal).
//   on the ledge   TAP to let go: it drives out along the ledge at the carry speed and lets go
//                  near the lip (as the reference does), so it leaves already moving out over the row.
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

export const THUMB = {
  crawl: 5.5,      // m/s on the run-up
  climb: 5,        // m/s up the curl
  top: 2,          // m/s over the last part of the curl
  slowAt: 0.85,    // curl progress where it eases off
  ledgeAt: 0.95,   // curl progress where it brakes onto the ledge
  tapAt: 0.92,     // from here a tap lets go (the HUD's "on the ledge")
  push: 36,        // ticks of RELEASE push-off (0.15 s)
  carry: 5.5,      // m/s along the run off the lip (the rear jets top up any shortfall). Clears the row
                   // from 4; every m/s more lands ≈1.2 m further past the mark (the reference's 7.5 is ≈11 m)
  lip: 0.98,       // curl progress where the drive-off lets go
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
  const st = { held: false, pressed: false, push: 0, drive: false, carried: false, wasStage: 'idle' };
  return {
    // Pointer events: `pressed` latches a tap shorter than a tick until the next sample reads it.
    down() { st.held = true; st.pressed = true; },
    up() { st.held = false; },
    reset() { st.held = false; st.pressed = false; st.push = 0; st.drive = false; st.carried = false; st.wasStage = 'idle'; },
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
        if (stage === 'ledge' && press) st.drive = true;
        if (st.drive && st.push === 0) {   // the drive-off: out along the ledge, let go near the lip
          if (run.phase === 'ramp' && wallProgress(c.pos) >= THUMB.lip) st.push = THUMB.push;
          else { out.throttle = v < THUMB.carry ? 1 : 0; return out; }
        }
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
        // The carry over the row (the Show only): the rear jets top up to the reference's carry once,
        // whether or not the thumb stays down (the row is the one thing a late thumb can't recover from).
        if (run.course === 'show' && !st.carried) {
          if (-c.vel.z >= THUMB.carry) st.carried = true;
          else out.thrust = 1;
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
