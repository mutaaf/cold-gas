// The roadster: a 6-DOF rigid body on four raycast wheels with ten cold-gas nozzles.
// Body frame: +x right, +y up, +z forward, origin at the centre of mass.
//
// Everything here is deterministic (fixed step, no randomness, no wall clock) so a run can be
// replayed from its inputs alone — by the replay camera and by the Worker's score recompute.
import {
  v3, q4, add, sub, scale, addScaled, cross, dot, rotate, rotateInv, integrateQuat, quatFromYaw, clamp, copy, set,
} from './m3.js';
import { groundAt, obstaclePenetration, START_Z } from './course.js';

export const DT = 1 / 240;
export const G = 9.81;

export const CAR = {
  dryMass: 1900,
  airMass: 250,                  // two composite tanks of compressed air
  isp: 72,                       // cold-gas specific impulse, seconds
  halfW: 1.0, halfH: 0.56, halfL: 2.17,
  // Inertia per kg (box approximation), scaled by the current mass.
  inertiaPerKg: v3((1.12 * 1.12 + 4.34 * 4.34) / 12, (2 * 2 + 4.34 * 4.34) / 12, (2 * 2 + 1.12 * 1.12) / 12),
  wheelX: 0.84, wheelZ: 1.38, wheelY: -0.06,
  restLen: 0.3, wheelR: 0.34, maxTravel: 0.22,
  spring: 56000, damper: 4200, bumpSpring: 420000,
  mu: 1.35, lateralGrip: 9000,
  driveForce: 23000, drivePower: 820000, brakeForce: 26000,
  maxSteer: 0.42, drag: 0.36,
};

// Ten nozzles: four lift (underbody corners), two rear (thrust), two front (retro),
// two upper side "kick" nozzles that roll the car. `dir` is the force direction on the car.
export const NOZZLES = [
  { id: 'lift-fl', group: 'lift', pos: v3(-0.86, -0.28, 1.5), dir: v3(0, 1, 0), max: 9200 },
  { id: 'lift-fr', group: 'lift', pos: v3(0.86, -0.28, 1.5), dir: v3(0, 1, 0), max: 9200 },
  { id: 'lift-rl', group: 'lift', pos: v3(-0.86, -0.28, -1.5), dir: v3(0, 1, 0), max: 9200 },
  { id: 'lift-rr', group: 'lift', pos: v3(0.86, -0.28, -1.5), dir: v3(0, 1, 0), max: 9200 },
  { id: 'rear-l', group: 'rear', pos: v3(-0.55, 0.02, -2.17), dir: v3(0, 0, 1), max: 6000 },
  { id: 'rear-r', group: 'rear', pos: v3(0.55, 0.02, -2.17), dir: v3(0, 0, 1), max: 6000 },
  { id: 'front-l', group: 'front', pos: v3(-0.62, 0.0, 2.17), dir: v3(0, 0, -1), max: 5000 },
  { id: 'front-r', group: 'front', pos: v3(0.62, 0.0, 2.17), dir: v3(0, 0, -1), max: 5000 },
  { id: 'kick-l', group: 'kick', pos: v3(-1.0, 0.42, 0), dir: v3(1, 0, 0), max: 4200 },
  { id: 'kick-r', group: 'kick', pos: v3(1.0, 0.42, 0), dir: v3(-1, 0, 0), max: 4200 },
];
// Body-frame torque per newton of each nozzle (r × d), precomputed for the mixer.
for (const n of NOZZLES) n.torque = cross(v3(), n.pos, n.dir);

const WHEELS = [
  v3(-CAR.wheelX, CAR.wheelY, CAR.wheelZ), v3(CAR.wheelX, CAR.wheelY, CAR.wheelZ),
  v3(-CAR.wheelX, CAR.wheelY, -CAR.wheelZ), v3(CAR.wheelX, CAR.wheelY, -CAR.wheelZ),
];
// Body hull probe points: 8 corners plus mid-edges, for ground and obstacle contact.
const HULL = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 0, 1]) {
  HULL.push(v3(sx * CAR.halfW, sy === -1 ? -0.2 : CAR.halfH, sz * CAR.halfL));
}
HULL.push(v3(0, CAR.halfH, 0), v3(0, -0.2, CAR.halfL), v3(0, -0.2, -CAR.halfL));

export const newInput = () => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0, thrust: 0, retro: 0, level: 0, assist: 1 });

export function createVehicle() {
  const s = {
    tick: 0,
    pos: v3(0, 0.6, START_Z), vel: v3(), quat: quatFromYaw(q4(), 0), angVel: v3(),
    air: CAR.airMass,
    throttles: new Float64Array(NOZZLES.length),   // actual valve state (lagged)
    wheels: WHEELS.map(() => ({ contact: false, compression: 0, prevCompression: 0, spin: 0, steer: 0 })),
    hullContact: false, hullImpulse: 0, obstacleContact: false, obstacleSpeed: 0,
    steer: 0,
  };
  // Settle onto the springs.
  s.pos.y = CAR.wheelR + CAR.restLen - CAR.wheelY - (CAR.dryMass + CAR.airMass) * G / 4 / CAR.spring;
  return s;
}

export const massOf = (s) => CAR.dryMass + Math.max(0, s.air);

// Scratch.
const tmp = v3(), tmp2 = v3(), r = v3(), pw = v3(), vp = v3(), n = v3(), force = v3(), torque = v3(),
  fwd = v3(), right = v3(), upW = v3(), fTot = v3(), tTot = v3(), wb = v3(), Lb = v3(), cmdT = v3();
const eff = { lift: 0, thrust: 0, retro: 0 };
const blowdown = (s) => 0.55 + 0.45 * Math.max(0, s.air) / CAR.airMass;

// Point velocity of a world-offset r: v + ω × r.
function pointVel(out, s, rw) { cross(out, s.angVel, rw); return add(out, out, s.vel); }

function applyAt(rw, f) {
  add(fTot, fTot, f);
  cross(tmp2, rw, f);
  add(tTot, tTot, tmp2);
}

// Mixer: pilot command → per-nozzle valve targets in [0,1]. Attitude has priority over lift:
// the lift group's base is lowered until its differential fits, like a quadcopter mixer.
const target = new Float64Array(NOZZLES.length);
export function mix(cmd, torqueCmd, out) {
  let maxDelta = 0;
  for (let i = 0; i < NOZZLES.length; i++) {
    const nz = NOZZLES[i];
    const t = nz.torque;
    const d = (t.x * torqueCmd.x + t.y * torqueCmd.y + t.z * torqueCmd.z) * 2.0;
    out[i] = d;
    if (nz.group === 'lift' && d > maxDelta) maxDelta = d;
  }
  const liftBase = Math.min(cmd.lift, 1 - Math.min(1, maxDelta));
  for (let i = 0; i < NOZZLES.length; i++) {
    const g = NOZZLES[i].group;
    const base = g === 'lift' ? liftBase : g === 'rear' ? cmd.thrust : g === 'front' ? cmd.retro || 0 : 0;
    out[i] = clamp(base + out[i], 0, 1);
  }
  return out;
}

// Flight computer: in Assist the stick commands angular *rates* (body frame) and the computer
// finds the torque. In Pro the stick is raw torque. Returns body-frame torque command (unitless).
const RATE = v3(2.6, 1.6, 5.2);
function flightComputer(s, inp, out) {
  rotateInv(wb, s.quat, s.angVel);
  // Stick: pitch +1 = nose down (push), roll +1 = roll right, yaw +1 = nose right.
  if (inp.assist) {
    const kp = 1.6;
    set(out,
      kp * (inp.pitch * RATE.x - wb.x),
      kp * (inp.yaw * RATE.y - wb.y),
      kp * (-inp.roll * RATE.z - wb.z));
    if (inp.level) {
      // Auto-level: drive body up toward world up (and keep the pitch/roll stick as a trim).
      rotateInv(upW, s.quat, set(tmp, 0, 1, 0));
      out.x += upW.z * 6 - wb.x * 1.4;
      out.z += -upW.x * 6 - wb.z * 1.4;
    }
  } else {
    set(out, inp.pitch, inp.yaw, -inp.roll);
  }
  out.x = clamp(out.x, -1, 1); out.y = clamp(out.y, -1, 1); out.z = clamp(out.z, -1, 1);
  return out;
}

// One fixed step. `inp` is the pilot (or autopilot) input for this tick.
export function step(s, inp) {
  const dt = DT;
  const m = massOf(s);
  set(fTot, 0, -m * G, 0);
  set(tTot, 0, 0, 0);

  rotate(fwd, s.quat, set(tmp, 0, 0, 1));
  rotate(right, s.quat, set(tmp, 1, 0, 0));
  rotate(upW, s.quat, set(tmp, 0, 1, 0));

  // --- Steering (rate-limited, speed-sensitive) ---
  const speed = Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z);
  const steerTarget = inp.steer * CAR.maxSteer / (1 + speed * 0.06);
  s.steer += clamp(steerTarget - s.steer, -2.5 * dt, 2.5 * dt);

  // --- Wheels: suspension + tyre forces ---
  let grounded = 0;
  for (let i = 0; i < WHEELS.length; i++) {
    const w = s.wheels[i];
    rotate(r, s.quat, WHEELS[i]);
    add(pw, s.pos, r);
    w.prevCompression = w.compression;
    w.contact = false;
    // Ray along body -y from the anchor.
    const downY = -upW.y;
    if (downY < -0.25) {
      const g = groundAt(pw.x, pw.z, n);
      const t = (pw.y - g) / -downY;               // distance along the ray to the ground
      const comp = CAR.restLen + CAR.wheelR - t;
      if (comp > 0) {
        w.contact = true; grounded++;
        w.compression = Math.min(comp, CAR.restLen + CAR.wheelR);
        const compRate = (w.compression - w.prevCompression) / dt;
        let fs = CAR.spring * Math.min(comp, CAR.maxTravel) + CAR.damper * compRate;
        if (comp > CAR.maxTravel) fs += CAR.bumpSpring * (comp - CAR.maxTravel);
        fs = Math.max(0, fs);
        // Contact patch.
        addScaled(tmp, r, upW, -t);
        pointVel(vp, s, tmp);
        scale(force, n, fs);
        // Tyre frame on the ground plane.
        const steerA = i < 2 ? s.steer : 0;
        w.steer = steerA;
        const cs = Math.cos(steerA), sn = Math.sin(steerA);
        set(tmp2, fwd.x * cs + right.x * sn, fwd.y * cs + right.y * sn, fwd.z * cs + right.z * sn);
        addScaled(tmp2, tmp2, n, -dot(tmp2, n));
        const lf = Math.hypot(tmp2.x, tmp2.y, tmp2.z) || 1;
        scale(tmp2, tmp2, 1 / lf);                  // wheel forward
        cross(Lb, n, tmp2);                          // wheel left
        const vLong = dot(vp, tmp2), vLat = dot(vp, Lb);
        const maxF = CAR.mu * fs;
        let fLong = 0;
        const drive = Math.min(CAR.driveForce, CAR.drivePower / Math.max(4, Math.abs(vLong)));
        fLong += inp.throttle * drive / 4;
        if (inp.brake > 0) fLong -= Math.sign(vLong) * Math.min(Math.abs(vLong) * 4000, inp.brake * CAR.brakeForce / 4);
        fLong -= vLong * 12;                          // rolling resistance
        let fLat = -vLat * CAR.lateralGrip;
        const mag = Math.hypot(fLong, fLat);
        if (mag > maxF) { fLong *= maxF / mag; fLat *= maxF / mag; }
        addScaled(force, force, tmp2, fLong);
        addScaled(force, force, Lb, fLat);
        applyAt(tmp, force);
        w.spin += (vLong / CAR.wheelR) * dt;
      } else {
        w.compression = 0;
      }
    } else {
      w.compression = 0;
    }
  }

  // --- Hull contact (roof, sills, bumpers) against ground and parked cars ---
  s.hullContact = false;
  s.hullGround = false;
  s.obstacleContact = false;
  for (let i = 0; i < HULL.length; i++) {
    rotate(r, s.quat, HULL[i]);
    add(pw, s.pos, r);
    pointVel(vp, s, r);
    let depth = 0;
    const g = groundAt(pw.x, pw.z, n);
    if (pw.y < g) depth = (g - pw.y) * n.y;
    const od = obstaclePenetration(pw, tmp2);
    let obstacle = false;
    if (od > depth) { depth = od; copy(n, tmp2); obstacle = true; }
    if (depth <= 0) continue;
    if (obstacle) { s.obstacleContact = true; s.obstacleSpeed = Math.max(s.obstacleSpeed, Math.hypot(vp.x, vp.y, vp.z)); }
    s.hullContact = true;
    if (!obstacle) s.hullGround = true;
    const vn = dot(vp, n);
    const fn = Math.max(0, 260000 * depth - 9000 * vn);
    s.hullImpulse = Math.max(s.hullImpulse, -vn);
    // Coulomb friction on the hull (scraping).
    addScaled(tmp, vp, n, -vn);
    const vt = Math.hypot(tmp.x, tmp.y, tmp.z);
    scale(force, n, fn);
    if (vt > 1e-4) addScaled(force, force, tmp, -Math.min(0.55 * fn, vt * 4000) / vt);
    applyAt(r, force);
  }

  // --- Thrusters ---
  flightComputer(s, inp, cmdT);
  // LAND (Assist): the computer also governs lift to bring the sink rate down to a soft
  // touchdown, measured against the ground under the car. Pilot lift still adds on top.
  eff.lift = inp.lift; eff.thrust = inp.thrust; eff.retro = inp.retro;
  if (inp.assist && inp.level && !grounded && s.air > 0) {
    const h = Math.max(0, s.pos.y - groundAt(s.pos.x, s.pos.z, null) - 0.62);
    const wantVy = -Math.max(0.8, Math.min(7, Math.sqrt(h * 2 * 2.4)));
    if (s.vel.y < wantVy && upW.y > 0.6) eff.lift = Math.max(eff.lift, clamp((wantVy - s.vel.y) * 0.8 + 0.5, 0, 1));
  }
  mix(eff, cmdT, target);
  const bd = blowdown(s);
  let mdot = 0;
  for (let i = 0; i < NOZZLES.length; i++) {
    const nz = NOZZLES[i];
    const goal = s.air > 0 ? target[i] : 0;
    s.throttles[i] += (goal - s.throttles[i]) * Math.min(1, dt / 0.035);
    const F = nz.max * s.throttles[i] * bd;
    if (F <= 0) continue;
    rotate(r, s.quat, nz.pos);
    rotate(force, s.quat, nz.dir);
    scale(force, force, F);
    applyAt(r, force);
    mdot += F / (CAR.isp * G);
  }
  s.air = Math.max(0, s.air - mdot * dt);

  // --- Aero drag ---
  const vmag = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  addScaled(fTot, fTot, s.vel, -CAR.drag * vmag);

  // --- Integrate (semi-implicit Euler) ---
  addScaled(s.vel, s.vel, fTot, dt / m);
  addScaled(s.pos, s.pos, s.vel, dt);
  // Angular: world torque → body, divide by body inertia, back to world. Gyroscopic term kept.
  rotateInv(Lb, s.quat, tTot);
  rotateInv(wb, s.quat, s.angVel);
  const Ix = CAR.inertiaPerKg.x * m, Iy = CAR.inertiaPerKg.y * m, Iz = CAR.inertiaPerKg.z * m;
  // τ - ω × (Iω)
  const hx = Ix * wb.x, hy = Iy * wb.y, hz = Iz * wb.z;
  const gx = wb.y * hz - wb.z * hy, gy = wb.z * hx - wb.x * hz, gz = wb.x * hy - wb.y * hx;
  wb.x += ((Lb.x - gx) / Ix) * dt;
  wb.y += ((Lb.y - gy) / Iy) * dt;
  wb.z += ((Lb.z - gz) / Iz) * dt;
  // A little angular damping (air + suspension losses).
  const ad = grounded ? 0.995 : 0.9995;
  wb.x *= ad; wb.y *= ad; wb.z *= ad;
  rotate(s.angVel, s.quat, wb);
  integrateQuat(s.quat, s.angVel, dt);

  s.grounded = grounded;
  s.tick++;
  return s;
}

// Body-frame angular velocity (for telemetry: roll rate about the car's own nose axis).
export function bodyRates(s, out) { return rotateInv(out, s.quat, s.angVel); }
export function up(s, out) { return rotate(out, s.quat, set(out, 0, 1, 0)); }
export function forward(s, out) { return rotate(out, s.quat, set(out, 0, 0, 1)); }
export function worldPoint(s, local, out) { rotate(out, s.quat, local); return add(out, out, s.pos); }
export { WHEELS, HULL, sub };
