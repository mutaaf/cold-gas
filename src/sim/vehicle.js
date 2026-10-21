// The roadster, physics v3: a 6-DOF rigid body on four raycast-suspended wheels with slip-based
// tyres, a suction fan and ten cold-gas thrusters. It drives on any surface the course defines:
// flat concrete, a vertical wall, or upside down under a ledge.
//
// The rigid-body engine (Rapier, src/sim/engine.js + src/sim/world.js) owns the world: the
// course's colliders, the parked vehicles' bodies, and every contact of this car's rigid hull with
// them. This file is what no engine ships, as forces on the car's engine body: the tyres (Pacejka,
// combined slip, load sensitivity, implicit wheel spin), the suspension, the suction fan and its
// sliding skirts, the nitrogen thrusters with blowdown, the mixer and the flight computer. The
// wheels and the fan read the world through the engine's ray casts.
//
// Body frame: +x is the car's LEFT, +y up, +z forward (right-handed), origin at the centre of
// mass. Inputs are driver-relative: steer, roll and yaw are positive to the driver's right (−x),
// pitch is positive nose-down. Fixed step, no
// randomness, no wall clock: a run replays bit-exactly from its inputs (the Worker verifies
// scores this way). No allocation in step().
import { v3, q4, add, scale, addScaled, cross, dot, rotate, rotateInv, integrateQuat, quatFromYaw, clamp, set } from './m3.js';
import { SPEC, NOZZLE_SPEC, wheelAnchors, wheelRadiusOf, AXLE_F, AXLE_R } from './spec.js';
import { COURSES, DEFAULT_COURSE, MATERIALS, WALL, roofUnder } from './courses.js';
import { createWorld, attachCar, raycast as worldRay, preStep, stepEngine, gateCurl } from './world.js';
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
// The tyre's pure-slip curves (Pacejka's magic formula, F = D·sin(C·atan(B·x)), E = 0): the
// longitudinal force at slip ratio κ and the lateral force at slip angle α (rad), for a peak
// D = μ·Fz. Combined slip is the friction ellipse on top of these (step()).
export const TYRE = { BX, CX, BY, CY };
export const tyreFx = (D, kappa) => D * dsin(CX * datan(BX * kappa));
export const tyreFy = (D, alpha, B = BY) => -D * dsin(CY * datan(B * alpha));
// Load sensitivity (ticket 0021; spec.js names the published fit). x = Fz/Fz0, the load against
// the tyre's static load on its axle. Peak μ falls linearly with load (MF's PDY2); past the load
// where μ·Fz itself would start to fall (x ≈ 4.2, far outside any fit's data: bump-stop slams) the
// peak force is held, not extrapolated. Cornering stiffness saturates (MF's PKY2): it peaks at
// x = tyreKyLoad and the lateral B carries it as B = Kα/(C·D), so a heavily loaded tyre needs a
// larger slip angle to reach a (lower) peak μ.
const LS = SPEC.tyreLoadSens, KYL = SPEC.tyreKyLoad;
const X_DMAX = (1 - LS) / (-2 * LS);
export const tyreMuLoad = (x) => (x <= X_DMAX ? 1 + LS * (x - 1) : ((1 + LS * (X_DMAX - 1)) * X_DMAX) / x);
const KY_NOM = dsin(2 * datan(1 / KYL));
export const tyreKyRatio = (x) => dsin(2 * datan(x / KYL)) / KY_NOM;   // Kα(Fz) / Kα(Fz0)
export const tyreBy = (x) => {
  const xc = Math.max(0.05, x);
  return (BY * tyreKyRatio(xc)) / (xc * tyreMuLoad(xc));
};
// Relaxation: the tyre's slip angle α' (the carcass's side deflection over the patch) follows the
// kinematic slip angle α as σ·dα'/dt = |vx|·(α − α'), so a step reaches 1 − 1/e of its side force
// after σ metres of rolling. σ grows with √(load) (bounded ×0.5–1.5). Below RELAX_VMIN the speed
// is clamped: the lag stays finite at a standstill (the stiction hold keeps a parked car parked).
// Stepped as 1 − 1/(1 + x + x²/2) of the gap, x = |vx|·dt/σ: e^−x to second order, so it never
// overshoots at any speed. At a crawl the first-order model goes under-damped (it's a lagged damper
// on the sideways motion, and the real patch's own damping isn't in it: Pacejka ch. 7 adds a
// low-speed correction for this), so the force fades back to the kinematic slip angle between
// RELAX_VMIN + RELAX_FADE and RELAX_VMIN: a car nudged sideways at 3 m/s settled with 0.4 m/s of
// overshoot on the lag alone, ten times what it did before.
const RELAX_VMIN = 1.5, RELAX_FADE = 3;   // m/s; the floor is the one the slip angle itself uses
export const relaxWeight = (vx) => clamp((Math.abs(vx) - RELAX_VMIN) / RELAX_FADE, 0, 1);
export const relaxLength = (sigma0, Fz, Fz0) => sigma0 * clamp(Math.sqrt(Math.max(0, Fz) / Fz0), 0.5, 1.5);
export function relaxSlip(alphaLag, alpha, vx, sigma, dt) {
  const x = (Math.max(Math.abs(vx), RELAX_VMIN) * dt) / sigma;
  return alphaLag + (alpha - alphaLag) * (1 - 1 / (1 + x + 0.5 * x * x));
}

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
// Lift trim: the down-jets don't sit symmetrically about the CoM (nor are they the same size), so
// each one's share of a pure lift command is scaled until the four make no pitch or roll moment
// (the pair with the larger moment, thrust × lever, runs leaner). Attitude commands ride on top.
const TRIM = (() => {
  const lift = NOZZLE_SPEC.filter((n) => n.group === 'lift');
  const f = lift.find((n) => n.pos[2] > 0), b = lift.find((n) => n.pos[2] < 0);
  const mf = f.max * f.pos[2], mr = -b.max * b.pos[2];
  return NOZZLE_SPEC.map((n) => (n.group !== 'lift' ? 1 : n.pos[2] > 0 ? Math.min(1, mr / mf) : Math.min(1, mf / mr)));
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

// The rigid hull the engine collides: a convex hull of the body's faceted shape (nose, tail,
// beltline, greenhouse). Its floor is the battery tub's structural pan, 6 cm above the floor probes:
// below it the sliding skirts and the pan ride the deck compliantly (FLOOR_K, below), as they do on
// the curl's sag, and only a hit hard enough to fold them reaches the rigid structure.
const HULL_SHAPE = (() => {
  const hw = SPEC.width / 2 - 0.04, zf = AXLE_F + SPEC.overhangFront - 0.05, zr = zf - SPEC.length + 0.1;
  const yb = -(SPEC.comHeight - SPEC.rideHeight) + 0.05, yt = SPEC.height - SPEC.comHeight - 0.05;
  const yPan = yb + 0.06, yNose = yb + 0.15, yTail = yb + 0.2, yBelt = yt * 0.55;
  const pts = [];
  for (const x of [-hw, hw]) {
    pts.push(x, yNose, zf, x, yPan, zf - 0.9, x, yPan, zr + 0.9, x, yTail, zr);
    pts.push(x * 0.9, yt * 0.4, zf, x * 0.9, yt * 0.6, zr);
    for (const z of [zf * 0.9, ((zf + zr) / 2) * 0.9, zr * 0.9]) pts.push(x, yBelt, z);
    pts.push(x * 0.36, yt, 0.2, x * 0.36, yt, -0.6);
  }
  pts.push(0, yt * 0.4, zf + 0.04, 0, yt * 0.6, zr - 0.02);
  return new Float32Array(pts);
})();
const FLOOR_PROBES = HULL_PART.map((p, i) => (p === PART.floor ? i : -1)).filter((i) => i >= 0);
// How far above a floor probe its skirt ray starts (inside the hull), m.
const SKIRT_UP = 0.3;

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
// The energy a probe's structure stores elastically before it yields (½·F²/k ≈ 4.2 kJ): a hit that
// puts more than that into one patch of structure folds it, by the excess over the yield force.
const E_ELASTIC = (0.5 * HULL_YIELD * HULL_YIELD) / HULL_K;
const FLOOR = v3(0, -(SPEC.comHeight - SPEC.rideHeight), 0);
// The skirts' sealed floor (ESTIMATE): 1.5 m across inside the sills, 2.0 m long, centred on the
// CoM; the suction is taken at the centre of each of eight patches (2 across × 4 along), so a lip
// crossing loses it a quarter-metre at a time.
const SEAL = [0.75, 0.25, -0.25, -0.75].flatMap((z) => [v3(0.375, FLOOR.y, z), v3(-0.375, FLOOR.y, z)]);

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
const TC_CAP = 1.0;   // traction control holds drive torque to what the tyre carries (≈ peak slip), not a 15 % bang-bang cut
// The rack's window at speed: the kinematic angle for μg of lateral acceleration (L·μg/v²) plus
// 0.04 rad, the lock that measured the most steady cornering g at 12, 25 and 40 m/s. (A smaller
// margin, 0.015, halved a full-stick flick's yaw overshoot at 140 km/h but took the turn-in bite a
// driver corrects with: the keyboard road bench left the Stelvio 7× as often. Analog sticks are
// rate-limited in src/hands.js instead.)
const LOCK_MARGIN = 0.04;
// aGrip is the lateral acceleration the tyres carry: μ·g alone, or μ·(g + N/m) while the fans pull
// a corner's suction N (ticket 0020).
export const rackLock = (vSq, aGrip = SPEC.tyreMu * G) => Math.min(SPEC.steerLock, (SPEC.wheelbase * aGrip) / Math.max(1, vSq) + LOCK_MARGIN);
// Opposite lock opens up past 2° of rear-axle slip (normal cornering stays inside the plain window).
const COUNTER_DB = 0.035;
// The rack crosses its window (lock either side) in no less than RACK_T0 + RACK_TV·v seconds.
const RACK_T0 = 0.1, RACK_TV = 0.005;
// Stability control: the yaw moment asks for the unwanted yaw gone in ESC_TAU seconds; sideslip
// past the threshold counts ESC_KB rad/s per rad, and a growing slide ESC_KBD per rad/s (ESTIMATE,
// set on the drive-feel bench: no overshoot to a step steer, a spin caught from full throttle).
const ESC_TAU = 0.12, ESC_KB = 3, ESC_KBD = 0.3;

export function createVehicle(courseId = DEFAULT_COURSE) {
  // A course id, or a course object (Free Drive's roads aren't in COURSES).
  const course = typeof courseId === 'object' ? courseId : COURSES[courseId] || COURSES[DEFAULT_COURSE];
  const world = createWorld(course);
  const s = {
    course, tick: 0, world,
    pos: v3(course.start.x, SPEC.comHeight, course.start.z), vel: v3(), quat: quatFromYaw(q4(), 0), angVel: v3(), angMom: v3(),
    air: CAR.airMass,
    throttles: new Float64Array(NOZZLES.length),
    wheels: WHEELS.map(() => ({ contact: true, compression: REST_LEN - MOUNT_TO_CENTRE, prevCompression: REST_LEN - MOUNT_TO_CENTRE, omega: 0, spin: 0, steer: 0, slip: 0, slipAngle: 0, slipAngleKin: 0, relax: 0, load: STATIC_LOAD, nx: 0, ny: 1, nz: 0 })),
    fan: 0, fanDemand: 0, fanForce: 0, gripSat: 0, fanLat: 0, floorGap: SPEC.rideHeight,
    hullContact: false, hullGround: false, obstacleContact: false, obstacleSpeed: 0, hullImpulse: 0,
    steer: 0, grounded: 4, onWall: false, onSlope: false, wheelForce: 0, tcActive: false,
    // Crash state: each hull probe's permanent crush (m), its contact last tick, and the run's
    // impact events (src/sim/impacts.js).
    crush: new Float64Array(HULL.length), crushShown: new Float64Array(HULL.length), touch: new Uint8Array(HULL.length), impacts: createImpacts(),
    // Energy each probe's structure has absorbed in contacts (J): its crush follows from it.
    crushE: new Float64Array(HULL.length), touchNow: new Uint8Array(HULL.length), engineMass: 0,
    // The hardest sink of this flight so far (m/s, 0 on the ground): LAND sizes its set-down to it.
    fallPeak: 0,
    // Assist's crawl limit belongs to the curl: only the courses with the Wall have one.
    crawl: course.id === 'wall' || course.id === 'show',
    // Stability control (Assist): how hard it is working (0–1, for the HUD and the sound), the
    // brake it adds per wheel this tick (N·m), and last tick's sideslip (rad).
    esc: 0, escBrake: new Float64Array(4), escBeta: 0,
  };
  s.engineMass = massOf(s);
  attachCar(world, HULL_SHAPE, s.engineMass, { x: SPEC.inertia.pitch, y: SPEC.inertia.yaw, z: SPEC.inertia.roll });
  world.carPos = s.pos; world.carVel = s.vel;
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
  fTot = v3(), tTot = v3(), wb = v3(), Lb = v3(), cmdT = v3(), dn = v3(), hitN = v3(), wf = v3(), wl = v3(), worldUpB = v3(), rp = v3(),
  imp = v3(), vPre = v3(), wPre = v3(), nb = v3(), lc = v3(), vo = v3(), vb = v3();
const ePt = { x: 0, y: 0, z: 0 }, eN = { x: 0, y: 0, z: 0 };
let hitBody = null, hitMat = MATERIALS.concrete, hitCar = false;
const target = new Float64Array(NOZZLES.length);
// The strongest new hit / slide / tyre slam this tick: [speed, x, y, z, nx, ny, nz, probe, body, crush].
const evHit = new Float64Array(10), evScr = new Float64Array(10), evWheel = new Float64Array(10);
function keep(ev, speed, p, n, probe, body, crush) {
  ev[0] = speed; ev[1] = p.x; ev[2] = p.y; ev[3] = p.z; ev[4] = n.x; ev[5] = n.y; ev[6] = n.z; ev[7] = probe; ev[8] = body; ev[9] = crush;
}
const bodyIndex = (b) => (b ? b.index : -1);
const eff = { lift: 0, thrust: 0 };

function pointVel(out, s, rw) { cross(out, s.angVel, rw); return add(out, out, s.vel); }
function applyAt(rw, f) { add(fTot, fTot, f); cross(tmp2, rw, f); add(tTot, tTot, tmp2); }
// A force the car puts on a parked body it stands on, sucks at or scrapes (the opposite of `f`).
function reactOn(w, body, p, f, dt) {
  if (!body?.rb) return;
  imp.x = -f.x * dt; imp.y = -f.y * dt; imp.z = -f.z * dt;
  body.rb.applyImpulseAtPoint(imp, set(ePt, p.x - w.ox, p.y - w.oy, p.z - w.oz), true);
}

// Cast from `o` along unit `d` up to `maxT` through the engine's world (never into the car itself):
// the first distance where it enters a solid (or −1), with the hit normal in hitN.
function raycast(s, o, d, maxT) {
  const w = s.world;
  const t = worldRay(w, o.x, o.y, o.z, d.x, d.y, d.z, maxT, w.carRb);
  if (t < 0) return -1;
  const h = w.hit;
  set(hitN, h.nx, h.ny, h.nz); hitBody = h.body; hitMat = h.mat; hitCar = h.car;
  return t;
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
// Banked past ≈20° (cos 20° = 0.94), LAND's roll-out is a bang-bang roll at ROLL_ACC (rad/s²) up to
// the stick's 4.6 rad/s and back down to upright: 180° in ≈1.1 s, as at the reveal (frames: wheels
// sideways at ≈0.5 s, upright by ≈1.1 s, docs/REVEAL_RESEARCH.md §2.1.4). Inverted, every jet that
// rolls the car pushes it at the ground, so the roll-out asks for that acceleration and no more:
// 12 rad/s² on Iroll 615 kg·m² is ≈9.8 kN on one side's down-jets, 0.4 G, and the car falls nearly
// free (TELEMETRY: 0.2–0.4 G for the first second off the lip). ESTIMATE, set by the reveal's timing.
const UPPER_ROLL = 0.94, ROLL_ACC = 12;
// Roll torque per unit of roll command in the mixer's linear range (one side's down-jets, N·m).
const ROLL_TAU = NOZZLE_SPEC.reduce((a, n) => a + (n.group === 'lift' && n.pos[0] > 0 ? 2 * n.pos[0] * n.pos[0] * n.max : 0), 0);
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
    let rollOut = false;
    if ((uy < -0.2 && Math.abs(uz) < 0.7) || (uy < UPPER_ROLL && Math.abs(ux) > Math.abs(uz) && Math.abs(inp.roll) < 0.05)) {
      // The roll-out: the nearer way round, at the rate it can still stop from by upright (decel at
      // 80 % of ROLL_ACC, a margin for the lag), with the pitch rate held while inverted (correcting
      // pitch too would start a half-loop that fights the roll; past sideways the pitch levels too, so
      // the brake doesn't fire tilted and bleed off the carry).
      const bank = uy < -0.2 ? datan2(dhypot(ux, uz), uy) : datan2(Math.abs(ux), uy);
      if (uy < -0.2) wantX = 0;
      wantZ = (ux >= 0 ? -1 : 1) * Math.min(RATE.z, Math.sqrt(1.6 * ROLL_ACC * bank));
      rollOut = Math.abs(inp.roll) < 0.05;
    }
    out.x += (kp + LEVEL_DAMP) * wantX - LEVEL_DAMP * wb.x;
    out.z += (kp + LEVEL_DAMP) * wantZ - LEVEL_DAMP * wb.z;
    if (rollOut) {
      // No more roll torque than ROLL_ACC needs at today's feed pressure, and, upside down, the
      // pitch hold on no more than that thrust either (every jet pushes the car at the ground).
      const cap = (ROLL_ACC * SPEC.inertia.roll) / (ROLL_TAU * Math.max(0.2, feedPressure(s)));
      out.z = clamp(out.z, -cap, cap);
      if (uy < 0) out.x = clamp(out.x, -cap / 2, cap / 2);
    }
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
// LAND brakes to the top of the set-down, `setdownTop` m up, then sets down at a sink easing from
// SETDOWN + SETDOWN_K·h to SETDOWN at the wheels: after the Wall's drop 2.05 m/s at 2.5 m, 0.8 m/s
// at touchdown (the judges' perfect band is ≤ 0.9). TELEMETRY (docs/REVEAL_RESEARCH.md §2.1.4):
// braked to ≈1.5 m/s by ≈2.5 m, 2.0 s below 3 m, touchdown at 1.1 G.
export const HOVER = 2.5, SETDOWN = 0.8, SETDOWN_K = 0.5;
// The set-down follows the fall it ends. After the 20 m drop (a 15–16 m/s sink taken out in a 3.3 G
// stop) the reveal spent 2.0 s below 3 m; after the 7 m kickflip it was upright at ≈t0 + 2.2 s and on
// its wheels by ≈t0 + 3 s, and the standing flip went from upright to wheels in 0.8 s (§2.2, §2.4):
// no hover after a low stunt. So the top of the set-down grows with the hardest sink of the flight,
// from none below FALL_LOW m/s to HOVER at FALL_HIGH (ESTIMATE, fitted to those two stunts: the
// kickflip peaks at ≈7 m/s, the Wall and the Show at 15–16). The sink at the wheels is SETDOWN
// either way. A hard stop leaves the most to settle (the blowdown, the rate loop) before contact.
const FALL_LOW = 8, FALL_HIGH = 14;
const TOP_MIN = 0.1;
export const setdownTop = (s) => TOP_MIN + (HOVER - TOP_MIN) * clamp((s.fallPeak - FALL_LOW) / (FALL_HIGH - FALL_LOW), 0, 1);
const vTop = (top) => SETDOWN + SETDOWN_K * top;
// The vertical speed LAND wants at height h with a braking plan of aPlan m/s² (negative down), for
// a set-down from `top` m.
export function profileVy(h, aPlan, top = HOVER) {
  if (h <= top) return -(SETDOWN + SETDOWN_K * Math.max(0, h));
  const v = vTop(top);
  return -Math.min(25, Math.sqrt(v * v + 2 * aPlan * (h - top)));
}
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
  const h = landHeight(s);
  let wantVy = landWant(s, m);
  if (h < 1.2 && upW.y < 0.99) wantVy = Math.max(wantVy, -0.25);   // level before the wheels touch
  behind = wantVy - s.vel.y;
  // The brake has priority: once LAND is braking (or below 8 m), a thumb left on BOOST no longer
  // drains the gas the stop needs.
  if (behind > 0 || h < 8) eff.thrust = 0;
  if (s.vel.y < wantVy && upW.y > 0.55) eff.lift = Math.max(eff.lift, clamp((wantVy - s.vel.y) * 0.8 + 0.55, 0, 1));
}
// The vertical speed LAND wants for the car as it stands (m/s, negative down). Plan the braking
// from the thrust the down-jets can actually make through the blowdown, brake late and hard like
// the reveal (3.3 G peak at ≈6.5 m) to the top of the set-down, and set down.
export function landProfile(s, m = massOf(s)) {
  return landWant(s, m);
}
// Over a parked vehicle and still carrying along the run (> 2 m/s), LAND doesn't set down on it:
// the roof is a floor ROOF_HOLD m under the car (braked to, then held) and the ground beyond stays
// the target, so it doesn't dawdle in a set-down over each roof and drain the tanks. Stopped over
// a roof, it sets down there, gently.
function landWant(s, m) {
  const h = landHeight(s), a = brakePlan(s, m), top = setdownTop(s);
  if (roofBelow <= 0) return profileVy(h, a, top);
  if (dhypot(s.vel.x, s.vel.z) <= 2) return profileVy(h, a, top);
  const hRoof = h, hGround = h + roofBelow;
  if (hRoof < ROOF_HOLD) return clamp(ROOF_HOLD - hRoof, 0, 1);
  return Math.max(profileVy(hGround, a, top), -Math.min(25, Math.sqrt(2 * a * (hRoof - ROOF_HOLD))));
}
// LAND's altimeter: the floor's height above whatever it would set down on, the ground or the
// tallest parked roof under the car's footprint along its track, from its tail now to its nose
// 0.6 s on (sampled every ≈0.5 m along it and at both sides: the gaps in the row are narrower than
// the car). A late, hard brake measured from the ground alone would arrive at a roof, or a semi's
// flank, still falling fast.
let roofBelow = 0;   // the last landHeight's roof (m, 0 over the ground)
const hdg = v3();
const ROOF_HOLD = 1.2;   // m of floor over a roof (ESTIMATE: clears the skirts and a wing mirror)
export function landHeight(s) {
  // Along the track; nearly stopped, along the nose (the footprint still covers the car).
  const vh = dhypot(s.vel.x, s.vel.z);
  let dx = 0, dz = 1;
  if (vh > 0.5) { dx = s.vel.x / vh; dz = s.vel.z / vh; }
  else {
    rotate(hdg, s.quat, set(hdg, 0, 0, 1));
    const l = dhypot(hdg.x, hdg.z);
    if (l > 0.1) { dx = hdg.x / l; dz = hdg.z / l; }
  }
  const back = CAR.halfL, len = back + vh * 0.6 + CAR.halfL;
  const n = Math.min(24, Math.ceil(len / 0.5));
  roofBelow = 0;
  for (let i = 0; i <= n; i++) {
    const d = (len * i) / n - back, x = s.pos.x + dx * d, z = s.pos.z + dz * d;
    for (let k = -1; k <= 1; k++) roofBelow = Math.max(roofBelow, roofUnder(s.world, x - dz * k * CAR.halfW, z + dx * k * CAR.halfW));
  }
  return Math.max(0, s.pos.y - SPEC.comHeight - 0.05 - roofBelow);
}
// Net upward deceleration the four down-jets can make right now (m/s², trimmed, level). The HUD
// reads it, the stop's gas cost and the end-of-stop braking too.
export const brakeAvail = (s, m = massOf(s)) => (LIFT_MAX * feedPressure(s)) / m - G;
// The stop itself drains the tanks: stopping from v m/s at a m/s² costs an impulse m·(v + g·v/a)
// (≈70 kg of nitrogen from 15 m/s), and below 65 % gas the regulator can't hold line pressure.
// The jets that finish the landing are the weaker ones. (Planning on today's pressure alone arrived
// at the hover height still sinking 3–4 m/s once the tanks had blown down.)
export function gasToStop(s, m = massOf(s), vy = s.vel.y) {
  const v = Math.max(0, -vy), a = Math.max(1, brakeAvail(s, m));
  return (m * (v + (G * v) / a)) / (SPEC.ispFull * 0.9 * G);
}
export function brakeAvailAtEnd(s, m = massOf(s)) {
  const used = gasToStop(s, m);
  return (LIFT_MAX * pressureOf(s.air - used)) / (m - used) - G;
}
// The plan: the mean deceleration of a stop flown at BRAKE_SHARE of full lift from here, through
// the blowdown (stopFull), so the governor waits in free fall and then brakes late and hard. The
// burn front-loads itself: it opens at line pressure (≈3.2 G of specific force) and eases as the
// tanks fall below the regulator, like the reveal's 1.7 → 3.3 G peak at ≈6.5 m → 1.0 G
// (TELEMETRY, docs/REVEAL_RESEARCH.md §2.1.4). The share leaves the rate loop room to level.
const BRAKE_SHARE = 0.8;   // ESTIMATE: the most the reference and human-model runs land reliably on
export const brakePlan = (s, m = massOf(s)) => {
  const v = Math.max(0, -s.vel.y), vt = vTop(setdownTop(s));
  if (v < vt + 0.5) return clamp(brakeAvail(s, m) * BRAKE_SHARE, 0.6, 30);
  return clamp((v * v - vt * vt) / (2 * stopFull(s.air, m, v, vt)), 0.6, 30);
};
// Distance (m) to slow a fall of v m/s to vEnd at BRAKE_SHARE of full lift, the gas, the mass and
// the pressure falling as it burns (0.05 s steps; a stop that can't be made returns a long one).
export function stopFull(air, m, v, vEnd = 0) {
  const dt = 0.05;
  let d = 0;
  for (let i = 0; i < 80 && v > vEnd; i++) {
    const pr = pressureOf(air), F = LIFT_MAX * BRAKE_SHARE * pr;
    const a = F / m - G;
    const dv = Math.min(v - vEnd, Math.max(0, a) * dt);
    d += (v - dv / 2) * dt;
    v -= dv;
    const used = (F / (SPEC.ispFull * (0.7 + 0.3 * pr) * G)) * dt;
    air -= used; m -= used;
    if (a <= 0.3) return d + (v * v - vEnd * vEnd) / 0.6;
  }
  return Math.max(d, 0.01);
}
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
  else if (envelope < 1) {
    // Behind the profile the brake has priority over attitude too: the mixer gives attitude first
    // call on the down-jets, and a full pitch correction would take most of the lift the stop needs.
    cmdT.x *= envelope; cmdT.y *= envelope; cmdT.z *= envelope;
  }
  return mix(eff, cmdT, out);
}
// The same, from outside a step, on the car as it stands: the valves the computer would open now.
// The Advanced reference pilot flies these by hand (src/sim/autopilot.js); a player never sees it.
export function computerValves(s, inp, out) {
  rotate(upW, s.quat, set(tmp, 0, 1, 0));
  return computerTargets(s, inp, s.grounded, massOf(s), out);
}

// --- Contacts of the rigid hull, as the engine solved them ------------------------------------------
// Which probe a contact belongs to: the part its outward normal says (roof up, floor down, nose and
// tail along the car, sides across), then the nearest probe of that part.
const PART_PROBES = [PART.floor, PART.nose, PART.tail, PART.side, PART.roof].reduce((a, p) => { a[p] = HULL_PART.map((q, i) => (q === p ? i : -1)).filter((i) => i >= 0); return a; }, []);
function probeFor(nbx, nby, nbz, lx, ly, lz) {
  const part = nby > 0.6 ? PART.roof : nby < -0.6 ? PART.floor : Math.abs(nbz) > Math.abs(nbx) ? (nbz > 0 ? PART.nose : PART.tail) : PART.side;
  const list = PART_PROBES[part];
  let best = list[0], bd = Infinity;
  for (const i of list) {
    const p = HULL[i], dx = p.x - lx, dy = p.y - ly, dz = p.z - lz, d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
let cs = null, cOther = null, cTouched = false;
const TOUCH_SKIN = 0.01;   // m
const mN = { x: 0, y: 0, z: 0 }, mP = { x: 0, y: 0, z: 0 };
function onManifold(manifold, flipped) {
  const s = cs, w = s.world, info = w.info.get(cOther.handle);
  if (!info) return;
  manifold.normal(mN);
  // The engine's normal points from the first collider to the second: turn it to point out of
  // the other solid, toward the car.
  const sg = flipped ? 1 : -1;
  const nx = mN.x * sg, ny = mN.y * sg, nz = mN.z * sg;
  for (let k = 0; k < manifold.numContacts(); k++) {
    // Touching: pushed apart this tick, or resting within the contact skin (a body at rest on a
    // face needs no impulse on some ticks; it is still lying there).
    const J = manifold.contactImpulse(k);
    if (!(J > 0) && !(manifold.contactDist(k) < TOUCH_SKIN)) continue;
    const lp = flipped ? manifold.localContactPoint2(k, mP) : manifold.localContactPoint1(k, mP);
    if (!lp) continue;
    cTouched = true;
    // Body frame → world: the contact point, and the car's velocity there before the contact.
    set(lc, lp.x, lp.y, lp.z);
    rotate(r, s.quat, lc); add(pw, s.pos, r);
    cross(vp, wPre, r); add(vp, vp, vPre);
    vo.x = 0; vo.y = 0; vo.z = 0;
    // What it hit was moving too: its velocity there before this step (the closing speed is what
    // the contact had to take out, not what is left after it).
    const b = info.body;
    if (b) {
      const h = b.phys.cgh, q = b;
      // CoM = frame origin + R·(0, cgh, 0); point velocity = v + ω × (p − CoM).
      const cx = b.cx + 2 * (q.qx * q.qy - q.qw * q.qz) * h, cy = b.cy + (1 - 2 * (q.qx * q.qx + q.qz * q.qz)) * h, cz = b.cz + 2 * (q.qy * q.qz + q.qw * q.qx) * h;
      const rx = pw.x - cx, ry = pw.y - cy, rz = pw.z - cz;
      set(vo, b.pvx + b.pwy * rz - b.pwz * ry, b.pvy + b.pwz * rx - b.pwx * rz, b.pvz + b.pwx * ry - b.pwy * rx);
    }
    sub3(vp, vp, vo);
    set(hitN, nx, ny, nz);
    rotateInv(nb, s.quat, set(tmp, -nx, -ny, -nz));
    const i = probeFor(nb.x, nb.y, nb.z, lc.x, lc.y, lc.z);
    const vn = dot(vp, hitN);
    if (info.body) { s.obstacleContact = true; s.obstacleSpeed = Math.max(s.obstacleSpeed, dhypot(vp.x + vo.x, vp.y + vo.y, vp.z + vo.z)); }
    else s.hullGround = true;
    s.hullContact = true;
    s.hullImpulse = Math.max(s.hullImpulse, -vn);
    addScaled(tmp, vp, hitN, -vn);
    const vt = dhypot(tmp.x, tmp.y, tmp.z);
    const bi = bodyIndex(info.body);
    if (!s.touch[i] && !s.touchNow[i] && -vn > HIT_MIN && -vn > evHit[0]) keep(evHit, -vn, pw, hitN, i, bi, s.crush[i]);
    if (vt > SCRAPE_MIN && vt > evScr[0]) keep(evScr, vt, pw, hitN, i, bi, s.crush[i]);
    s.touchNow[i] = 1;
    // Crush: the impulse J took the closing speed vn out of this patch, absorbing ½·J·|vn|. Up to
    // the structure's elastic store it springs back; past it, the panel folds by the excess over
    // the yield force, and stays folded (crash tests: little rebound at crash speeds).
    if (PROBE_YIELD[i] < Infinity && vn < 0 && J > 0) {
      s.crushE[i] += 0.5 * J * -vn;
      const d = Math.min(CRUSH_MAX, (s.crushE[i] - E_ELASTIC) / PROBE_YIELD[i]);
      if (d > s.crush[i]) s.crush[i] = d;
      if (s.crush[i] - s.crushShown[i] >= CRUSH_STEP) {
        s.crushShown[i] = s.crush[i];
        pushImpact(s.impacts, s.tick + 1, CRUSH, HULL_PART[i], i, bi, pw.x, pw.y, pw.z, hitN.x, hitN.y, hitN.z, -vn, s.crush[i]);
      }
    }
  }
}
function onPair(other) {
  cOther = other;
  cs.world.rw.contactPair(cs.world.carCol, other, onManifold);
}
const sub3 = (o, a, b) => { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; };

// World inertia times a vector: R·I·Rᵀ·v (I diagonal in the body frame).
function inertiaTimes(out, q, v) {
  rotateInv(out, q, v);
  out.x *= SPEC.inertia.pitch; out.y *= SPEC.inertia.yaw; out.z *= SPEC.inertia.roll;
  return rotate(out, q, out);
}
const qOld = q4(), pOld = v3();

export function step(s, inp) {
  const dt = DT, w = s.world;
  const m = massOf(s);
  if (w.stream) w.stream(w, s.pos);
  // The parked bodies' own suspension and tyres first: a parked car whose tyre stands on this one
  // pushes back through w.carF / w.carT.
  preStep(w);
  set(fTot, w.carF.x, w.carF.y - m * G, w.carF.z);
  set(tTot, w.carT.x, w.carT.y, w.carT.z);
  rotate(fwd, s.quat, set(tmp, 0, 0, 1));
  rotate(right, s.quat, set(tmp, 1, 0, 0));
  rotate(upW, s.quat, set(tmp, 0, 1, 0));
  scale(dn, upW, -1);

  // --- Steering (steer-by-wire: rate-limited, speed-sensitive) ---
  // Full lock is SPEC.steerLock at parking speed. At speed the rack is scaled so full stick asks for
  // the tyres' peak grip and no more (rackLock). With the fans pulling a corner's suction (s.fanLat,
  // below) that grip is μ·(g + N/m), so the rack opens as the suction spools; suction the curl's tilt
  // or a launch asks for doesn't move it (0020). Every bit of stick travel is usable, and a
  // full-stick flick at 200 km/h can't saw the front axle into understeer.
  // Opposite lock: that window is centred on straight ahead, so at 140 km/h it held 4.6° either
  // way, and a slide with the tail 20° out could not be caught (the wheels have to point where the
  // car is going). In the direction that catches a slide, the limit grows by the rear axle's slip
  // angle past COUNTER_DB, as a driver's hands let the wheel follow the slide. It never steers on
  // its own: with the stick centred the wheels stay straight.
  const speed = dhypot(s.vel.x, s.vel.y, s.vel.z);
  const vSq = Math.max(1, s.vel.x * s.vel.x + s.vel.z * s.vel.z);
  const aGrip = SPEC.tyreMu * (G + Math.min(s.fanForce, s.fanLat * SPEC.fanMaxForce) / m);
  const lock = rackLock(vSq, aGrip);
  rotateInv(vb, s.quat, s.vel);
  rotateInv(wb, s.quat, s.angVel);
  const vFwd = vb.z;
  let slideR = 0;   // the rear axle's slip past the dead band: + = the slide wants the wheels left
  if (vFwd > 3) {
    const th = datan2(vb.x + wb.y * AXLE_R, vFwd);
    slideR = th > COUNTER_DB ? th - COUNTER_DB : th < -COUNTER_DB ? th + COUNTER_DB : 0;
  }
  let steerTarget = -inp.steer * lock;        // driver's right is −x
  if (steerTarget * slideR > 0) steerTarget = -inp.steer * Math.min(SPEC.steerLock, lock + Math.abs(slideR));
  // The rack's slew follows its variable ratio: at parking speed it is the motor's SPEC.steerRate,
  // at road speed it crosses the (much smaller) window in no less than RACK_T(v), as a yoke geared
  // slower at speed does. A 140 km/h flick of a gamepad stick reached full lock in 29 ms and the yaw
  // overshot its steady rate by 56 %; real hands at that speed take a fifth of a second.
  // |v|: in reverse past 20 m/s, RACK_T0 + RACK_TV·v crossed zero, the slew went negative and the
  // rack ran away to 20 rad with the stick centred.
  const rackRate = Math.min(SPEC.steerRate, (lock + Math.abs(slideR)) / (RACK_T0 + RACK_TV * Math.abs(vFwd)));
  s.steer += clamp(steerTarget - s.steer, -rackRate * dt, rackRate * dt);

  // --- Stability control (Assist) ---
  // Two signs of a car getting away: the tail sliding past escSlip (or sliding further, fast),
  // and a yaw rate past what the tyres can carry at this speed (μg/v, more with the fans' corner suction). The correction is a yaw
  // moment toward the direction of travel, made the way a production ESC makes it: by braking the
  // one front wheel that pulls the nose that way (through the tyre and ABS, so it is bounded by the
  // grip that wheel has), and by trimming drive torque while it works.
  s.esc = 0; s.escBrake.fill(0);
  let escCut = 1;
  {
    // The slip that matters is the rear axle's: the body's own sideslip is ≈13° at full lock in a
    // car park, while the rear axle tracks; past the tyres' grip it is the tail stepping out.
    const beta = vFwd > 0.5 ? datan2(vb.x + wb.y * AXLE_R, vFwd) : 0;
    const dBeta = (beta - s.escBeta) / dt;
    s.escBeta = beta;
    if (inp.assist && !inp.manual && s.grounded >= 3 && vFwd > 5) {
      const r = wb.y, rMax = (SPEC.escYaw * aGrip) / vFwd;   // the grip the tyres have, fans included
      // e: unwanted yaw (rad/s), + = the car needs turning to its right (−y).
      const bx = beta > SPEC.escSlip ? beta - SPEC.escSlip : beta < -SPEC.escSlip ? beta + SPEC.escSlip : 0;
      let e = r - clamp(r, -rMax, rMax) - ESC_KB * bx;
      if (bx !== 0 && dBeta * bx > 0) e -= ESC_KBD * dBeta;   // sliding further: catch it early
      if (e !== 0) {
        const Mz = (SPEC.inertia.yaw * Math.abs(e)) / ESC_TAU;   // N·m, toward the travel
        const i = e > 0 ? 0 : 1;                                 // front right pulls the nose right
        s.escBrake[i] = Math.min(SPEC.brakeTorque * 1.15, (Mz / (SPEC.trackFront / 2)) * RW[i]);
        s.esc = Math.min(1, Math.abs(e) * 4);
        escCut = 1 - s.esc;
      }
    }
  }
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
  // A corner asks for suction too ("greater than 2 G's … beyond the tires", OFFICIAL, Moravy). The
  // driver's stick, not the tyres' measured slip (that chattered: LESSONS), sets the lateral g
  // wanted: full stick is the fan car's whole grip, μ·(m·g + fanMax)/m, or what full lock gives
  // at this speed (steerLock·v²/L) if that is less. The fan pulls N with μ·(m·g + N) = m·a, inside
  // [idle, max]; below μ·g the tyres carry it alone and the fan idles. Filtered over fanGripTime,
  // so a flick of the stick doesn't spool it.
  let latNeed = 0;
  if (armed > 0 && gapT >= 0) {
    const aWant = Math.abs(inp.steer) * Math.min(SPEC.tyreMu * (G + SPEC.fanMaxForce / m), (SPEC.steerLock * vSq) / SPEC.wheelbase);
    latNeed = clamp((m * aWant) / SPEC.tyreMu - m * G, SPEC.fanIdleForce, SPEC.fanMaxForce) / SPEC.fanMaxForce;
  }
  s.fanLat += (latNeed - s.fanLat) * (dt / SPEC.fanGripTime);
  const fanTarget = armed * Math.max(s.fanDemand, clamp(2 * s.gripSat - 1, 0, 1), s.fanLat);
  s.fan += (fanTarget - s.fan) * Math.min(1, dt / (fanTarget > s.fan ? SPEC.fanSpool / Math.LN10 : SPEC.fanDump));
  // The skirts seal a rectangle of floor; each patch of it seals (or leaks) on its own, so a car
  // whose nose hangs past the Wall's lip keeps only the suction of the floor still over the deck,
  // pulled where that floor is (the patch forces balance about the CoM when all seal). The
  // controller above reads the deck under the centre; the force is the patches'.
  s.fanForce = 0;
  for (let k = 0; k < SEAL.length && s.fan > 0; k++) {
    rotate(r, s.quat, SEAL[k]);
    add(pw, s.pos, r);
    const gapQ = raycast(s, pw, dn, 0.6);
    if (gapQ < 0) continue;
    // Skirts drop to seal; past their reach the leak grows and suction falls off fast.
    const leak = Math.max(0, gapQ - SPEC.fanSkirtReach) / SPEC.fanGapScale;
    const f = (s.fan * SPEC.fanMaxForce / SEAL.length) / (1 + leak * leak);
    if (f <= 0) continue;
    s.fanForce += f;
    scale(force, dn, f); applyAt(r, force);
    // The suction pulls whatever is under the car just as hard toward it.
    if (hitBody) { addScaled(rp, pw, dn, gapQ); reactOn(w, hitBody, rp, force, dt); }
  }

  // --- Wheels: raycast suspension + Pacejka tyres + wheel spin ---
  let grounded = 0, wallContact = false, sloped = false, wheelForce = 0;
  s.hullContact = false; s.hullGround = false; s.obstacleContact = false;
  s.tcActive = false;
  evHit[0] = 0; evScr[0] = 0; evWheel[0] = 0;
  for (let i = 0; i < 4; i++) {
    const wh = s.wheels[i];
    rotate(r, s.quat, WHEELS[i]);
    add(pw, s.pos, r);
    wh.prevCompression = wh.compression;
    const wasContact = wh.contact;
    wh.contact = false;
    const R = RW[i];
    const maxT = REST_LEN + R;
    const t = raycast(s, pw, dn, maxT);
    if (t < 0) {
      wh.compression = 0; wh.load = 0;
      wh.slipAngle = 0;   // the carcass springs back off the ground: a touchdown's side force builds up over σ
      // Free wheel: driven wheels spin up under throttle, brakes stop them.
      if (DRIVEN[i]) wh.omega += ((inp.throttle * 600) / WHEEL_I) * dt;
      if (inp.brake > 0) wh.omega *= 0.9;
      wh.omega *= 0.999;
      wh.spin += wh.omega * dt;
      continue;
    }
    wh.contact = true; grounded++;
    if (hitBody) s.obstacleContact = true;      // a tyre on a parked car is contact
    if (hitN.y < 0.85) wallContact = true;
    if (hitN.y < 0.995) sloped = true;
    wh.nx = hitN.x; wh.ny = hitN.y; wh.nz = hitN.z;
    const comp = maxT - t;
    wh.compression = Math.min(comp, REST_LEN + R);
    const compRate = (wh.compression - wh.prevCompression) / dt;
    let fs = AXLE_K[i] * (K_SPRING * Math.min(comp, REST_LEN) + C_DAMP * compRate);
    const over = comp - (REST_LEN - MOUNT_TO_CENTRE + TRAVEL);
    if (over > 0) fs += BUMP * over;
    fs = Math.max(0, fs);
    const Fz = fs * Math.max(0.3, -dot(dn, hitN));
    wh.load = Fz;
    // Contact patch and its velocity (relative to what the tyre stands on).
    addScaled(tmp, r, dn, t);
    pointVel(vp, s, tmp);
    if (hitBody?.rb) { add(rp, s.pos, tmp); hitBody.rb.velocityAtPoint(set(ePt, rp.x - w.ox, rp.y - w.oy, rp.z - w.oz), eN); vp.x -= eN.x; vp.y -= eN.y; vp.z -= eN.z; }
    if (!wasContact) {
      const close = -dot(vp, hitN);
      if (close > WHEEL_MIN && close > evWheel[0]) { add(rp, s.pos, tmp); keep(evWheel, close, rp, hitN, i, bodyIndex(hitBody), 0); }
    }
    // Wheel axes in the contact plane.
    const steerA = i < 2 ? s.steer : 0;
    wh.steer = steerA;
    const cs = dcos(steerA), snA = dsin(steerA);
    set(wf, fwd.x * cs + right.x * snA, fwd.y * cs + right.y * snA, fwd.z * cs + right.z * snA);
    addScaled(wf, wf, hitN, -dot(wf, hitN));
    const lf = dhypot(wf.x, wf.y, wf.z) || 1;
    scale(wf, wf, 1 / lf);
    cross(wl, hitN, wf);                         // wheel left
    const vLong = dot(vp, wf), vLat = dot(vp, wl);
    const den = Math.max(Math.abs(vLong), 3.0);
    let kappa = (wh.omega * R - vLong) / den;
    const alphaKin = datan2(vLat, Math.max(Math.abs(vLong), 1.5));
    // Peak forces on this surface. Lateral: the published load sensitivity (0021). Longitudinal:
    // unchanged (no fit of the semi-slick's μx is public; the 0–60, the brakes and the curl's climb
    // were sourced against it), μ = tyreMu with −7 % per unit of normalised load.
    const xLoad = Fz / (STATIC_LOAD * AXLE_K[i]);
    const D = Math.max(0, SPEC.tyreMu * hitMat.grip * (1 - 0.07 * (xLoad - 1)) * Fz);
    const Dy = Math.max(0, SPEC.tyreMu0 * hitMat.grip * tyreMuLoad(xLoad) * Fz);
    const By = tyreBy(xLoad);
    const sigma = relaxLength(i < 2 ? SPEC.tyreRelaxFront : SPEC.tyreRelaxRear, Fz, STATIC_LOAD * AXLE_K[i]);
    const lag = relaxSlip(wh.slipAngle, alphaKin, vLong, sigma, dt);
    const alpha = alphaKin + (lag - alphaKin) * relaxWeight(vLong);
    // Drive and brake torque. Two rear motors, 500 kW each, with traction control (every tier:
    // it's the drivetrain, not the flight computer).
    let T = 0;
    if (DRIVEN[i]) {
      const motorT = Math.min(SPEC.maxWheelTorque, (SPEC.power / 2) / Math.max(Math.abs(wh.omega), 8));
      T = inp.throttle * motorT;
      // Assist's crawl limiter: on the curl, drive torque fades out above ASSIST_CRAWL. Only the
      // Wall has a curl: on a road it read every grade over 5.7° as one and capped the car at
      // 32 km/h up the Stelvio.
      if (inp.assist && s.crawl && s.onSlope) T *= clamp(ASSIST_CRAWL + 1 - speed, 0, 1);
      T *= escCut;
      // Traction control: past the slip peak, torque is cut to no less than 15 % of the command
      // (tuned on concrete). On loose ground (grass, gravel, rock: Free Drive's verges) it adapts
      // to the surface, as real systems estimate μ: the floor scales with grip², and the torque is
      // held to what the tyre can carry there (1.2·R·μFz). With the concrete law, 15 % of 11.8 kN·m
      // was more than a rear tyre's grip on grass, so the wheel stayed spun up at κ ≈ 13, where the
      // tyre gives about half its peak, and the car slid back down an 11 % verge it could climb.
      // In reverse the same, mirrored (a spun-up wheel backing off a verge is the same problem).
      // And (Assist and Pro; Advanced drives raw) it leaves the tyre the side force it is making:
      // drive force is held inside the friction ellipse (Fx ≤ √(D² − Fy²)), as production systems
      // lower their slip target with lateral acceleration. Holding it at the longitudinal peak in a
      // bend took all the rear tyres' grip: full throttle with 1.4° of steering at 140 km/h put the
      // tail 20° out, and full throttle out of a 40 km/h bend spun the car.
      const loose = hitMat.loose === true;
      const kd = T >= 0 ? kappa : -kappa;
      if (kd > 0.12) { T *= clamp(1 - (kd - 0.12) * 9, loose ? 0.15 * hitMat.grip * hitMat.grip : 0.15, 1); s.tcActive = true; }
      let cap = (loose ? 1.2 : TC_CAP) * R * D;
      if (!inp.manual && Math.abs(vLong) > 3) {
        const fy = Dy > 0 ? tyreFy(Dy, alpha, By) / Dy : 0;
        cap = Math.min(cap, R * D * Math.sqrt(Math.max(0, 1 - fy * fy)));
      }
      if (T > cap) { T = cap; s.tcActive = true; } else if (T < -cap) { T = -cap; s.tcActive = true; }
    }
    const brakeT = inp.brake * SPEC.brakeTorque * (i < 2 ? 1.15 : 0.85) + s.escBrake[i];
    // Pacejka pure-slip forces, then the friction ellipse for combined slip.
    let Fx = tyreFx(D, kappa);
    const Fy0 = tyreFy(Dy, alpha, By);
    // Wheel spin, implicit in the tyre's longitudinal stiffness: stable at any speed.
    const slope = (D * CX * BX * dcos(CX * datan(BX * kappa))) / (1 + (BX * kappa) * (BX * kappa));
    const kEff = Math.max(slope, D * 2) / den;
    let omega = wh.omega + ((dt / WHEEL_I) * (T - R * Fx)) / (1 + (dt / WHEEL_I) * R * R * kEff);
    if (brakeT > 0) {
      // Brakes pull toward zero and can lock the wheel, never reverse it. ABS (every tier):
      // release pressure once the wheel is past the slip peak.
      const abs = kappa < -0.1 && Math.abs(vLong) > 2 ? clamp(1 - (-kappa - 0.1) * 10, 0.05, 1) : 1;
      const db = ((brakeT * abs) / WHEEL_I) * dt;
      omega = Math.abs(omega) <= db ? 0 : omega - Math.sign(omega) * db;
    }
    wh.omega = omega;
    kappa = (wh.omega * R - vLong) / den;
    Fx = tyreFx(D, kappa);
    let Fy = Fy0;
    // Stiction: a slip model has no static friction, so a braked car would creep down a slope.
    // At crawl speed, a locked (or stopped, undriven) tyre cancels sliding outright, up to its
    // friction limit, as a velocity constraint over one step.
    // The hold cancels this wheel's share of gravity along the tyre plus the residual velocity.
    const mEff = m * 0.25;
    if (Math.abs(vLong) < 0.5 && wh.omega === 0 && T === 0) Fx = clamp(-mEff * (vLong / dt * 0.5 - G * wf.y), -D, D);
    if (Math.abs(vLat) < 0.5 && Math.abs(vLong) < 2) {
      const hold = clamp(-mEff * (vLat / dt * 0.5 - G * wl.y), -Dy, Dy);
      if (Math.abs(hold) > Math.abs(Fy)) Fy = hold;
    }
    // The friction ellipse, (Fx/D)² + (Fy/Dy)² ≤ 1.
    const ex = D > 0 ? Fx / D : 0, ey = Dy > 0 ? Fy / Dy : 0;
    const ell = ex * ex + ey * ey;
    if (ell > 1) { const k = 1 / Math.sqrt(ell); Fx *= k; Fy *= k; }
    Fx -= vLong * 6;                              // rolling resistance
    if (hitMat.roll) Fx -= clamp(vLong * 2, -1, 1) * hitMat.roll * Fz;   // and soft ground's (courses.js MATERIALS)
    wh.slip = kappa; wh.slipAngle = lag; wh.slipAngleKin = alphaKin; wh.relax = sigma;
    scale(force, hitN, Fz);
    addScaled(force, force, wf, Fx);
    addScaled(force, force, wl, Fy);
    applyAt(tmp, force);
    if (hitBody) { add(rp, s.pos, tmp); reactOn(w, hitBody, rp, force, dt); }   // and back on what it stands on
    wheelForce += Fz;
    wh.spin += wh.omega * dt;
  }
  s.grounded = grounded;
  s.fallPeak = grounded > 0 ? 0 : Math.max(s.fallPeak, -s.vel.y);
  s.onWall = wallContact;
  s.onSlope = sloped;   // any tyre off the level: the curl from its first metre (Assist's crawl limit)
  s.wheelForce = wheelForce;

  // --- Skirts and floor pan: compliant, under the rigid hull ---
  // The floor probes are the fan's sliding skirts and the flat pan over the battery: they ride the
  // deck under suction (the curl's sag brings them down onto it) and push back as springs.
  s.touchNow.fill(0);
  for (let k = 0; k < FLOOR_PROBES.length; k++) {
    const i = FLOOR_PROBES[k];
    rotate(r, s.quat, HULL[i]);
    addScaled(r, r, upW, SKIRT_UP);
    add(pw, s.pos, r);
    const t = raycast(s, pw, dn, SKIRT_UP);
    if (t < 0) continue;
    const pen = SKIRT_UP - t;
    addScaled(r, r, dn, SKIRT_UP);             // back to the probe
    add(pw, s.pos, r);
    pointVel(vp, s, r);
    if (hitBody?.rb) { hitBody.rb.velocityAtPoint(set(ePt, pw.x - w.ox, pw.y - w.oy, pw.z - w.oz), eN); vp.x -= eN.x; vp.y -= eN.y; vp.z -= eN.z; }
    if (hitBody) { s.obstacleContact = true; s.obstacleSpeed = Math.max(s.obstacleSpeed, dhypot(vp.x, vp.y, vp.z)); }
    else s.hullGround = true;
    s.hullContact = true;
    const vn = dot(vp, hitN);
    const fn = Math.max(0, PROBE_K[i] * pen - PROBE_C[i] * vn);
    s.hullImpulse = Math.max(s.hullImpulse, -vn);
    addScaled(tmp, vp, hitN, -vn);
    const vt = dhypot(tmp.x, tmp.y, tmp.z);
    if (!s.touch[i] && -vn > HIT_MIN && -vn > evHit[0]) keep(evHit, -vn, pw, hitN, i, bodyIndex(hitBody), 0);
    if (vt > SCRAPE_MIN && vt > evScr[0]) keep(evScr, vt, pw, hitN, i, bodyIndex(hitBody), 0);
    s.touchNow[i] = 1;
    scale(force, hitN, fn);
    if (vt > 1e-4) addScaled(force, force, tmp, -Math.min(hitMat.slide * fn, vt * 5000) / vt);
    applyAt(r, force);
    reactOn(w, hitBody, pw, force, dt);
  }

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

  // --- Velocities from our forces (semi-implicit Euler), inertia diagonal in the body frame ---
  addScaled(s.vel, s.vel, fTot, dt / m);
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

  // --- The engine's tick: the rigid hull's contacts, and everything else that moves ---
  // The car enters the step with its pose and the velocities our forces gave it; the engine
  // resolves its hull against the ground, the deck and the parked bodies (friction and
  // restitution per material pair), moves the parked bodies, and hands back the result.
  const rb = w.carRb;
  if (Math.abs(m - s.engineMass) > 1) { s.engineMass = m; rb.setAdditionalMassProperties(m, ORIGIN, PRINCIPAL, IDENTITY, false); }
  if (!s.engineHeld) {
    rb.setTranslation(set(ePt, s.pos.x - w.ox, s.pos.y - w.oy, s.pos.z - w.oz), false);
    rb.setRotation(s.quat, false);
  }
  rb.setLinvel(s.vel, false);
  rb.setAngvel(s.angVel, false);
  copy3(vPre, s.vel); copy3(wPre, s.angVel); qOld.x = s.quat.x; qOld.y = s.quat.y; qOld.z = s.quat.z; qOld.w = s.quat.w;
  copy3(pOld, s.pos);
  if (w.curl) gateCurl(w, curlReach(s), (Math.sqrt(dot(s.vel, s.vel)) + Math.sqrt(dot(s.angVel, s.angVel)) * HULL_R) * dt);
  stepEngine(w);
  // Read the hull's contacts. While nothing touches it, the car's motion is exactly the integral of
  // our forces (in double precision; the engine stores single); in contact, the engine's answer.
  cs = s; cTouched = false;
  if (w.carTouching > 0) w.rw.contactPairsWith(w.carCol, onPair);
  cs = null; cOther = null;
  s.engineHeld = cTouched && !w.stream;
  if (cTouched) {
    const p = rb.translation(ePt);
    set(s.pos, p.x + w.ox, p.y + w.oy, p.z + w.oz);
    const q = rb.rotation(qTmp);
    s.quat.x = q.x; s.quat.y = q.y; s.quat.z = q.z; s.quat.w = q.w;
    const v = rb.linvel(ePt); set(s.vel, v.x, v.y, v.z);
    const a = rb.angvel(ePt); set(s.angVel, a.x, a.y, a.z);
    // The contact changed ω through the inertia at the start of the step: so did L.
    inertiaTimes(s.angMom, qOld, s.angVel);
  } else {
    addScaled(s.pos, s.pos, s.vel, dt);
    integrateQuat(s.quat, s.angVel, dt);
  }
  for (let i = 0; i < HULL.length; i++) s.touch[i] = s.touchNow[i];
  // Impact events for this tick (the renderer, camera and sound key off them, live and in replay).
  const evTick = s.tick + 1, imp2 = s.impacts;
  if (evHit[0] > 0) record(imp2, evTick, HIT, HULL_PART[evHit[7]], evHit);
  if (evScr[0] > 0 && evTick - imp2.lastScrape >= SCRAPE_EVERY) { imp2.lastScrape = evTick; record(imp2, evTick, SCRAPE, HULL_PART[evScr[7]], evScr); }
  if (evWheel[0] > 0) record(imp2, evTick, WHEEL, PART.wheel, evWheel);
  s.tick++;
  return s;
}
const qTmp = { x: 0, y: 0, z: 0, w: 1 };
// How far the hull's farthest corner is from the CoM, m (a hull point moves at most |v| + |ω|·HULL_R).
const HULL_R = (() => { let r = 0; for (let i = 0; i < HULL_SHAPE.length; i += 3) { const x = HULL_SHAPE[i], y = HULL_SHAPE[i + 1], z = HULL_SHAPE[i + 2]; r = Math.max(r, Math.sqrt(x * x + y * y + z * z)); } return r; })();
// The hull corner farthest from the curl's centre (z 0, y WALL.r1), in the side view: src/sim/world.js
// `gateCurl` reads it as a lower bound on the hull's clearance to the deck.
function curlReach(s) {
  const q = s.quat, cy = s.pos.y - WALL.r1, cz = s.pos.z;
  let far = 0;
  for (let i = 0; i < HULL_SHAPE.length; i += 3) {
    const x = HULL_SHAPE[i], y = HULL_SHAPE[i + 1], z = HULL_SHAPE[i + 2];
    const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
    const py = cy + y + q.w * ty + (q.z * tx - q.x * tz), pz = cz + z + q.w * tz + (q.x * ty - q.y * tx);
    const d = py * py + pz * pz;
    if (d > far) far = d;
  }
  return Math.sqrt(far);
}
const ORIGIN = { x: 0, y: 0, z: 0 }, IDENTITY = { x: 0, y: 0, z: 0, w: 1 }, PRINCIPAL = { x: SPEC.inertia.pitch, y: SPEC.inertia.yaw, z: SPEC.inertia.roll };
const copy3 = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };

export function bodyRates(s, out) { return rotateInv(out, s.quat, s.angVel); }
export function up(s, out) { return rotate(out, s.quat, set(out, 0, 1, 0)); }
export function forward(s, out) { return rotate(out, s.quat, set(out, 0, 0, 1)); }
export function worldPoint(s, local, out) { rotate(out, s.quat, local); return add(out, out, s.pos); }
export { WHEELS };
