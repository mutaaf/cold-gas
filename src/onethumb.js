// One-thumb Assist: the Show (and the Wall, and the Lineup: 0181) on a single control, for a phone held in one hand.
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
//                  0164: sideways the slide is a place: X px moves the touchdown ≈ X / 6 m the way slid (inside the pad's
//                  outer ring), flown by LAND's own hold-the-line law, and the sight lays the mark out from the same place.
//   touchdown      it brakes to a stop on its own.
//
// It writes ordinary sim inputs (assist = 1), sampled once per 240 Hz tick, so the input log
// quantises, packs and replays bit-exactly like any other run (src/sim/run.js). Nothing here reads
// the DOM: scripts/human-phone.mjs flies it in Node with the same code the page runs.
import { wallProgress } from './sim/run.js';
import { dhypot } from './sim/dmath.js';
import { up, forward, CAR, bodyRates, G } from './sim/vehicle.js';
import { REVEAL } from './sim/autopilot.js';
import { SPEC } from './sim/spec.js';
import { COURSES } from './sim/courses.js';
import { predict, newPrediction } from './sim/predict.js';
import { rotate } from './sim/m3.js';

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
// 0164: the sideways slide's loop (sample's AIM). LAND's hold-the-line (vehicle.js flightComputer) banks HOLD_K rad
// per m/s of the body's sideways velocity, up to 0.2 rad, with the stick centred; a roll command r on LAND's level
// law holds a bank of r · kp · RATE.z / ((kp + LEVEL_DAMP) · LEVEL_K), so a bank b is r = HOLD_ROLL · b. The hold
// takes a drift v off in about 1 / (g · HOLD_K) = 1.46 s, and the car carries ≈ v · τ · (1 − e^(−t/τ)) further in t s
// (`lead`, Padé: t / (1 + t / 2τ), no exp: the input log must come out bit-exact in Swift too). τ = HOLD_TAU = 1.8 s
// matches where the hold really sets the car down (measured over the held-slide sweeps, tests/unit/thumb-mastery
// .test.js: at 1.46 the Show's no-slide touchdown read 1 m right of where it lands, at 2.2+ the Wall's read past it).
// The slide flies the same law, AIM_GAIN times as stiff and up to AIM_BANK rad (the old full roll, 0.45), about the
// drift that ends at its place. The place stays AIM_RING m inside the mark's side (the outer ring is 7 m); AIM_TGO s
// is the least time to go it plans over.
const HOLD_K = 0.07, HOLD_ROLL = (3 * 2) / (1.6 * 4.6), HOLD_TAU = 1.8;
const AIM_RING = 6, AIM_TGO = 0.6, AIM_GAIN = 3, AIM_BANK = 0.55;
// 0164 (the critic's bounce: the tapped thumb, pressed again after a lift, slid the wrong way). `ref` read on the first
// roof-up tick of a car still rolling out reads the fall through the bank (13.3 m on the Wall against the ≈9 it reaches;
// Show +8 px landed 3.7 m left of no slide). The place is taken only once it has moved under REF_STEADY m/s over
// REF_WINS windows of REF_WIN ticks in a row (predict's time to go jitters tick to tick), and on the Show only once an inward
// slide has stopped waiting for the semi. Until then the sight stays live and the dot follows the place being read; the
// slide takes effect from there (≥ 0.2 s; the held thumb's ≈0.4 s, the tapped one's 0.8–0.9 s on the Wall).
// A hold that has slid keeps aiming roof up past AIM_UY_SLID (LAND's own line hold starts at 0.8): at a full slide the
// bank overshot 0.94, the aim dropped out and the line hold banked it back. And the bank's cap tapers from AIM_BANK at
// aimFloor + AIM_LOW_H (3.5 m) to AIM_LOW of it at 2.5 m, then holds (k fades the rest): a full
// bank low steals lift, and +48 px set down sooner, short of +36.
const REF_STEADY = 2, REF_WIN = 24, REF_WINS = 2, AIM_UY_SLID = 0.8, AIM_LOW = 0.5, AIM_LOW_H = 2;
// 0177 (the critic: the Wall's tapped thumb got half a slide). A hold pressed again in the air on the Wall comes roof up
// 2.1 s after the tap, 14 m up and falling at 16 m/s, still banked ≈ 12°, so the body-axis read takes ≈ 3.4 m/s of the
// fall for drift (`ref` 12.4 m against the ≈ 8 it settles to) and the settle above waited 0.75 s (to 4 m up) for it to
// stop moving: −24 and −48 px then landed in the same place, 3.3 m from no slide. That hold reads the place with only
// REF_LEAK of the fall through the bank (LAND's hold does bank against part of it: a fitted share, 0 read 1–2 m short and
// 0.4 too far on the 0.75 s line) and acts on its first roof-up tick. Its roll is never less, the way slid, than the bank
// LAND's own hold would fly (a roll switches the hold off, and a weaker one let the drift carry on: −8 px went 0.5 m
// right). The Show keeps the settle: its tapped thumb reaches, and its inward wait for the semi is tuned on it.
const REF_LEAK = 0.2, HOLD_BANK = 0.2, QUICK_MIN = 0.5;
// 0181: the Lineup's lift-off line (m before the marker, the reference's) and the least ground speed that commits to it.
const LIFT_EARLY = COURSES.lineup.lineupZ0 - 6.5 - COURSES.lineup.liftOffZ, LIFT_MIN_V = 3;
const lrates = { x: 0, y: 0, z: 0 };
const bx = { x: 0, y: 0, z: 0 }, X1 = { x: 1, y: 0, z: 0 };
// 0165: along the run (the Show) the slide is a place too. `refA` is predict's touchdown along the car's nose (LAND holds
// no line along the run, so the prediction is the place), read until the slide first leaves the dead zone up or down.
// X px moves it X / AIM_PX_PER_M m (up = further), kept AIM_RING m either side of the mark and never shorter than the
// row's far edge plus a car and ROW_MARGIN. The pitch closes the gap over the time to go (2·err / (tGo² · PITCH_ACC), a
// gain fitted on tests/unit/thumb-mastery.test.js's sweeps and scripts/human-phone.mjs's careful and sloppy thumbs:
// stiffer moved more but set careful thumbs down tilted), saturating at a full slide, and is out by PITCH_FLOOR m up
// (a pitched set-down costs the wheels' sync and the tilt). It acts only once the brake has turned the fall (in free
// fall predict reads the brake as starting now, ≈11 m short) and only while it can act both ways: off every roof (over
// one LAND holds ROOF_HOLD and predict reads short), and shorter has room (`shortRoom`). A further it could take
// earlier, with no way back, left sloppy thumbs 6 m long.
const PITCH_ACC = 5.5, SHORT_TOP = 1, PITCH_FLOOR = 2.5;
const SHOW_END = COURSES.show.rowFar - CAR.halfL - ROW_MARGIN;   // the nearest a shorter place may be (z)
// The Show's roofs the car hasn't passed yet and is over, or will be over sideways when it passes them: is its floor still
// clear of them (+ SHORT_TOP) when its back is past the last? (The no-slide flight passes beside the row's last two cars.)
function shortRoom(c, h) {
  const boxes = COURSES.show.boxes, hw = CAR.halfW + FLANK_PAD, hl = CAR.halfL + FLANK_PAD;
  let roof = -Infinity, end = Infinity;
  const tAll = Math.max(0, (c.pos.z - (COURSES.show.rowFar - hl)) / Math.max(0.5, -c.vel.z)), xEnd = c.pos.x + c.vel.x * tAll;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.minZ - hl >= c.pos.z) continue;   // passed
    if (Math.min(Math.abs(c.pos.x), Math.abs(xEnd)) >= b.maxX + hw && Math.sign(c.pos.x) === Math.sign(xEnd)) continue;   // beside it
    roof = Math.max(roof, b.maxY); end = Math.min(end, b.minZ - hl);
  }
  if (roof === -Infinity) return true;
  const tPass = (c.pos.z - end) / Math.max(0.5, -c.vel.z);
  return h + Math.min(0, c.vel.y) * tPass > roof + SHORT_TOP;
}
// 0165: is the car's footprint over a parked roof now? (LAND holds it over one, ROOF_HOLD, so predict's touchdown, which
// knows only the ground, reads short there.)
function overRoof(c) {
  const boxes = COURSES.show.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (Math.abs(c.pos.x) < b.maxX + CAR.halfW && c.pos.z > b.minZ - CAR.halfL && c.pos.z < b.maxZ + CAR.halfL) return true;
  }
  return false;
}
// A point's side in the car's frame: + = the car's right (the pad's sight's +x).
function sideOf(x, z, f) { return z * f.x - x * f.z; }
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
// 0164: in over the row, only once the tall roof is behind. LAND's altimeter reads a roof the footprint is over
// (vehicle.js landHeight) and brakes to ROOF_HOLD over it, so a car low over the semi's end stops there (4.1 m,
// held at 5.3) and carries ≈1.5 m further along the run. The thumb's own flight leaves the semi's end 0.16 m
// outside its edge, so a slide in toward the row's middle that started over the row put the car over that
// edge, low (0169's stop-and-drop). An inward slide waits until the car is past the tallest roof (the loop takes
// the whole move from there, as the reference pilot's late steer onto the pad does); an outward one never waits.
const TALL = COURSES.show.boxes.reduce((t, b) => (b.maxY > t.maxY ? b : t));
const tallAhead = (c) => c.pos.z > TALL.minZ - CAR.halfL;
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
  if (run.course === 'lineup') return 'climb';   // 0181: the run-up (no ledge on the Lineup)
  if (run.phase === 'ramp' && run.t.progress >= THUMB.tapAt) return 'ledge';
  return 'climb';
}

export function createOneThumb() {
  const st = { airPress: false, held: false, pressed: false, push: 0, drive: false, carried: false, landing: false, wasStage: 'idle', ax: 0, ay: 0, live: false, ref: NaN, steady: 0, ref0: NaN, win: 0, wait: false, slid: false, refA: NaN, slidA: false, pk: 0, braked: false, canA: false, lifting: false, burnt: false, rolled: false };
  const pr = newPrediction();
  const aim = { x: 0, y: 0 };
  return {
    // Pointer events: `pressed` latches a tap shorter than a tick until the next sample reads it.
    down() { st.held = true; st.pressed = true; st.ax = 0; st.ay = 0; st.ref = NaN; st.steady = 0; st.ref0 = NaN; st.slid = false; st.refA = NaN; st.slidA = false; },
    up() { st.held = false; st.ax = 0; st.ay = 0; st.ref = NaN; st.steady = 0; st.ref0 = NaN; st.slid = false; st.refA = NaN; st.slidA = false; },
    // The held thumb's slide from where it pressed, CSS px (+x right, +y up the glass).
    move(dx, dy) { if (st.held) { st.ax = dx / THUMB.aimPx; st.ay = dy / THUMB.aimPx; } },
    reset() { st.airPress = false; st.held = false; st.pressed = false; st.push = 0; st.drive = false; st.carried = false; st.landing = false; st.wasStage = 'idle'; st.ax = 0; st.ay = 0; st.live = false; st.ref = NaN; st.steady = 0; st.ref0 = NaN; st.slid = false; st.refA = NaN; st.slidA = false; st.pk = 0; st.braked = false; st.canA = false; st.lifting = false; st.burnt = false; st.rolled = false; },
    // 0164: where the sideways slide is measured from (m, the car's right +, along the car's own side axis), NaN
    // before this hold could aim.
    get ref() { return st.ref; },
    // 0165: where the up/down slide is measured from (m along the car's nose), NaN before this hold could aim.
    get refA() { return st.refA; },
    // 0165: whether the up/down slide can act this tick (markOffset's `canA`).
    get canA() { return st.canA; },
    // The held thumb's sideways slide, CSS px, as far as it counts (a full slide): where the pad draws the ink dot.
    get slidePx() { return Math.max(-1, Math.min(1, st.ax)) * THUMB.aimPx; },
    get held() { return st.held; },
    // 0129: the drive-off is under way (a tap on the ledge was taken; it lets go at the lip), and a press
    // the next tick hasn't read yet. The pad shows "Letting go" from either, on the frame of the tap.
    get driving() { return st.drive; },
    // 0181: the Lineup's lift-off has begun (committed), and its one turn is done.
    get lifting() { return st.lifting; },
    get rolled() { return st.rolled; },
    get pending() { return st.pressed; },
    // 0140: LAND is on for this flight (the thumb held it once), whether or not the thumb is down now.
    get landing() { return st.landing; },
    // The slide as the pad draws it: -1..1 each way, 0 inside the dead zone.
    get aim() { aim.x = shape(st.ax); aim.y = shape(st.ay); return aim; },
    // Whether the last tick could aim (held, in the air, roof up, high enough, the row allowing; 0164: not while an
    // inward slide waits for the semi to pass).
    get aimLive() { return st.live; },
    // 0164: how far roof up the sight shows (uw.y above this): a hold that has slid keeps aiming past 0.94.
    get aimUy() { return st.slid ? AIM_UY_SLID : 0.94; },
    // Fill `out` (a newInput()) for this tick. `steer` is an extra steer (tilt), driver-relative.
    sample(run, released, out, steer = 0) {
      const c = run.car, stage = thumbStage(run, released);
      const v = dhypot(c.vel.x, c.vel.y, c.vel.z);
      const press = st.pressed; st.pressed = false;
      if (press) st.airPress = stage === 'fly';   // 0177: this hold was pressed in the air (a tapped thumb's second press)
      out.assist = 1; out.manual = 0;
      st.live = false;
      // 0181: the Lineup's run-up and kickflip (the reference's, src/sim/autopilot.js lineupPilot). Held, it drives at
      // the reference's speed; let go, it brakes. At the lift-off line it lifts (committed: a thumb lifted past the line
      // can't stop short of the row), burns to the reference's apex and rolls one turn. In the air the thumb is LAND
      // and the slide, as on the Show; LAND's level waits for the roll to finish (it would roll the car out of it).
      let lineupLevel = true;
      if (run.course === 'lineup' && stage !== 'landed') {
        const L = REVEAL.lineup, lc = COURSES.lineup;
        // A hop on the run-up (a hard dead-man brake) is still the run-up: the kickflip starts only from the line.
        if (!st.lifting) {
          const vh = dhypot(c.vel.x, 0, c.vel.z);
          out.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25 + steer));
          // Past the line it commits once moving: a held thumb that stopped there drives up to LIFT_MIN_V first (a lift
          // from a standstill came down short of the row, or on it: the review of 0181).
          if (c.pos.z > lc.liftOffZ + LIFT_EARLY && vh > LIFT_MIN_V) st.lifting = true;
          else if (!st.held) { out.brake = 1; return out; }
          else {
            out.throttle = vh < L.speed ? 1 : 0;
            out.brake = vh > L.speed + 0.6 ? 0.4 : 0;
            return out;
          }
        }
        if (stage === 'climb') { out.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25)); out.lift = 1; return out; }   // lifting off
        bodyRates(c, lrates);
        const vy = c.vel.y, projected = c.pos.y + (vy > 0 ? (vy * vy) / (2 * G) : 0);
        if (!st.burnt) { if (projected < L.apex) out.lift = 1; else st.burnt = true; }
        if (!st.rolled && st.burnt) {
          const remaining = L.rolls * Math.PI * 2 - Math.abs(run.t.rollAccum), rate = Math.abs(lrates.z);
          if (remaining <= (rate * rate) / (2 * L.rollBrake) + 0.02) st.rolled = true;
          else { out.roll = -1; lineupLevel = false; }
        }
        if (!st.rolled) {
          if (st.held) st.landing = true;   // pressed or held in the roll: LAND comes on as it ends
          return out;
        }
      }
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
        // 0140: once the thumb has held LAND in this flight, LAND stays on to the ground, thumb or no
        // thumb: a flinch costs the slide, never the landing. Lifted mid-roll, the rate loop stopped the
        // car on its side, the down-jets braking the roll pushed it sideways, and it landed up to 21 m
        // off the mark; lifted in the set-down, the auto-land never armed (the fall was too short) and
        // it dropped at 6–7 m/s. A press takes the aim back from where the car is.
        if (st.held) st.landing = true;
        if (st.landing && lineupLevel) out.level = 1;
        // 0165: the brake has turned the fall (the sink is 0.5 m/s past its peak): from here predict's touchdown is
        // the flight's (in free fall it reads the brake as starting now, ≈11 m short on the Show).
        const sink = -c.vel.y;
        if (sink > st.pk) st.pk = sink;
        else if (st.pk > 4 && sink < st.pk - 0.5) st.braked = true;
        // Whether the up/down slide can act now, held or not (the sight draws the mark along the run only then). Once open
        // it stays open for the flight: the roofs are behind by then, and an edge read each tick made the dot blink.
        st.canA = run.course === 'lineup' ? c.pos.z > COURSES.lineup.lineupEnd + 1 : run.course !== 'show' || st.canA || (st.braked && (rowBehind(run, c) || (!overRoof(c) && shortRoom(c, c.pos.y - SPEC.comHeight))));
        if (st.held) {
          // AIM: only roof up (a roll command upside down would stop LAND's roll-out), faded out over
          // the set-down; on the Show along the run only once the brake has turned the fall, off the roofs (0165).
          up(c, uw);
          const h = c.pos.y - SPEC.comHeight;
          const k = Math.max(0, Math.min(1, (h - THUMB.aimFloor) / THUMB.aimFade));
          if (!(uw.y > (st.slid ? AIM_UY_SLID : 0.94) && k > 0) && !st.slid) { st.ref0 = NaN; st.steady = 0; }   // a window is ticks in a row
          else if (uw.y > (st.slid ? AIM_UY_SLID : 0.94) && k > 0) {
            const clear = rowBehind(run, c);
            // Sideways: anywhere, unless the slide would carry the car in against a parked flank on the
            // way down (the Show). LAND holds a floor over the roofs it is above, but low beside the row a
            // slide back in met the semi's corner (scripts/human-phone.mjs); flankAhead projects it.
            // 0164: sideways is a place, not a push (it was a roll held for 3 s: a cliff, either way at 12 px).
            // `ref` is where LAND's own hold would set the car down sideways (here, plus the drift it carries
            // while the hold takes it off), read until the slide leaves the dead zone. The slide moves that place
            // by AIM_PX_PER_M px a metre (kept inside the ring), and the roll flies the hold's law about the drift
            // that ends there: no slide is the computer's flight exactly, more slide is more move, the way slid.
            forward(c, fw);
            predict(c, Math.max(0, h), pr, st.landing);
            rotate(bx, c.quat, X1);
            const bs = sideOf(bx.x, bx.z, fw);   // the body's x axis is the car's left (−1) or right (+1)
            const vb = c.vel.x * bx.x + c.vel.y * bx.y + c.vel.z * bx.z;
            const tGo = Math.max(AIM_TGO, pr.tLand), lead = tGo / (1 + tGo / (2 * HOLD_TAU));
            const here = sideOf(c.pos.x, c.pos.z, fw);
            let roll = 0;
            st.wait = false;
            const sx = shape(st.ax);
            const quick = st.airPress && run.course === 'wall';   // 0177
            // Read until this hold first slides; after that a thumb back in the middle asks for `ref` itself (the place
            // the dot was laid out from), not for wherever the drift has got to.
            if (!st.slid || st.ref !== st.ref) {
              st.ref = here + (quick ? vb - (1 - REF_LEAK) * c.vel.y * bx.y : vb) * bs * lead;
              // How fast the place itself is still moving, over REF_WIN ticks (REF_STEADY).
              if (st.ref0 !== st.ref0) { st.ref0 = st.ref; st.win = 0; }
              else if (++st.win >= REF_WIN) {
                st.steady = Math.abs(st.ref - st.ref0) * (240 / REF_WIN) < REF_STEADY ? st.steady + 1 : 0;
                st.ref0 = st.ref; st.win = 0;
              }
            }
            if (sx !== 0 || st.slid) {
              const pad = (COURSES[run.course] || COURSES.show).pad, ps = sideOf(pad.x, pad.z, fw);
              const off = sx === 0 ? 0 : (Math.max(-1, Math.min(1, st.ax)) * THUMB.aimPx) / AIM_PX_PER_M;   // saturates at a full slide
              const want = off >= 0 ? Math.max(st.ref, Math.min(st.ref + off, ps + AIM_RING)) : Math.min(st.ref, Math.max(st.ref + off, ps - AIM_RING));
              const inward = (want - st.ref) * sideOf(c.pos.x, 0, fw) < 0;   // toward the course's centre line
              const wait = run.course === 'show' && inward && tallAhead(c);
              const settling = !st.slid && !quick && st.steady < REF_WINS;   // the sight stays live: the place is still being read
              if (wait) st.wait = true;   // the sight dims (aimLive), and `ref` is still read
              else if (sx !== 0 && !settling) st.slid = true;
              if (st.slid && (want !== st.ref || sx === 0) && !wait && !settling) {
                const vNeed = ((want - here) / lead) * bs;   // body-x m/s that carries it there
                const bMax = AIM_BANK * Math.max(AIM_LOW, Math.min(1, (h - THUMB.aimFloor) / AIM_LOW_H));
                let bank = Math.max(-bMax, Math.min(bMax, HOLD_K * AIM_GAIN * (vb - vNeed)));
                if (quick && sx !== 0) {   // 0177: never less than LAND's own hold, the way slid
                  const hold = Math.max(-HOLD_BANK, Math.min(HOLD_BANK, HOLD_K * vb));
                  bank = (want - st.ref) * bs > 0 ? Math.min(bank, hold) : Math.max(bank, hold);
                }
                roll = k * HOLD_ROLL * bank;
                if (Math.abs(roll) < 0.05) roll = 0;   // under 0.05 LAND holds the line itself
                // 0177 review: that hold's `ref` is an estimate (≈ 1 m either way), so it doesn't fly to it: a thumb back in
                // the middle, or a slide the ring leaves under QUICK_MIN m to move, hands the line back to LAND's own hold
                // (flown to `ref`, a 0.1 s twitch landed 1 m off, once 0.7 m the other way; the ring's edge, 0.26 m inward).
                if (quick && (sx === 0 || Math.abs(want - st.ref) < QUICK_MIN)) roll = 0;
              }
            }
            if (roll !== 0 && run.course === 'show' && !clear) {
              // The push: the slide's, plus the bank the car already has (the lift leans with it).
              if (flankAhead(c, roll * -fw.z * AIM_ACC + 9.81 * uw.x)) roll = 0;
            }
            // 0165: along the run, a place (see PITCH_ACC). It used to be a pitch held only once the row was 2.5 m
            // behind: on the Show that was a few ticks under 2.5 m up, so the slide up or down did nothing at all.
            let pitch = 0;
            if (run.course === 'lineup') {
              // 0181: along the run only once the row is behind (pitched back over it, the lift leaves the brake and
              // hovers over the roofs: LESSONS 2026-10-21, 0014).
              if (c.pos.z > COURSES.lineup.lineupEnd + 1) pitch = k * THUMB.aimPitch * shape(st.ay);
            } else if (run.course !== 'show') {
              if (clear) pitch = k * THUMB.aimPitch * shape(st.ay);   // the Wall: no row, the slide is the pitch (as 0121)
            } else if (st.canA) {
              const predA = pr.landX * fw.x + pr.landZ * fw.z;
              if (!st.slidA || st.refA !== st.refA) st.refA = predA;
              const sy = shape(st.ay);
              if (sy !== 0) st.slidA = true;
              if (st.slidA) {
                const pad = COURSES.show.pad, pa = pad.x * fw.x + pad.z * fw.z;
                const off = sy === 0 ? 0 : (Math.max(-1, Math.min(1, st.ay)) * THUMB.aimPx) / AIM_PX_PER_M;
                let want = off >= 0 ? Math.max(st.refA, Math.min(st.refA + off, pa + AIM_RING)) : Math.min(st.refA, Math.max(st.refA + off, pa - AIM_RING));
                want = Math.max(want, Math.min(st.refA, SHOW_END * fw.z));
                const err = want - predA, tGo = Math.max(AIM_TGO, pr.tLand);
                pitch = Math.max(-THUMB.aimPitch, Math.min(THUMB.aimPitch, (2 * err) / (tGo * tGo * PITCH_ACC)));
                pitch *= Math.max(0, Math.min(1, (h - PITCH_FLOOR) / THUMB.aimFade));
                if (Math.abs(pitch) < 0.02) pitch = 0;
              }
            }
            out.pitch = pitch;
            st.live = !st.wait;
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
// 0164: `ref` (a thumb's `ref`, NaN for none) is where the slide measures sideways from, so the sight lays the mark out
// sideways from the same place: a thumb held on the dot then lands on it, and the dot stays put while it gets there.
// 0165: along the run the mark is laid out from `refA` (a thumb's `refA`, NaN for none: from `pr`), and drawn only as far
// while the slide can act on it (`canA`, a thumb's `canA`), so the dot never asks for what the thumb can't do. `m` stays
// the whole miss.
export function markOffset(c, pr, course, out = { x: 0, y: 0, m: 0 }, ref = NaN, refA = NaN, canA = true) {
  const pad = (COURSES[course] || COURSES.show).pad;
  forward(c, mfw);
  const ez = pad.z - pr.landZ, ex = pad.x - pr.landX;
  const along = refA === refA ? pad.z * mfw.z + pad.x * mfw.x - refA : ez * mfw.z + ex * mfw.x, side = ref === ref ? sideOf(pad.x, pad.z, mfw) - ref : ez * mfw.x - ex * mfw.z;
  let x = side * AIM_PX_PER_M, y = canA ? -along * AIM_PX_PER_M : 0;
  const d = dhypot(x, y, 0);
  if (d > AIM_R) { x *= AIM_R / d; y *= AIM_R / d; }
  out.x = x; out.y = y; out.m = dhypot(side, along, 0);   // 0164: the miss (0165: the whole of it along, drawn or not)
  return out;
}
