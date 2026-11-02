// One-thumb Assist: the Show (and the Wall) on a single control, for a phone held in one hand.
//
//   run-up, curl   HOLD to climb. A crawl governor holds ≈5 m/s, eases to 2 m/s near the top and
//                  brakes onto the ledge by itself. Let go and the car brakes (a dead-man pedal).
//   on the ledge   TAP to let go: it drives out along the ledge at the carry speed and lets go
//                  near the lip (as the reference does), so it leaves already moving out over the row.
//   flight         HOLD to land: Assist's LAND (the roll-out, the brake governor) plus the carry
//                  over the row (the rear jets, until the row is behind you; Assist caps the carry
//                  at 10 m/s and the governor shuts them when it brakes).
//                  SLIDE to aim (0121): the held thumb slid off where it pressed places the touchdown.
//                  Roof up, the slide tilts the lift vector
//                  (pitch / roll, as the reference pilot steers onto the pad): up = further, down =
//                  shorter, sideways = sideways. Never upside down, never low beside the row, never
//                  pulled back over it, faded out for the set-down. A thumb that never slides flies
//                  exactly as before (the computer's touchdown, ≈6 m off the mark on the Show).
//   touchdown      it brakes to a stop on its own.
//
// It writes ordinary sim inputs (assist = 1), sampled once per 240 Hz tick, so the input log
// quantises, packs and replays bit-exactly like any other run (src/sim/run.js). Nothing here reads
// the DOM: scripts/human-phone.mjs flies it in Node with the same code the page runs.
import { wallProgress } from './sim/run.js';
import { dhypot } from './sim/dmath.js';
import { up, forward, CAR } from './sim/vehicle.js';
import { SPEC } from './sim/spec.js';
import { COURSES } from './sim/courses.js';

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
  // AIM (0121): in the air, roof up, the held thumb slid off where it pressed tilts the lift vector like
  // a drone's stick (LAND's level law makes the stick an attitude: pitch 0.55 ≈ 20°): up = longer, down =
  // shorter, sideways = sideways. The reference pilot's steerToPad limits (src/sim/autopilot.js).
  aimPx: 48,       // px of slide for a full command
  aimDead: 0.15,   // of a full slide: a resting thumb's wobble moves nothing (and keeps LAND's line hold)
  aimPitch: 0.55, aimRoll: 0.45,
  aimFloor: 1.5,   // m: below this the thumb's slide is ignored, so the car sets down level,
  aimFade: 1,      // m: … fading in over this much height above it (a tilted touchdown splits the wheels)
};

const uw = { x: 0, y: 0, z: 0 }, fw = { x: 0, y: 0, z: 0 };
// Pulling the touchdown back (shorter) only well clear of the row (the Show): the whole car past its
// far edge by ROW_MARGIN, and either further on or still carrying away from it. Pitched back over the
// last car it would set down on its roof.
const ROW_MARGIN = 2.5;
// Sideways m/s² for a full roll command (measured ≈ 5 m/s² under the brake's lift in scripts/human-phone.mjs
// traces; 6 to err wide) and the flank check's look-ahead: does the car, carrying on as it is (falling at
// least as fast as now: LAND only slows it, so this errs low) plus the slide's push, come in over a
// parked vehicle's side, below its roof + FLANK_TOP, within FLANK_T s? Only boxes it isn't already over.
const AIM_ACC = 6, FLANK_T = 2, FLANK_PAD = 0.6, FLANK_TOP = 0.8;
export function flankAhead(c, ax) {
  const boxes = COURSES.show.boxes, hw = CAR.halfW + FLANK_PAD, hl = CAR.halfL + FLANK_PAD;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (Math.abs(c.pos.x) < b.maxX + hw) continue;   // over it already, or level with it: LAND's roof hold
    for (let t = 0.25; t <= FLANK_T + 1e-9; t += 0.25) {
      const x = c.pos.x + c.vel.x * t + 0.5 * ax * t * t, z = c.pos.z + c.vel.z * t;
      const bottom = c.pos.y - SPEC.comHeight + Math.min(0, c.vel.y) * t;
      if (Math.abs(x) < b.maxX + hw && z > b.minZ - hl && z < b.maxZ + hl && bottom < b.maxY + FLANK_TOP) return true;
    }
  }
  return false;
}
function rowBehind(run, c) {
  if (run.course !== 'show') return true;
  const far = COURSES.show.rowFar - ROW_MARGIN;
  return c.pos.z < far && (c.pos.z < far - 4 || c.vel.z < -1);
}
// A slide (in full-slide units) past the dead zone, rescaled to 0..1 and clamped.
function shape(a) {
  const m = Math.abs(a);
  if (m <= THUMB.aimDead) return 0;
  return Math.sign(a) * Math.min(1, (m - THUMB.aimDead) / (1 - THUMB.aimDead));
}

// Which part of the flight the thumb is in: what the control says and does.
export function thumbStage(run, released) {
  if (!run) return 'idle';
  if (run.phase === 'landed' || run.phase === 'done') return 'landed';
  if (run.phase === 'air' || released) return 'fly';
  if (run.phase === 'ramp' && run.t.progress >= THUMB.tapAt) return 'ledge';
  return 'climb';
}

export function createOneThumb() {
  const st = { held: false, pressed: false, push: 0, drive: false, carried: false, wasStage: 'idle', ax: 0, ay: 0, live: false };
  const aim = { x: 0, y: 0 };
  return {
    // Pointer events: `pressed` latches a tap shorter than a tick until the next sample reads it.
    down() { st.held = true; st.pressed = true; st.ax = 0; st.ay = 0; },
    up() { st.held = false; st.ax = 0; st.ay = 0; },
    // The held thumb's slide from where it pressed, CSS px (+x right, +y up the glass).
    move(dx, dy) { if (st.held) { st.ax = dx / THUMB.aimPx; st.ay = dy / THUMB.aimPx; } },
    reset() { st.held = false; st.pressed = false; st.push = 0; st.drive = false; st.carried = false; st.wasStage = 'idle'; st.ax = 0; st.ay = 0; st.live = false; },
    get held() { return st.held; },
    // 0129: the drive-off is under way (a tap on the ledge was taken; it lets go at the lip), and a press
    // the next tick hasn't read yet. The pad shows "Letting go" from either, on the frame of the tap.
    get driving() { return st.drive; },
    get pending() { return st.pressed; },
    // The slide as the pad draws it: -1..1 each way, 0 inside the dead zone.
    get aim() { aim.x = shape(st.ax); aim.y = shape(st.ay); return aim; },
    // Whether the last tick could aim (held, in the air, roof up, high enough, the row allowing).
    get aimLive() { return st.live; },
    // Fill `out` (a newInput()) for this tick. `steer` is an extra steer (tilt), driver-relative.
    sample(run, released, out, steer = 0) {
      const c = run.car, stage = thumbStage(run, released);
      const v = dhypot(c.vel.x, c.vel.y, c.vel.z);
      const press = st.pressed; st.pressed = false;
      out.assist = 1; out.manual = 0;
      st.live = false;
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
        if (st.held) {
          out.level = 1;
          // AIM: only roof up (a roll command upside down would stop LAND's roll-out), faded out over
          // the set-down; on the Show along the run only once the row is well behind.
          up(c, uw);
          const h = c.pos.y - SPEC.comHeight;
          const k = Math.max(0, Math.min(1, (h - THUMB.aimFloor) / THUMB.aimFade));
          if (uw.y > 0.94 && k > 0) {
            const clear = rowBehind(run, c);
            if (clear) out.pitch = k * THUMB.aimPitch * shape(st.ay);
            // Sideways: anywhere, unless the slide would carry the car in against a parked flank on the
            // way down (the Show). LAND holds a floor over the roofs it is above, but low beside the row a
            // slide back in met the semi's corner (scripts/human-phone.mjs); flankAhead projects it.
            let roll = k * THUMB.aimRoll * shape(st.ax);
            if (roll !== 0 && run.course === 'show' && !clear) {
              forward(c, fw);
              // The push: the slide's, plus the bank the car already has (the lift leans with it).
              if (flankAhead(c, roll * -fw.z * AIM_ACC + 9.81 * uw.x)) roll = 0;
            }
            st.live = true;
            out.roll = roll;
          }
        }
      } else if (stage === 'landed') {
        out.brake = 1;
      }
      st.wasStage = stage;
      return out;
    },
  };
}

// The pad's sight (src/thumb-aim.js draws it; scripts read it the same way): the mark from the predicted
// touchdown (`pr`, src/sim/predict.js), in px on the pad, in the car's own frame (x right, y DOWN the
// glass, so up = further along its nose), clamped inside the ring. A thumb put on it slides
// AIM_PX_PER_M × the miss: a full command (THUMB.aimPx) for an 8 m miss.
export const AIM_PX_PER_M = 6, AIM_R = 44;
const mfw = { x: 0, y: 0, z: 0 };
export function markOffset(c, pr, course, out = { x: 0, y: 0, m: 0 }) {
  const pad = (COURSES[course] || COURSES.show).pad;
  forward(c, mfw);
  const ez = pad.z - pr.landZ, ex = pad.x - pr.landX;
  const along = ez * mfw.z + ex * mfw.x, side = ez * mfw.x - ex * mfw.z;
  let x = side * AIM_PX_PER_M, y = -along * AIM_PX_PER_M;
  const d = dhypot(x, y, 0);
  if (d > AIM_R) { x *= AIM_R / d; y *= AIM_R / d; }
  out.x = x; out.y = y; out.m = dhypot(ez, ex, 0);
  return out;
}
