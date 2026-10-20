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
const LIFT_MAX = NOZZLE_SPEC.reduce((a, n, i) => a + (n.group === 'lift' ? n.max * TRIM[i] : 0), 0);
const DRIVEN = [false, false, true, true];

// Hull probe points (body frame): the faceted body's corners, sills, roof and nose/tail.
const HULL = [];
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
    for (const z of [zf, (zf + zr) / 2, zr]) HULL.push(v3(x * 0.8, yt * 0.55, z * 0.9));
  }
  HULL.push(v3(0, yt, -0.2), v3(0, yNose, zf), v3(0, yTail, zr), v3(0, yt * 0.4, zf + 0.04), v3(0, yt * 0.6, zr - 0.02));
}
export { HULL };
const FLOOR = v3(0, -(SPEC.comHeight - SPEC.rideHeight), 0);

export const newInput = () => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, fan: 0, assist: 1 });

export function createVehicle(courseId = DEFAULT_COURSE) {
  const course = COURSES[courseId] || COURSES[DEFAULT_COURSE];
  const s = {
    course, tick: 0, world: createWorld(course),
    pos: v3(course.start.x, SPEC.comHeight, course.start.z), vel: v3(), quat: quatFromYaw(q4(), 0), angVel: v3(),
    air: CAR.airMass,
    throttles: new Float64Array(NOZZLES.length),
    wheels: WHEELS.map(() => ({ contact: true, compression: REST_LEN - MOUNT_TO_CENTRE, prevCompression: REST_LEN - MOUNT_TO_CENTRE, omega: 0, spin: 0, steer: 0, slip: 0, slipAngle: 0, load: STATIC_LOAD, nx: 0, ny: 1, nz: 0 })),
    fan: 0, fanForce: 0, floorGap: SPEC.rideHeight,
    hullContact: false, hullGround: false, obstacleContact: false, obstacleSpeed: 0, hullImpulse: 0,
    steer: 0, grounded: 4, onWall: false, wheelForce: 0, tcActive: false,
  };
  return s;
}

export const massOf = (s) => CAR.dryMass + Math.max(0, s.air);

// Nozzle feed pressure as a fraction of full. The tanks expand adiabatically (p ∝ m^1.375,
// γ ≈ 1.4 for N2); a regulator holds the feed at line pressure until the tanks drop below it.
export function feedPressure(s) {
  const rG = Math.max(0, s.air) / CAR.airMass;
  const tank = rG * Math.sqrt(Math.sqrt(rG)) * Math.sqrt(Math.sqrt(Math.sqrt(rG)));
  return Math.min(1, tank / SPEC.regulatedFraction);
}

// Scratch (never reallocated).
const tmp = v3(), tmp2 = v3(), r = v3(), pw = v3(), vp = v3(), force = v3(), fwd = v3(), right = v3(), upW = v3(),
  fTot = v3(), tTot = v3(), wb = v3(), Lb = v3(), cmdT = v3(), dn = v3(), hitN = v3(), wf = v3(), wl = v3(), worldUpB = v3(), rp = v3();
const sn = { x: 0, y: 0, z: 0, obstacle: false, body: null, mat: MATERIALS.concrete };
let hitBody = null, hitMat = MATERIALS.concrete;
const target = new Float64Array(NOZZLES.length);
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

// Flight computer. Assist: the stick commands body rates; LAND also levels the car. Pro: raw.
const RATE = v3(2.4, 1.4, 4.6);
function flightComputer(s, inp, out) {
  rotateInv(wb, s.quat, s.angVel);
  if (inp.assist) {
    const kp = 1.6;
    set(out, kp * (inp.pitch * RATE.x - wb.x), kp * (-inp.yaw * RATE.y - wb.y), kp * (inp.roll * RATE.z - wb.z));
    if (inp.level) {
      rotateInv(worldUpB, s.quat, set(tmp, 0, 1, 0));
      // Upside down, a zero roll error is a trap: pick the nearer way round and commit.
      const ux = worldUpB.y < -0.2 && Math.abs(worldUpB.x) < 0.25 ? (worldUpB.x >= 0 ? 0.25 : -0.25) : worldUpB.x;
      out.x += worldUpB.z * 6 - wb.x * 1.4;
      out.z += -ux * 6 - wb.z * 1.4;
    }
  } else {
    set(out, inp.pitch, -inp.yaw, inp.roll);
  }
  out.x = clamp(out.x, -1, 1); out.y = clamp(out.y, -1, 1); out.z = clamp(out.z, -1, 1);
  return out;
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
  s.fan += (clamp(inp.fan, 0, 1) - s.fan) * Math.min(1, dt / SPEC.fanSpool);
  // Skirts drop to seal; past their reach the leak grows and suction falls off fast.
  const leak = gapT < 0 ? Infinity : Math.max(0, gapT - SPEC.fanSkirtReach) / SPEC.fanGapScale;
  s.fanForce = gapT < 0 ? 0 : (s.fan * SPEC.fanMaxForce) / (1 + leak * leak);
  if (s.fanForce > 0) { scale(force, dn, s.fanForce); applyAt(r, force); }

  // --- Wheels: raycast suspension + Pacejka tyres + wheel spin ---
  let grounded = 0, wallContact = false, wheelForce = 0;
  s.hullContact = false; s.hullGround = false; s.obstacleContact = false;
  s.tcActive = false;
  for (let i = 0; i < 4; i++) {
    const w = s.wheels[i];
    rotate(r, s.quat, WHEELS[i]);
    add(pw, s.pos, r);
    w.prevCompression = w.compression;
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
    // Drive and brake torque. Two rear motors, 500 kW each; Assist adds traction control.
    let T = 0;
    if (DRIVEN[i]) {
      const motorT = Math.min(SPEC.maxWheelTorque, (SPEC.power / 2) / Math.max(Math.abs(w.omega), 8));
      T = inp.throttle * motorT;
      if (inp.assist && kappa > 0.12) { T *= clamp(1 - (kappa - 0.12) * 9, 0.15, 1); s.tcActive = true; }
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
      // Brakes pull toward zero and can lock the wheel, never reverse it. Assist adds ABS:
      // release pressure once the wheel is past the slip peak.
      const abs = inp.assist && kappa < -0.1 && Math.abs(vLong) > 2 ? clamp(1 - (-kappa - 0.1) * 10, 0.05, 1) : 1;
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
  s.wheelForce = wheelForce;

  // --- Hull contact (sills, bumpers, roof) against everything ---
  for (let i = 0; i < HULL.length; i++) {
    rotate(r, s.quat, HULL[i]);
    add(pw, s.pos, r);
    const phi = phiAt(s, pw);
    if (phi >= 0) continue;
    set(hitN, sn.x, sn.y, sn.z);
    pointVel(vp, s, r);
    if (sn.obstacle) { s.obstacleContact = true; s.obstacleSpeed = Math.max(s.obstacleSpeed, dhypot(vp.x, vp.y, vp.z)); }
    else s.hullGround = true;
    s.hullContact = true;
    const vn = dot(vp, hitN);
    const fn = Math.max(0, -300000 * phi - 11000 * vn);
    s.hullImpulse = Math.max(s.hullImpulse, -vn);
    addScaled(tmp, vp, hitN, -vn);
    const vt = dhypot(tmp.x, tmp.y, tmp.z);
    scale(force, hitN, fn);
    if (vt > 1e-4) addScaled(force, force, tmp, -Math.min(sn.mat.slide * fn, vt * 5000) / vt);
    applyAt(r, force);
    if (sn.body) pushBody(sn.body, pw.x, pw.z, -force.x, -force.y, -force.z);
  }

  // --- Thrusters (nitrogen cold gas, blowdown) ---
  flightComputer(s, inp, cmdT);
  if (grounded >= 2) { cmdT.x = 0; cmdT.y = 0; cmdT.z = 0; }
  eff.lift = inp.lift; eff.thrust = inp.thrust;
  if (inp.assist && inp.level && grounded === 0 && s.air > 0) {
    // LAND: govern lift so the sink rate eases to a soft touchdown on the ground below.
    const h = Math.max(0, s.pos.y - SPEC.comHeight - 0.05);
    // Plan the braking from the thrust the down-jets can actually make at today's tank pressure
    // (blowdown halves it fast), then brake late and hard like the reveal (3.3 G peak at ≈6 m).
    const aAvail = (LIFT_MAX * feedPressure(s)) / m - G;
    const aPlan = clamp(aAvail * 0.5, 0.6, 9);    // margin: pressure can still fall during the burn
    // Brake to a low hover (as the reveal did), then set down at walking pace: time to level.
    const HOVER = 1.3;
    let wantVy = h > HOVER ? -Math.max(0.6, Math.min(16, Math.sqrt((h - HOVER) * 2 * aPlan))) : -0.55;
    if (h < HOVER + 1.5 && upW.y < 0.99) wantVy = Math.max(wantVy, -0.25);
    if (s.vel.y < wantVy && upW.y > 0.55) eff.lift = Math.max(eff.lift, clamp((wantVy - s.vel.y) * 0.8 + 0.55, 0, 1));
  }
  mix(eff, cmdT, target);
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
  rotateInv(Lb, s.quat, tTot);
  rotateInv(wb, s.quat, s.angVel);
  const k = 1;   // the gas sits near the CoM: inertia barely changes as it blows down (spec.js)
  const Ix = SPEC.inertia.pitch * k, Iy = SPEC.inertia.yaw * k, Iz = SPEC.inertia.roll * k;
  const hx = Ix * wb.x, hy = Iy * wb.y, hz = Iz * wb.z;
  const gx = wb.y * hz - wb.z * hy, gy = wb.z * hx - wb.x * hz, gz = wb.x * hy - wb.y * hx;
  wb.x += ((Lb.x - gx) / Ix) * dt;
  wb.y += ((Lb.y - gy) / Iy) * dt;
  wb.z += ((Lb.z - gz) / Iz) * dt;
  const ad = grounded ? 0.997 : 0.9996;
  wb.x *= ad; wb.y *= ad; wb.z *= ad;
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
