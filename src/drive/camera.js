// Free Drive's cameras.
//   chase    behind and above, trailing the car's heading (leaning toward where it's actually
//            going in a slide), lengthening with speed, kept clear of the ground and the walls
//   bumper   on the nose, horizon locked to the car
//   cinema   a television director: trackside long-lens cameras on the outside of the next bend,
//            a low car-to-car shot ahead, and a helicopter, cutting as the car passes
import * as THREE from 'three';
import { roadSurface, terrainAt, nearestSample } from '../sim/roads.js';

export const CAM_MODES = ['chase', 'bumper', 'cinema'];
const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), upv = new THREE.Vector3(), want = new THREE.Vector3(), look = new THREE.Vector3();
const sn = { x: 0, y: 0, z: 0 }, t3 = [0, 0, 0];

export function createDriveCamera(camera, road) {
  const st = {
    mode: 'chase', init: false, hx: 0, hz: 1, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 58,
    shot: null, shotT: 0, shotN: 0, hint: 0,
  };
  const clearance = (p, min) => {
    // Lift a camera point clear of the ground, the road and the walls.
    const d = roadSurface(road, p.x, p.y, p.z, sn);
    if (d < min) p.y += min - d;
  };

  function chase(dt, car, speed) {
    fwd.set(0, 0, 1).applyQuaternion(car.quat);
    let fx = fwd.x, fz = fwd.z;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    // In a slide, look where the car is going, but not past ≈35° off its nose.
    const vx = car.vel.x, vz = car.vel.z, vl = Math.hypot(vx, vz);
    if (vl > 4 && (vx * fx + vz * fz) / vl > 0.2) { const k = Math.min(1, (vl - 4) / 10) * 0.55; fx = fx * (1 - k) + (vx / vl) * k; fz = fz * (1 - k) + (vz / vl) * k; }
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    if (!st.init) { st.hx = fx; st.hz = fz; }
    const k = 1 - Math.exp(-dt * (3.2 + speed * 0.04));
    st.hx += (fx - st.hx) * k; st.hz += (fz - st.hz) * k;
    const hl = Math.hypot(st.hx, st.hz) || 1; st.hx /= hl; st.hz /= hl;
    const back = Math.min(9.5, 6.3 + speed * 0.04), up = 1.85 + Math.min(1.2, speed * 0.008);
    want.set(car.pos.x - st.hx * back, car.pos.y + up, car.pos.z - st.hz * back);
    clearance(want, 1.1);
    look.set(car.pos.x + st.hx * 4, car.pos.y + 0.85, car.pos.z + st.hz * 4);
    if (!st.init) { st.pos.copy(want); st.look.copy(look); st.init = true; }
    const kp = 1 - Math.exp(-dt * 12), ky = 1 - Math.exp(-dt * 7);
    st.pos.x += (want.x - st.pos.x) * kp; st.pos.z += (want.z - st.pos.z) * kp; st.pos.y += (want.y - st.pos.y) * ky;
    clearance(st.pos, 0.6);
    st.look.lerp(look, 1 - Math.exp(-dt * 14));
    camera.up.set(0, 1, 0);
    camera.position.copy(st.pos);
    camera.lookAt(st.look);
    st.fov += (56 + Math.min(20, speed * 0.13) - st.fov) * (1 - Math.exp(-dt * 2.5));
  }

  function bumper(car, speed) {
    fwd.set(0, 0, 1).applyQuaternion(car.quat);
    upv.set(0, 1, 0).applyQuaternion(car.quat);
    camera.position.copy(car.pos).addScaledVector(fwd, 0.55).addScaledVector(upv, 0.62);
    camera.up.copy(upv);
    camera.lookAt(tmp.copy(camera.position).addScaledVector(fwd, 30).addScaledVector(upv, -0.6));
    st.fov = 66 + Math.min(10, speed * 0.06);
    st.init = false;
  }

  // Cinema: choose a shot, hold it until the car is past it, cut.
  function pickShot(car, dir) {
    const sp = road.meta.spacing;
    const i = nearestSample(road, car.pos.x, car.pos.z, st.hint, 80);
    st.hint = i;
    st.shotN++;
    const kind = st.shotN % 4 === 3 ? 'heli' : st.shotN % 4 === 1 ? 'lead' : 'track';
    const shot = { kind, pos: new THREE.Vector3(), i, t: 0 };
    if (kind === 'track') {
      // Ahead on the outside of the coming bend, at head height or up the bank.
      const j = Math.max(1, Math.min(road.n - 2, i + Math.round((dir * (90 + (st.shotN % 3) * 35)) / sp)));
      const a = Math.max(0, j - 6), b = Math.min(road.n - 1, j + 6);
      const ax = road.x[j] - road.x[a], az = road.z[j] - road.z[a], bx = road.x[b] - road.x[j], bz = road.z[b] - road.z[j];
      const turn = ax * bz - az * bx;                  // < 0: turning left (z south)
      const side = turn < 0 ? -1 : 1;                  // outside of the bend (left = +)
      const lx = road.dz[Math.min(j, road.m - 1)], lz = -road.dx[Math.min(j, road.m - 1)];
      const off = road.hw[j] + 7 + (st.shotN % 2) * 6;
      shot.pos.set(road.x[j] + lx * off * side, 0, road.z[j] + lz * off * side);
      shot.pos.y = terrainAt(road, shot.pos.x, shot.pos.z, t3)[0] + 1.4 + (st.shotN % 3) * 1.6;
      shot.pos.y = Math.max(shot.pos.y, road.y[j] + 1.2);
    }
    return shot;
  }

  function cinema(dt, car, speed) {
    const vx = car.vel.x, vz = car.vel.z, vl = Math.hypot(vx, vz);
    fwd.set(0, 0, 1).applyQuaternion(car.quat);
    let dir = 1;
    {
      const i = nearestSample(road, car.pos.x, car.pos.z, st.hint, 80); st.hint = i;
      const m = Math.min(i, road.m - 1);
      dir = road.dx[m] * (vl > 1 ? vx : fwd.x) + road.dz[m] * (vl > 1 ? vz : fwd.z) >= 0 ? 1 : -1;
    }
    let s = st.shot;
    if (s) {
      s.t += dt;
      const d = car.pos.distanceTo(s.pos);
      const past = s.kind === 'track' && (car.pos.x - s.pos.x) * (vl > 1 ? vx / vl : 0) + (car.pos.z - s.pos.z) * (vl > 1 ? vz / vl : 0) > 30;
      if (past || (s.kind === 'track' && d > 320) || (s.kind !== 'track' && s.t > 7)) s = null;
    }
    if (!s) { s = st.shot = pickShot(car, dir); }
    if (s.kind === 'lead') {
      // Car-to-car: low, ahead, looking back at the car.
      const hx = vl > 2 ? vx / vl : fwd.x, hz = vl > 2 ? vz / vl : fwd.z;
      want.set(car.pos.x + hx * (8 + speed * 0.05) + hz * 1.2, car.pos.y + 0.7, car.pos.z + hz * (8 + speed * 0.05) - hx * 1.2);
      clearance(want, 0.5);
      if (s.t === dt || !st.init) st.pos.copy(want);
      st.pos.lerp(want, 1 - Math.exp(-dt * 6));
      camera.position.copy(st.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(car.pos.x, car.pos.y + 0.3, car.pos.z);
      st.fov = 42;
    } else if (s.kind === 'heli') {
      const hx = vl > 2 ? vx / vl : fwd.x, hz = vl > 2 ? vz / vl : fwd.z;
      const a = s.t * 0.12;
      want.set(car.pos.x + (hz * 55 + hx * 25) * Math.cos(a) - hx * 20, car.pos.y + 38, car.pos.z + (-hx * 55 + hz * 25) * Math.cos(a) - hz * 20);
      clearance(want, 25);
      if (s.t === dt || !st.init) st.pos.copy(want);
      st.pos.lerp(want, 1 - Math.exp(-dt * 1.5));
      camera.position.copy(st.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(car.pos.x, car.pos.y, car.pos.z);
      st.fov = 38;
    } else {
      camera.position.copy(s.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(car.pos.x, car.pos.y + 0.4, car.pos.z);
      const d = car.pos.distanceTo(s.pos);
      st.fov = Math.min(55, Math.max(9, (2 * Math.atan(7 / Math.max(1, d)) * 180) / Math.PI));
    }
    st.init = true;
  }

  function update(dt, car, time) {
    const speed = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
    if (st.mode === 'chase') chase(dt, car, speed);
    else if (st.mode === 'bumper') bumper(car, speed);
    else cinema(dt, car, speed);
    if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
    void time;
  }

  return {
    update,
    snap() { st.init = false; st.shot = null; },
    cycle() { st.mode = CAM_MODES[(CAM_MODES.indexOf(st.mode) + 1) % CAM_MODES.length]; st.init = false; st.shot = null; return st.mode; },
    get mode() { return st.mode; },
    set mode(m) { st.mode = m; st.init = false; st.shot = null; },
    state: st,
  };
}
