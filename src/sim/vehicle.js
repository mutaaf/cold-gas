// The roadster, physics v2: a 6-DOF rigid body on four raycast-suspended wheels with slip-based
// tyres, a suction fan and ten cold-gas thrusters. It drives on any surface the course defines
// (src/sim/courses.js `surface()`): flat concrete, a vertical wall, or upside down under a ledge.
//
// Body frame: +x is the car's LEFT, +y up, +z forward (right-handed), origin at the centre of
// mass. Inputs are driver-relative: steer, roll and yaw are positive to the driver's right (−x),
// pitch is positive nose-down. Fixed step, no
// randomness, no wall clock: a run replays bit-exactly from its inputs (the Worker verifies
// scores this way). No allocation in step().
import { v3, q4, add, scale, addScaled, cross, dot, rotate, rotateInv, integrateQuat, quatFromYaw, clamp, set } from './m3.js';
import { SPEC, NOZZLE_SPEC, wheelAnchors, wheelRadiusOf, AXLE_F } from './spec.js';
import { surface, COURSES, DEFAULT_COURSE, MATERIALS, createWorld, stepWorld, pushBody } from './courses.js';
import { dsin, dcos, datan2, datan, dhypot } from './dmath.js';
import { createImpacts, pushImpact, HIT, SCRAPE, WHEEL, CRUSH, CRUSH_STEP, PART, SCRAPE_EVERY, HIT_MIN, SCRAPE_MIN, WHEEL_MIN } from './impacts.js';

export const DT = 1 / 240;
export const G = 9.81;
const RHO = 1.2;

// Suspension: rest length chosen so the car sits at SPEC.comHeight under its own weight.
// Fan cars run stiff (the suction alone is 2 g): ~3 cm static sag, 16 cm of travel to the bump stop.
const K_SPRING = 150000, C_DAMP = 9500, BUMP = 600000, TRAVEL = 0.16;
const WHEEL_I = 1.35;                         // kg·m² per wheel (22" forged + tyre + disc)
const STATIC_LOAD = ((SPEC.dryMass + SPEC.gasMass) * G) / 4;
const MOUNT_TO_CENTRE = 0.24;                 // at rest (spec.js wheelAnchors)
const REST_LEN = MOUNT_TO_CENTRE + STATIC_LOAD / K_SPRING;
// Each axle's springs and dampers are rated to the weight it carries (42 : 58 front:rear), so the
// car sits level with the same sag front and rear, like a real one set up on corner scales.
const FRONT_SHARE = (SPEC.wheelbase - SPEC.comFromFront) / SPEC.wheelbase;
const AXLE_K = [0, 1, 2, 3].map((i) => 2 * (i < 2 ? FRONT_SHARE : 1 - FRONT_SHARE));
const RW = [0, 1, 2, 3].map(wheelRadiusOf);    // staggered: 20" front, 21" rear
// Pacejka coefficients (peak at κ ≈ 0.10, α ≈ 8.4°): semi-slicks. Cornering stiffness B·C·D ≈ 21.6·μFz
// (≈160 kN/rad per tyre at static load), crisp like a track tyre.
const BX = 11.5, CX = 1.65, BY = 16, CY = 1.35;

export const CAR = {
  dryMass: SPEC.dryMass, airMass: SPEC.gasMass, isp: SPEC.ispFull,
  halfW: SPEC.width / 2, halfL: SPEC.length / 2,
  maxTravel: TRAVEL, restLen: REST_LEN, wheelR: SPEC.wheelRadius, mountToCentre: MOUNT_TO_CENTRE,
};

export const NOZZLES = NOZZLE_SPEC.map((n) => {
  const pos = v3(...n.pos), dir = v3(...n.dir);
  return { ...n, pos, dir, torque: cross(v3(), pos, dir) };
});

const WHEELS = wheelAnchors().map((a) => v3(...a));
// Lift trim: the down-jets don't sit symmetrically about the CoM, so each one's share of a pure
// lift command is scaled until the four make no pitch or roll moment (the nozzle farthest out
// runs leaner). Attitude commands ride on top.
const TRIM = (() => {
  const lift = NOZZLE_SPEC.filter((n) => n.group === 'lift');
  const zf = Math.max(...lift.map((n) => n.pos[2])), zr = Math.min(...lift.map((n) => n.pos[2]));
  return NOZZLE_SPEC.map((n) => (n.group !== 'lift' ? 1 : n.pos[2] > 0 ? Math.min(1, -zr / zf) : Math.min(1, zf / -zr)));
})();
// Rotational air drag coefficients (N·m·s²), body axes x = pitch, y = yaw, z = roll (see step()).
const ROT_DRAG = (() => {
  const rho = 1.2, cd = 1.2, hl = SPEC.length / 2, hw = SPEC.width / 2;
  const hl4 = hl * hl * hl * hl, hw4 = hw * hw * hw * hw;   // (no ** in the sim: engines may round it differently)
  return { x: (rho * cd * SPEC.width * hl4) / 4, y: (rho * cd * SPEC.height * hl4) / 4, z: (rho * cd * SPEC.length * hw4) / 4 };
})();
const LIFT_MAX = NOZZLE_SPEC.reduce((a, n, i) => a + (n.group === 'lift' ? n.max * TRIM[i] : 0), 0);
const DRIVEN = [false, false, true, true];

// Hull probe points (body frame): the faceted body's corners, sills, roof and nose/tail, and
// which part of the body each one is (impact events say what was hit).
const HULL = [], HULL_PART = [];
{
  const hw = SPEC.width / 2 - 0.04;
  const zf = AXLE_F + SPEC.overhangFront - 0.05;
  const zr = zf - SPEC.length + 0.1;
  // Floor probes sit 5 cm above the floor: the fan's sliding skirts touch first and are compliant.
  const yb = -(SPEC.comHeight - SPEC.rideHeight) + 0.05, yt = SPEC.height - SPEC.comHeight - 0.05;
  // Approach and departure angles: the nose's underside sits 15 cm above the floor, the
  // diffuser's trailing edge 20 cm.
  const yNose = yb + 0.15, yTail = yb + 0.2;
  for (const x of [-hw, hw]) {
    HULL.push(v3(x, yNose, zf), v3(x, yb, (zf + zr) / 2), v3(x, yTail, zr), v3(x, yb, zf - 0.9), v3(x, yb, zr + 0.9));
    HULL_PART.push(PART.nose, PART.floor, PART.tail, PART.floor, PART.floor);
    for (const z of [zf, (zf + zr) / 2, zr]) { HULL.push(v3(x * 0.8, yt * 0.55, z * 0.9)); HULL_PART.push(PART.side); }
  }
  HULL.push(v3(0, yt, -0.2), v3(0, yNose, zf), v3(0, yTail, zr), v3(0, yt * 0.4, zf + 0.04), v3(0, yt * 0.6, zr - 0.02));
  HULL_PART.push(PART.roof, PART.nose, PART.tail, PART.nose, PART.tail);
}
export { HULL, HULL_PART };

// Bodywork contact: elastic up to the structure's yield, then it crushes and stays crushed.
// Each hull probe stands for a patch of structure. ESTIMATES from crash-test numbers:
//  - Yield ≈100 kN per probe. A full-frontal rigid-barrier test at 56 km/h crushes a 1.5–2 t
//    car's front ≈0.6–0.7 m: mean force m·v²/2d ≈ 350–400 kN over the ≈4 probes a nose engages.
//    Roofs are held to ≥3× vehicle weight within 127 mm of platen travel (FMVSS 216, upgraded
//    2009): ≈72 kN for this car on one side of the roof; the best roofs reach 4–5×.
//  - Elastic slope 1.2 MN/m per probe: ≈8 cm of give before it yields (sheet metal over the
//    tub springs back that much, then folds). The old fully elastic 0.3 MN/m let a hard hit sink
//    the body 0.3–0.5 m into the ground and then fired it back out like a trampoline.
//  - Crush is plastic: a folded panel stays folded, so a hard hit returns only the elastic part
//    (restitution ≈0.1–0.3 at crash speeds, as crash tests measure, not ≈0.5 from a spring).
//    A probe can crush at most 0.35 m (behind that is the battery tub and the cabin cell).
//  - The floor is different: its probes stand for the sliding skirts and the flat pan over the
//    battery, which ride on the deck under suction. They stay compliant (0.3 MN/m) and don't fold.
const HULL_K = 1.2e6, HULL_C = 16000, HULL_YIELD = 1.0e5, CRUSH_MAX = 0.35;
const FLOOR_K = 300000, FLOOR_C = 11000;
const PROBE_K = HULL_PART.map((p) => (p === PART.floor ? FLOOR_K : HULL_K));
const PROBE_C = HULL_PART.map((p) => (p === PART.floor ? FLOOR_C : HULL_C));
const PROBE_YIELD = HULL_PART.map((p) => (p === PART.floor ? Infinity : HULL_YIELD));
const FLOOR = v3(0, -(SPEC.comHeight - SPEC.rideHeight), 0);

// Advanced mode: one valve channel per nozzle, in NOZZLE_SPEC order (`manual` = 1 bypasses the
// mixer and the flight computer; the valves go straight to the nozzles).
export const VALVE_KEYS = NOZZLE_SPEC.map((_, i) => `v${i}`);
export const newInput = () => {
  const inp = { throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1, manual: 0 };
  for (const k of VALVE_KEYS) inp[k] = 0;
  return inp;
};
// Flight tiers. Assist: the computer holds rates, LAND levels and governs the descent, and it
// limits the crawl up the curl and the carry off the ledge. Pro: the stick still commands body
// rates, but there is no LAND governor and nothing limits you. Advanced: per-valve, no computer.
export const tierOf = (inp) => (inp.assist ? 'assist' : inp.manual ? 'advanced' : 'pro');
// Assist's limits. CRAWL: drive torque is cut above this speed while the tyres are on the curl
// (the cue says crawl; a keyboard's full throttle throws the car off the ledge at ≈24 m/s).
// CARRY: airborne, the rear jets cut out above this horizontal speed (≈10 m/s carries over the
// row onto the pad; one reaction time of 80 kN on 2.4 t adds ≈10 m/s more).
export const ASSIST_CRAWL = 8, ASSIST_CARRY = 10;

export function createVehicle(courseId = DEFAULT_COURSE) {
  // A course id, or a course object (Free Drive's roads aren't in COURSES).
  const course = typeof courseId === 'object' ? courseId : COURSES[courseId] || COURSES[DEFAULT_COURSE];
  const s = {
    course, tick: 0, world: createWorld(course),
    pos: v3(course.start.x, SPEC.comHeight, course.start.z), vel: v3(), quat: quatFromYaw(q4(), 0), angVel: v3(), angMom: v3(),
    air: CAR.airMass,
    throttles: new Float64Array(NOZZLES.length),
    wheels: WHEELS.map(() => ({ contact: true, compression: REST_LEN - MOUNT_TO_CENTRE, prevCompression: REST_LEN - MOUNT_TO_CENTRE, omega: 0, spin: 0, steer: 0, slip: 0, slipAngle: 0, load: STATIC_LOAD, nx: 0, ny: 1, nz: 0 })),
    fan: 0, fanDemand: 0, fanForce: 0, gripSat: 0, floorGap: SPEC.rideHeight,
    hullContact: false, hullGround: false, obstacleContact: false, obstacleSpeed: 0, hullImpulse: 0,
    steer: 0, grounded: 4, onWall: false, onSlope: false, wheelForce: 0, tcActive: false,
    // Crash state: each hull probe's permanent crush (m), its contact last tick, and the run's
    // impact events (src/sim/impacts.js).
    crush: new Float64Array(HULL.length), crushShown: new Float64Array(HULL.length), touch: new Uint8Array(HULL.length), impacts: createImpacts(),
  };
  return s;
}

export const massOf = (s) => CAR.dryMass + Math.max(0, s.air);

// Nozzle feed pressure as a fraction of full. The tanks expand adiabatically (p ∝ m^1.375,
// γ ≈ 1.4 for N2); a regulator holds the feed at line pressure until the tanks drop below it.
export function feedPressure(s) { return pressureOf(s.air); }
export function pressureOf(air) {
  const rG = Math.max(0, air) / CAR.airMass;
  const tank = rG * Math.sqrt(Math.sqrt(rG)) * Math.sqrt(Math.sqrt(Math.sqrt(rG)));
  return Math.min(1, tank / SPEC.regulatedFraction);
}

// Scratch (never reallocated).
const tmp = v3(), tmp2 = v3(), r = v3(), pw = v3(), vp = v3(), force = v3(), fwd = v3(), right = v3(), upW = v3(),
  fTot = v3(), tTot = v3(), wb = v3(), Lb = v3(), cmdT = v3(), dn = v3(), hitN = v3(), wf = v3(), wl = v3(), worldUpB = v3(), rp = v3();
const sn = { x: 0, y: 0, z: 0, obstacle: false, body: null, mat: MATERIALS.concrete };
let hitBody = null, hitMat = MATERIALS.concrete;
const target = new Float64Array(NOZZLES.length);
// The strongest new hit / slide / tyre slam this tick: [speed, x, y, z, nx, ny, nz, probe, body, crush].
const evHit = new Float64Array(10), evScr = new Float64Array(10), evWheel = new Float64Array(10);
function keep(ev, speed, p, n, probe, body, crush) {
  ev[0] = speed; ev[1] = p.x; ev[2] = p.y; ev[3] = p.z; ev[4] = n.x; ev[5] = n.y; ev[6] = n.z; ev[7] = probe; ev[8] = body; ev[9] = crush;
}
const bodyIndex = (s, b) => (b ? s.world.bodies.indexOf(b) : -1);
const eff = { lift: 0, thrust: 0 };

function pointVel(out, s, rw) { cross(out, s.angVel, rw); return add(out, out, s.vel); }
function applyAt(rw, f) { add(fTot, fTot, f); cross(tmp2, rw, f); add(tTot, tTot, tmp2); }
const phiAt = (s, p) => surface(s.course, p.x, p.y, p.z, sn, s.world);
const hitFrom = () => { set(hitN, sn.x, sn.y, sn.z); hitBody = sn.body; hitMat = sn.mat; };

// March a ray from `o` along unit `d` up to `maxT`; the first distance where it enters a solid
// (or -1), with the hit normal left in hitN.
function raycast(s, o, d, maxT) {
  let prevT = 0, prevPhi = phiAt(s, o);
  if (prevPhi <= 0) { hitFrom(); return 0; }
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const t = (maxT * i) / steps;
    addScaled(rp, o, d, t);
    const phi = phiAt(s, rp);
    if (phi <= 0) {
      // Bracketed: a few bisections, then a secant step on the (locally linear) distance field
      // for a sub-micron hit, so the damper never sees quantisation noise.
      let lo = prevT, hi = t, pLo = prevPhi, pHi = phi;
      for (let k = 0; k < 5; k++) {
        const mid = (lo + hi) / 2;
        addScaled(rp, o, d, mid);
        const pm = phiAt(s, rp);
        if (pm <= 0) { hi = mid; pHi = pm; } else { lo = mid; pLo = pm; }
      }
      const th = pLo - pHi > 1e-12 ? lo + ((hi - lo) * pLo) / (pLo - pHi) : hi;
      addScaled(rp, o, d, th);
      phiAt(s, rp);
      hitFrom();
      return th;
    }
    prevT = t; prevPhi = phi;
  }
  return -1;
}

// Mixer: pilot command → valve targets. Attitude has priority over lift (quadcopter-style).
export function mix(cmd, torqueCmd, out) {
  let maxDelta = 0;
  for (let i = 0; i < NOZZLES.length; i++) {
    const t = NOZZLES[i].torque;
    const d = (t.x * torqueCmd.x + t.y * torqueCmd.y + t.z * torqueCmd.z) * 2.0;
    out[i] = d;
    if (NOZZLES[i].group === 'lift' && d > maxDelta) maxDelta = d;
  }
  const liftBase = Math.min(cmd.lift, 1 - Math.min(1, maxDelta));
  for (let i = 0; i < NOZZLES.length; i++) {
    const g = NOZZLES[i].group;
    const base = g === 'lift' ? liftBase * TRIM[i] : g === 'rear' ? cmd.thrust : 0;   // yaw jets: attitude only
    out[i] = clamp(base + out[i], 0, 1);
  }
  return out;
}

// Flight computer. Assist and Pro: the stick commands body rates. Assist's LAND also levels the
// car, as a body-rate demand toward upright on top of the rate loop: 2 × the tilt's sine near
// level, the law the reference runs were tuned on. Upside down that law asks for almost nothing
// (sin 180° = 0), so a player who held LAND inverted rolled out at ≈0.5 rad/s and hit the ground
// still rolling; and from 90° it crawled, braking with half its thrust going sideways. LAND now
// rolls out decisively: inverted, the nearer way round at 2 rad/s per radian of tilt with the pitch
// rate held (correcting pitch too would start a half-loop that fights the roll); banked past 20°,
// 3 rad/s per radian of bank; both up to the stick's 4.6 rad/s (the reveal: 180° in ≈1.1 s).
const RATE = v3(2.4, 1.4, 4.6);
const LEVEL_K = 2, LEVEL_DAMP = 1.4;
// Banked past ≈20° (cos 20° = 0.94), the roll-out keeps going at 3 rad/s per radian of bank.
const UPPER_ROLL = 0.94, UPPER_K = 3;
function flightComputer(s, inp, out, envelope = 1) {
  rotateInv(wb, s.quat, s.angVel);
  const kp = 1.6, k = envelope;
  set(out, kp * (inp.pitch * k * RATE.x - wb.x), kp * (-inp.yaw * RATE.y - wb.y), kp * (inp.roll * k * RATE.z - wb.z));
  if (inp.assist && inp.level) {
    rotateInv(worldUpB, s.quat, set(tmp, 0, 1, 0));
    const ux = worldUpB.x, uy = worldUpB.y, uz = worldUpB.z;
    // Pitch correction is +u.z, roll correction is −u.x (LESSONS: level-controller signs).
    let wantX = LEVEL_K * uz, wantZ = -LEVEL_K * ux;
    // Hold the line: roof up, above the set-down, with the stick centred, LAND banks up to 0.2 rad
    // (≈11°) against sideways drift. Rolling out from inverted on one side's down-jets kicks the car
    // sideways several m/s, and a player can't see it until they've landed 30 m off the mark. The
    // carry along the run (the row, the mark) stays the pilot's to manage.
    if (uy > 0.8 && Math.abs(inp.roll) < 0.05 && s.pos.y - SPEC.comHeight > HOVER + 1.5) {
      rotateInv(tmp, s.quat, s.vel);
      wantZ = -LEVEL_K * (ux - clamp(0.07 * tmp.x, -0.2, 0.2));
    }
    if (uy < -0.2 && Math.abs(uz) < 0.7) {
      const tilt = datan2(dhypot(ux, uz), uy);
      wantX = 0;
      wantZ = clamp((ux >= 0 ? -1 : 1) * LEVEL_K * tilt, -RATE.z, RATE.z);
    } else if (uy < UPPER_ROLL && Math.abs(ux) > Math.abs(uz) && Math.abs(inp.roll) < 0.05) {
      // Still banked past ≈20°: keep rolling at the reveal's pace (an angle law), not the sine
      // law's crawl, so the down-jets aren't braking sideways for the last half of the roll-out.
      wantZ = clamp((ux >= 0 ? -1 : 1) * UPPER_K * datan2(Math.abs(ux), uy), -RATE.z, RATE.z);
    }
    out.x += (kp + LEVEL_DAMP) * wantX - LEVEL_DAMP * wb.x;
    out.z += (kp + LEVEL_DAMP) * wantZ - LEVEL_DAMP * wb.z;
  }
  out.x = clamp(out.x, -1, 1); out.y = clamp(out.y, -1, 1); out.z = clamp(out.z, -1, 1);
  return out;
}

function record(imp, tick, kind, part, ev) {
  pushImpact(imp, tick, kind, part, ev[7], ev[8], ev[1], ev[2], ev[3], ev[4], ev[5], ev[6], ev[0], ev[9]);
}

// Assist's governors, on top of the pilot's commands (writes `eff`).
//  - LAND: lift is governed so the sink rate eases to a soft touchdown on the ground below.
//  - CARRY: airborne, the rear jets fade out as the horizontal speed nears ASSIST_CARRY, and shut
//    while LAND brakes.
export const HOVER = 1.3;
let behind = 0;   // m/s the car is falling faster than the LAND profile wants (0 when not governed)
function governor(s, inp, grounded, m) {
  eff.lift = inp.lift; eff.thrust = inp.thrust;
  behind = 0;
  if (!inp.assist || grounded > 0) return;
  if (eff.thrust > 0) {
    const vh = dhypot(s.vel.x, s.vel.z);
    eff.thrust *= clamp((ASSIST_CARRY - vh) / 1.5, 0, 1);
  }
  if (!inp.level || s.air <= 0) return;
  const h = Math.max(0, s.pos.y - SPEC.comHeight - 0.05);
  // Plan the braking from the thrust the down-jets can actually make at today's tank pressure
  // (blowdown halves it fast), then brake late and hard like the reveal (3.3 G peak at ≈6 m).
  const aPlan = brakePlan(s, m);
  // Brake to a low hover (as the reveal did), then set down at walking pace: time to level.
  let wantVy = h > HOVER ? -Math.max(0.6, Math.min(16, Math.sqrt((h - HOVER) * 2 * aPlan))) : -0.55;
  if (h < HOVER + 1.5 && upW.y < 0.99) wantVy = Math.max(wantVy, -0.25);
  behind = wantVy - s.vel.y;
  // The brake has priority: once LAND is braking (or below 8 m), a thumb left on BOOST no longer
  // drains the gas the stop needs.
  if (behind > 0 || h < 8) eff.thrust = 0;
  if (s.vel.y < wantVy && upW.y > 0.55) eff.lift = Math.max(eff.lift, clamp((wantVy - s.vel.y) * 0.8 + 0.55, 0, 1));
}
// Net upward deceleration the four down-jets can make right now (m/s², trimmed, level), and the
// governor's plan: half of it (pressure can still fall during the burn). The HUD reads these too.
export const brakeAvail = (s, m = massOf(s)) => (LIFT_MAX * feedPressure(s)) / m - G;
// The stop itself drains the tanks: stopping from v m/s at a m/s² costs an impulse m·(v + g·v/a)
// (≈70 kg of nitrogen from 15 m/s), and below 65 % gas the regulator can't hold line pressure.
// So the plan is the lesser of half of today's braking and all of what's left at the end of the
// stop: the jets that finish the landing are the weaker ones. (Planning on today's pressure alone
// arrived at the hover height still sinking 3–4 m/s once the tanks had blown down.)
export function gasToStop(s, m = massOf(s), vy = s.vel.y) {
  const v = Math.max(0, -vy), a = Math.max(1, brakeAvail(s, m));
  return (m * (v + (G * v) / a)) / (SPEC.ispFull * 0.9 * G);
}
export function brakeAvailAtEnd(s, m = massOf(s)) {
  const used = gasToStop(s, m);
  return (LIFT_MAX * pressureOf(s.air - used)) / (m - used) - G;
}
export const brakePlan = (s, m = massOf(s)) => clamp(Math.min(brakeAvail(s, m) * 0.5, brakeAvailAtEnd(s, m)), 0.6, 9);
export { LIFT_MAX, TRIM };

// The flight computer end to end: the pilot's commands → governors → rate loop → mixer → valve
// targets. `step` runs it every tick in Assist and Pro.
function computerTargets(s, inp, grounded, m, out) {
  governor(s, inp, grounded, m);
  // Envelope protection (Assist, LAND): falling faster than the profile, the stick can't tilt
  // away the lift the stop needs (2.5 m/s behind it keeps a quarter of its authority).
  const envelope = inp.assist && inp.level && grounded === 0 ? clamp(1 - (behind - 0.5) / 2, 0.25, 1) : 1;
  flightComputer(s, inp, cmdT, envelope);
  if (grounded >= 2) { cmdT.x = 0; cmdT.y = 0; cmdT.z = 0; }
  return mix(eff, cmdT, out);
}
// The same, from outside a step, on the car as it stands: the valves the computer would open now.
// The Advanced reference pilot flies these by hand (src/sim/autopilot.js); a player never sees it.
export function computerValves(s, inp, out) {
  rotate(upW, s.quat, set(tmp, 0, 1, 0));
  return computerTargets(s, inp, s.grounded, massOf(s), out);
}

export function step(s, inp) {
  const dt = DT;
  const m = massOf(s);
  set(fTot, 0, -m * G, 0);
  set(tTot, 0, 0, 0);
  rotate(fwd, s.quat, set(tmp, 0, 0, 1));
  rotate(right, s.quat, set(tmp, 1, 0, 0));
  rotate(upW, s.quat, set(tmp, 0, 1, 0));
  scale(dn, upW, -1);

  // --- Steering (steer-by-wire: rate-limited, speed-sensitive) ---
  // Full lock is 0.5 rad at parking speed. At speed the rack is scaled so full stick asks for
  // the tyres' peak grip and no more: the kinematic angle for μg of lateral acceleration (L·μg/v²)
  // plus 0.04 rad, the lock that measured the most steady cornering g at 12, 25 and 40 m/s. Every
  // bit of stick travel is usable, and a full-stick flick at 200 km/h can't saw the front axle
  // into understeer.
  const speed = dhypot(s.vel.x, s.vel.y, s.vel.z);
  const vSq = Math.max(1, s.vel.x * s.vel.x + s.vel.z * s.vel.z);
  const lock = Math.min(0.5, (SPEC.wheelbase * SPEC.tyreMu * G) / vSq + 0.04);
  const steerTarget = -inp.steer * lock;        // driver's right is −x
  s.steer += clamp(steerTarget - s.steer, -2.2 * dt, 2.2 * dt);

  // --- Suction fan: pulls the floor toward whatever surface is under it ---
  rotate(r, s.quat, FLOOR);
  add(pw, s.pos, r);
  const gapT = raycast(s, pw, dn, 0.6);
  s.floorGap = gapT < 0 ? Infinity : gapT;
  // Armed, the controller asks for the suction the deck's tilt needs (SPEC: the law and its
  // margins), and holds it: a demand rises at once but decays over fanHold. The fan spools to
  // the demand; disarmed, the skirts unseal and the suction dumps.
  const armed = clamp(inp.fan, 0, 1);
  if (armed > 0) {
    if (gapT >= 0) {
      const ny = clamp(hitN.y, -1, 1), sinT = Math.sqrt(1 - ny * ny);
      const need = clamp(m * G * ((SPEC.fanGrip * sinT) / SPEC.tyreMu + SPEC.fanContact * (1 - ny) + SPEC.fanHang * Math.max(0, -ny)), SPEC.fanIdleForce, SPEC.fanMaxForce);
      s.fanDemand = Math.max(need / SPEC.fanMaxForce, s.fanDemand + (need / SPEC.fanMaxForce - s.fanDemand) * (dt / SPEC.fanHold));
    } else s.fanDemand -= s.fanDemand * (dt / SPEC.fanHold);
  } else s.fanDemand = 0;
  // Full throttle, or a full stop on the move, asks the tyres for everything: below 50 mph the
  // fan fills the grip void up to the cap. Held only (over fanGripTime): a crawl's throttle blips
  // don't count. Floored up the curl that is the grip the climb needs (the attitude law alone
  // is tuned to the reveal's crawl, and full torque on it spins the rears to a stall).
  const allIn = speed < SPEC.fanVoidSpeed && (inp.throttle >= 0.9 || (inp.brake >= 0.9 && speed > 2)) ? 1 : 0;
  s.gripSat += (allIn - s.gripSat) * (dt / SPEC.fanGripTime);
  const fanTarget = armed * Math.max(s.fanDemand, clamp(2 * s.gripSat - 1, 0, 1));
  s.fan += (fanTarget - s.fan) * Math.min(1, dt / (fanTarget > s.fan ? SPEC.fanSpool / Math.LN10 : SPEC.fanDump));
  // Skirts drop to seal; past their reach the leak grows and suction falls off fast.
  const leak = gapT < 0 ? Infinity : Math.max(0, gapT - SPEC.fanSkirtReach) / SPEC.fanGapScale;
  s.fanForce = gapT < 0 ? 0 : (s.fan * SPEC.fanMaxForce) / (1 + leak * leak);
  if (s.fanForce > 0) { scale(force, dn, s.fanForce); applyAt(r, force); }

  // --- Wheels: raycast suspension + Pacejka tyres + wheel spin ---
  let grounded = 0, wallContact = false, sloped = false, wheelForce = 0;
  s.hullContact = false; s.hullGround = false; s.obstacleContact = false;
  s.tcActive = false;
  evHit[0] = 0; evScr[0] = 0; evWheel[0] = 0;
  for (let i = 0; i < 4; i++) {
    const w = s.wheels[i];
    rotate(r, s.quat, WHEELS[i]);
    add(pw, s.pos, r);
    w.prevCompression = w.compression;
    const wasContact = w.contact;
    w.contact = false;
    const R = RW[i];
    const maxT = REST_LEN + R;
    const t = raycast(s, pw, dn, maxT);
    if (t < 0) {
      w.compression = 0; w.load = 0;
      // Free wheel: driven wheels spin up under throttle, brakes stop them.
      if (DRIVEN[i]) w.omega += ((inp.throttle * 600) / WHEEL_I) * dt;
      if (inp.brake > 0) w.omega *= 0.9;
      w.omega *= 0.999;
      w.spin += w.omega * dt;
      continue;
    }
    w.contact = true; grounded++;
    if (hitBody) s.obstacleContact = true;      // a tyre on a parked car is contact
    if (hitN.y < 0.85) wallContact = true;
    if (hitN.y < 0.995) sloped = true;
    w.nx = hitN.x; w.ny = hitN.y; w.nz = hitN.z;
    const comp = maxT - t;
    w.compression = Math.min(comp, REST_LEN + R);
    const compRate = (w.compression - w.prevCompression) / dt;
    let fs = AXLE_K[i] * (K_SPRING * Math.min(comp, REST_LEN) + C_DAMP * compRate);
    const over = comp - (REST_LEN - MOUNT_TO_CENTRE + TRAVEL);
    if (over > 0) fs += BUMP * over;
    fs = Math.max(0, fs);
    const Fz = fs * Math.max(0.3, -dot(dn, hitN));
    w.load = Fz;
    // Contact patch and its velocity.
    addScaled(tmp, r, dn, t);
    pointVel(vp, s, tmp);
    if (!wasContact) {
      const close = -dot(vp, hitN);
      if (close > WHEEL_MIN && close > evWheel[0]) { add(rp, s.pos, tmp); keep(evWheel, close, rp, hitN, i, bodyIndex(s, hitBody), 0); }
    }
    // Wheel axes in the contact plane.
    const steerA = i < 2 ? s.steer : 0;
    w.steer = steerA;
    const cs = dcos(steerA), snA = dsin(steerA);
    set(wf, fwd.x * cs + right.x * snA, fwd.y * cs + right.y * snA, fwd.z * cs + right.z * snA);
    addScaled(wf, wf, hitN, -dot(wf, hitN));
    const lf = dhypot(wf.x, wf.y, wf.z) || 1;
    scale(wf, wf, 1 / lf);
    cross(wl, hitN, wf);                         // wheel left
    const vLong = dot(vp, wf), vLat = dot(vp, wl);
    const den = Math.max(Math.abs(vLong), 3.0);
    let kappa = (w.omega * R - vLong) / den;
    const alpha = datan2(vLat, Math.max(Math.abs(vLong), 1.5));
    const mu = SPEC.tyreMu * hitMat.grip * (1 - 0.07 * (Fz / (STATIC_LOAD * AXLE_K[i]) - 1));   // load sensitivity, this surface
    const D = Math.max(0, mu * Fz);
    // Drive and brake torque. Two rear motors, 500 kW each, with traction control (every tier:
    // it's the drivetrain, not the flight computer).
    let T = 0;
    if (DRIVEN[i]) {
      const motorT = Math.min(SPEC.maxWheelTorque, (SPEC.power / 2) / Math.max(Math.abs(w.omega), 8));
      T = inp.throttle * motorT;
      // Assist's crawl limiter: on the curl, drive torque fades out above ASSIST_CRAWL.
      if (inp.assist && s.onSlope) T *= clamp(ASSIST_CRAWL + 1 - speed, 0, 1);
      if (kappa > 0.12) { T *= clamp(1 - (kappa - 0.12) * 9, 0.15, 1); s.tcActive = true; }
    }
    const brakeT = inp.brake * SPEC.brakeTorque * (i < 2 ? 1.15 : 0.85);
    // Pacejka pure-slip forces, then the friction ellipse for combined slip.
    let Fx = D * dsin(CX * datan(BX * kappa));
    const Fy0 = -D * dsin(CY * datan(BY * alpha));
    // Wheel spin, implicit in the tyre's longitudinal stiffness: stable at any speed.
    const slope = (D * CX * BX * dcos(CX * datan(BX * kappa))) / (1 + (BX * kappa) * (BX * kappa));
    const kEff = Math.max(slope, D * 2) / den;
    let omega = w.omega + ((dt / WHEEL_I) * (T - R * Fx)) / (1 + (dt / WHEEL_I) * R * R * kEff);
    if (brakeT > 0) {
      // Brakes pull toward zero and can lock the wheel, never reverse it. ABS (every tier):
      // release pressure once the wheel is past the slip peak.
      const abs = kappa < -0.1 && Math.abs(vLong) > 2 ? clamp(1 - (-kappa - 0.1) * 10, 0.05, 1) : 1;
      const db = ((brakeT * abs) / WHEEL_I) * dt;
      omega = Math.abs(omega) <= db ? 0 : omega - Math.sign(omega) * db;
    }
    w.omega = omega;
    kappa = (w.omega * R - vLong) / den;
    Fx = D * dsin(CX * datan(BX * kappa));
    let Fy = Fy0;
    // Stiction: a slip model has no static friction, so a braked car would creep down a slope.
    // At crawl speed, a locked (or stopped, undriven) tyre cancels sliding outright, up to its
    // friction limit, as a velocity constraint over one step.
    // The hold cancels this wheel's share of gravity along the tyre plus the residual velocity.
    const mEff = m * 0.25;
    if (Math.abs(vLong) < 0.5 && w.omega === 0 && T === 0) Fx = clamp(-mEff * (vLong / dt * 0.5 - G * wf.y), -D, D);
    if (Math.abs(vLat) < 0.5 && Math.abs(vLong) < 2) {
      const hold = clamp(-mEff * (vLat / dt * 0.5 - G * wl.y), -D, D);
      if (Math.abs(hold) > Math.abs(Fy)) Fy = hold;
    }
    const mag = dhypot(Fx, Fy);
    if (mag > D && mag > 0) { Fx *= D / mag; Fy *= D / mag; }
    Fx -= vLong * 6;                              // rolling resistance
    w.slip = kappa; w.slipAngle = alpha;
    scale(force, hitN, Fz);
    addScaled(force, force, wf, Fx);
    addScaled(force, force, wl, Fy);
    applyAt(tmp, force);
    if (hitBody) pushBody(hitBody, s.pos.x + tmp.x, s.pos.z + tmp.z, -force.x, -force.y, -force.z);   // and back on what it stands on
    wheelForce += Fz;
    w.spin += w.omega * dt;
  }
  s.grounded = grounded;
  s.onWall = wallContact;
  s.onSlope = sloped;   // any tyre off the level: the curl from its first metre (Assist's crawl limit)
  s.wheelForce = wheelForce;

  // --- Hull contact (sills, bumpers, roof) against everything ---
  for (let i = 0; i < HULL.length; i++) {
    rotate(r, s.quat, HULL[i]);
    add(pw, s.pos, r);
    const phi = phiAt(s, pw);
    // Into the structure past what is already crushed (a crushed corner sits that much further in).
    const dEl = -phi - s.crush[i];
    if (dEl <= 0) { s.touch[i] = 0; continue; }
    set(hitN, sn.x, sn.y, sn.z);
    pointVel(vp, s, r);
    if (sn.obstacle) { s.obstacleContact = true; s.obstacleSpeed = Math.max(s.obstacleSpeed, dhypot(vp.x, vp.y, vp.z)); }
    else s.hullGround = true;
    s.hullContact = true;
    const vn = dot(vp, hitN);
    const K = PROBE_K[i];
    let fs = K * dEl;
    if (fs > PROBE_YIELD[i] && s.crush[i] < CRUSH_MAX) {
      s.crush[i] = Math.min(CRUSH_MAX, -phi - PROBE_YIELD[i] / K);    // it folds: the excess stays
      fs = K * (-phi - s.crush[i]);
    }
    const fn = Math.max(0, fs - PROBE_C[i] * vn);
    s.hullImpulse = Math.max(s.hullImpulse, -vn);
    addScaled(tmp, vp, hitN, -vn);
    const vt = dhypot(tmp.x, tmp.y, tmp.z);
    if (!s.touch[i] && -vn > HIT_MIN && -vn > evHit[0]) keep(evHit, -vn, pw, hitN, i, bodyIndex(s, sn.body), s.crush[i]);
    if (s.crush[i] - s.crushShown[i] >= CRUSH_STEP) {
      // The panel folded further: report the new depth (the renderer dents the body to match).
      s.crushShown[i] = s.crush[i];
      pushImpact(s.impacts, s.tick + 1, CRUSH, HULL_PART[i], i, bodyIndex(s, sn.body), pw.x, pw.y, pw.z, hitN.x, hitN.y, hitN.z, -vn, s.crush[i]);
    }
    if (vt > SCRAPE_MIN && vt > evScr[0]) keep(evScr, vt, pw, hitN, i, bodyIndex(s, sn.body), s.crush[i]);
    s.touch[i] = 1;
    scale(force, hitN, fn);
    if (vt > 1e-4) addScaled(force, force, tmp, -Math.min(sn.mat.slide * fn, vt * 5000) / vt);
    applyAt(r, force);
    if (sn.body) pushBody(sn.body, pw.x, pw.z, -force.x, -force.y, -force.z);
  }
  // Impact events for this tick (the renderer, camera and sound key off them, live and in replay).
  const evTick = s.tick + 1, imp = s.impacts;
  if (evHit[0] > 0) record(imp, evTick, HIT, HULL_PART[evHit[7]], evHit);
  if (evScr[0] > 0 && evTick - imp.lastScrape >= SCRAPE_EVERY) { imp.lastScrape = evTick; record(imp, evTick, SCRAPE, HULL_PART[evScr[7]], evScr); }
  if (evWheel[0] > 0) record(imp, evTick, WHEEL, PART.wheel, evWheel);

  // --- Thrusters (nitrogen cold gas, blowdown) ---
  if (inp.manual && !inp.assist) {
    // Advanced: each valve straight from its channel. No mixer, no trim, no flight computer.
    for (let i = 0; i < NOZZLES.length; i++) target[i] = clamp(inp[VALVE_KEYS[i]] || 0, 0, 1);
  } else computerTargets(s, inp, grounded, m, target);
  // Blowdown: the tanks expand adiabatically (p ∝ m^1.375 here, γ ≈ 1.4 for N2), thrust follows
  // pressure, and specific impulse sags with it (72 s full → ≈60 s average).
  const pr = feedPressure(s);
  const isp = SPEC.ispFull * (0.7 + 0.3 * pr);
  let mdot = 0;
  for (let i = 0; i < NOZZLES.length; i++) {
    const nz = NOZZLES[i];
    const goal = s.air > 0.5 ? target[i] : 0;
    s.throttles[i] += (goal - s.throttles[i]) * Math.min(1, dt / 0.03);
    const F = nz.max * s.throttles[i] * pr;
    if (F <= 0) continue;
    rotate(r, s.quat, nz.pos);
    rotate(force, s.quat, nz.dir);
    scale(force, force, F);
    applyAt(r, force);
    mdot += F / (isp * G);
  }
  s.air = Math.max(0, s.air - mdot * dt);

  // --- Aero drag ---
  const vmag = dhypot(s.vel.x, s.vel.y, s.vel.z);
  addScaled(fTot, fTot, s.vel, -0.5 * RHO * SPEC.cdA * vmag);

  // --- Integrate (semi-implicit Euler), inertia tensor diagonal in the body frame ---
  addScaled(s.vel, s.vel, fTot, dt / m);
  addScaled(s.pos, s.pos, s.vel, dt);
  // Rotation integrates ANGULAR MOMENTUM in the world frame (L += τ·dt) and reads the body rates
  // back through the inertia (ω = I⁻¹·Rᵀ·L). The gyroscopic coupling falls out of the frame
  // change instead of an explicit ω × Iω term, which blew up at Pro-mode spin rates (a held roll
  // + yaw: ω·dt grew until one tick overshot and the state went NaN).
  const Ix = SPEC.inertia.pitch, Iy = SPEC.inertia.yaw, Iz = SPEC.inertia.roll;   // the gas sits near the CoM: fixed (spec.js)
  // Air resists a spinning body: quadratic rotational drag, τ = −c·ω|ω| per body axis, from a flat
  // plate of the car's plan sweeping about each axis (c = ρ·Cd·span·r⁴/4, Cd ≈ 1.2): ESTIMATE,
  // small (≈150 N·m at 10 rad/s of roll) but it bounds a held spin like the real air would.
  rotateInv(wb, s.quat, s.angVel);
  addScaled(s.angMom, s.angMom, tTot, dt);
  rotateInv(Lb, s.quat, s.angMom);
  Lb.x -= clamp(ROT_DRAG.x * wb.x * Math.abs(wb.x) * dt, -Math.abs(Lb.x), Math.abs(Lb.x));
  Lb.y -= clamp(ROT_DRAG.y * wb.y * Math.abs(wb.y) * dt, -Math.abs(Lb.y), Math.abs(Lb.y));
  Lb.z -= clamp(ROT_DRAG.z * wb.z * Math.abs(wb.z) * dt, -Math.abs(Lb.z), Math.abs(Lb.z));
  const ad = grounded && !s.hullContact ? 0.997 : 0.9996;
  Lb.x *= ad; Lb.y *= ad; Lb.z *= ad;
  rotate(s.angMom, s.quat, Lb);
  set(wb, Lb.x / Ix, Lb.y / Iy, Lb.z / Iz);
  rotate(s.angVel, s.quat, wb);
  integrateQuat(s.quat, s.angVel, dt);
  stepWorld(s.world, dt, G);
  s.tick++;
  return s;
}

export function bodyRates(s, out) { return rotateInv(out, s.quat, s.angVel); }
export function up(s, out) { return rotate(out, s.quat, set(out, 0, 1, 0)); }
export function forward(s, out) { return rotate(out, s.quat, set(out, 0, 0, 1)); }
export function worldPoint(s, local, out) { rotate(out, s.quat, local); return add(out, out, s.pos); }
export { WHEELS };
