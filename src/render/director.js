// The camera director, keyed by course.
//
// Lineup: a low chase cam that swings out to a broadcast three-quarter when the car leaves the
// lip, so the roll reads in profile. Replay hard-cuts between fixed rigs, like the reveal film.
// Title is a slow turntable on the pad.
//
// Wall: a chase cam on the approach hands over to a side camera that keeps the car and the whole
// curl in frame as it climbs. When it hangs inverted on the ledge, a dramatic wide shot takes
// over, which tracks the fall and the roll; a low landing cam finishes. Replay cuts between the
// reference-image wide side shot, a low shot at the base looking up the wall, a ledge close-up and
// a landing cam. Title parks the car at the foot of the curl with the curl towering behind.
//
// Show: the Wall's cameras for the first leg; for the second, the Lineup's rigs run in the
// lineup lane's own frame and the camera is turned onto the lane with the same half turn the
// physics uses (src/sim/courses.js SHOW).
import * as THREE from 'three';
import { LINEUP, WALL, showLocalX, showLocalZ } from '../sim/courses.js';

const PAD = LINEUP.pad, LINEUP_Z0 = LINEUP.lineupZ0, LINEUP_END = LINEUP.lineupEnd;
const tmp = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createDirector(camera) {
  const st = {
    mode: '', course: '', t: 0, shot: -1, smooth: new THREE.Vector3(), lookS: new THREE.Vector3(), fov: 52, shake: 0, init: false,
    peak: 0, launched: false, launchT: 0, leg: 0,
    hx: 0, hz: 1,                 // chase heading (unit, xz), follows the car's travel
  };
  const halfTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const lp = new THREE.Vector3(), lv = new THREE.Vector3();

  function snap() { st.init = false; }

  // Smoothly fly the camera toward want/lookWant (rate per second).
  function ease(dt, rate, lookRate = 8) {
    if (!st.init) { st.smooth.copy(want); st.lookS.copy(lookWant); st.init = true; }
    st.smooth.lerp(want, 1 - Math.exp(-dt * rate));
    st.lookS.lerp(lookWant, 1 - Math.exp(-dt * lookRate));
    camera.position.copy(st.smooth);
    camera.lookAt(st.lookS);
  }
  const fovTo = (f, dt, rate = 2) => { st.fov += (f - st.fov) * (1 - Math.exp(-dt * rate)); };

  // --- Lineup -----------------------------------------------------------------------------------
  function chase(carPos, carVel, phase, dt) {
    const speed = Math.hypot(carVel.x, carVel.z);
    // Follow the direction of travel (smoothed), so a steering input reads as a turn on screen.
    if (speed > 1.5) {
      const k = 1 - Math.exp(-dt * 3);
      st.hx += (carVel.x / speed - st.hx) * k; st.hz += (carVel.z / speed - st.hz) * k;
      const l = Math.hypot(st.hx, st.hz) || 1; st.hx /= l; st.hz /= l;
    }
    const hx = st.hx, hz = st.hz;
    if (phase === 'air' || (phase === 'landed' && st.t < 1.2)) {
      // Broadcast three-quarter: off to the right, a little ahead, low.
      want.set(carPos.x + 14, Math.max(3.4, carPos.y * 0.6 + 2.2), carPos.z + 2 - Math.min(6, speed * 0.15));
      lookWant.set(carPos.x, carPos.y + 0.2, carPos.z + 3);
    } else if (phase === 'landed' || phase === 'done') {
      want.set(carPos.x + 7, 2.4, carPos.z - 6);
      lookWant.copy(carPos);
    } else {
      // Car sits just below centre, clear of the HUD; the camera trails the heading.
      const back = 7.4 + speed * 0.06;
      want.set(carPos.x - hx * back, carPos.y + 2.0 + speed * 0.012, carPos.z - hz * back);
      lookWant.set(carPos.x + hx * 4.5, carPos.y + 0.35, carPos.z + hz * 4.5);
    }
    ease(dt, phase === 'air' ? 3.2 : 5);
    fovTo(48 + Math.min(16, speed * 0.42) + (phase === 'air' ? 4 : 0), dt);
  }

  function replay(carPos) {
    let shot;
    if (carPos.z < LINEUP.liftOffZ - 37) shot = 0;
    else if (carPos.z < LINEUP_Z0 - 4) shot = 1;
    else if (carPos.z < LINEUP_END + 6) shot = 2;
    else shot = 3;
    if (shot !== st.shot) { st.shot = shot; st.init = false; }
    switch (shot) {
      case 0: // low tracking, front quarter
        camera.position.set(carPos.x - 3.2, 0.5, carPos.z + 7.5); camera.lookAt(carPos.x, carPos.y + 0.3, carPos.z); st.fov = 36; break;
      case 1: // locked off at the lip, very low
        camera.position.set(-5.5, 0.35, LINEUP.liftOffZ + 3); camera.lookAt(carPos.x, carPos.y + 0.4, carPos.z); st.fov = 42; break;
      case 2: // wide side-on over the lineup: the money shot
        camera.position.set(26, 3.6, (LINEUP_Z0 + LINEUP_END) / 2 + 2); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 34; break;
      default: // landing cam, behind the pad
        camera.position.set(6, 1.1, PAD.z + 22); camera.lookAt(carPos.x, carPos.y + 0.2, carPos.z); st.fov = 30; break;
    }
  }

  function titleLineup(time) {
    const a = time * 0.12;
    camera.position.set(PAD.x + Math.cos(a) * 9.6, 1.45 + Math.sin(time * 0.2) * 0.12, PAD.z + Math.sin(a) * 9.6);
    camera.lookAt(PAD.x, 0.55, PAD.z);
    st.fov = 34;
  }

  // --- Wall --------------------------------------------------------------------------------------
  // Where the stunt is, from the car's state alone: climbing, hanging on the ledge, launched.
  function trackWall(carPos, carVel, phase) {
    if (carPos.z < WALL.start.z + 25 && carPos.y < 2) { st.peak = 0; st.launched = false; }   // a new run (or replay loop)
    st.peak = Math.max(st.peak, carPos.y);
    if (!st.launched && st.peak > 6 && (carPos.z < WALL.lip.z - 0.8 || (phase === 'air' && carVel.y < -1))) {
      st.launched = true; st.launchT = st.t;
    }
  }

  function wallLive(carPos, carVel, phase, dt) {
    trackWall(carPos, carVel, phase);
    const speed = Math.hypot(carVel.x, carVel.y, carVel.z);
    const landed = st.launched && (phase === 'landed' || phase === 'done' || (carPos.y < 1.0 && st.t - st.launchT > 0.6));
    if (!st.launched && carPos.z < -16 && st.peak < 1.5) {
      // Approach: chase from behind, the curl growing ahead.
      want.set(carPos.x * 0.6, carPos.y + 2.1 + speed * 0.012, carPos.z - 7.6 - speed * 0.07);
      lookWant.set(carPos.x, carPos.y + 0.9 + Math.max(0, 30 + carPos.z) * 0.12, carPos.z + 6);
      ease(dt, 5);
      fovTo(50 + Math.min(14, speed * 0.36), dt);
    } else if (!st.launched && carPos.y < 15) {
      // Climbing: swing out to the side, keep the car and the whole curl in frame.
      want.set(24, clamp(carPos.y * 0.7 + 4, 3.2, 22), Math.min(carPos.z, 6) - 11);
      lookWant.set(carPos.x * 0.5, carPos.y * 0.75 + 3.5, carPos.z * 0.6 + 3);
      ease(dt, 2.6, 6);
      fovTo(50, dt);
    } else if (!st.launched) {
      // Hanging inverted on the ledge: the dramatic wide shot.
      want.set(27, 13.5, -13);
      lookWant.set(carPos.x * 0.3, carPos.y * 0.6 + 6, carPos.z * 0.5 + 2.5);
      ease(dt, 1.8, 4);
      fovTo(46, dt, 1.5);
    } else if (!landed) {
      // The fall and the roll: wide from the side, tracking.
      want.set(carPos.x + 19, clamp(carPos.y * 0.55 + 3.5, 3, 18), carPos.z + 5);
      lookWant.set(carPos.x, carPos.y, carPos.z - 1.5);
      ease(dt, 3.2, 9);
      fovTo(48, dt);
    } else {
      // Landed: low, ahead of the car as it rolls back down the approach.
      want.set(carPos.x + 6.5, 1.25, carPos.z - 9);
      lookWant.set(carPos.x, carPos.y + 0.2, carPos.z);
      ease(dt, 3, 8);
      fovTo(40, dt);
    }
  }

  function wallReplay(carPos, carVel, phase) {
    trackWall(carPos, carVel, phase);
    let shot;
    if (!st.launched && carPos.z < -22 && st.peak < 1.5) shot = 0;
    else if (!st.launched && carPos.y < 8) shot = 1;
    else if (!st.launched && carPos.y < 16) shot = 2;
    else if (!st.launched) shot = 3;
    else if (carPos.y > 2.6) shot = 4;
    else shot = 5;
    if (shot !== st.shot) { st.shot = shot; st.init = false; }
    switch (shot) {
      case 0: // low tracking on the approach, front quarter
        camera.position.set(carPos.x - 3.4, 0.55, carPos.z + 9); camera.lookAt(carPos.x, carPos.y + 0.4, carPos.z); st.fov = 38; break;
      case 1: // the reference image: wide from the side, the whole curl, truss and beams
        camera.position.set(31, 8.5, -9); camera.lookAt(0.5, 11.5, 5.5); st.fov = 47; break;
      case 2: // at the foot of the wall, looking straight up it
        camera.position.set(1.9, 0.45, -2.6); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 60; break;
      case 3: // ledge close-up: below and in front of the overhang, looking up at the car hanging under it
        camera.position.set(7.5, WALL.lip.y - 5, WALL.lip.z - 10); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 44; break;
      case 4: // the fall and the roll, wide from the side
        camera.position.set(28, 7.5, -16); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 42; break;
      default: // landing cam, beyond the pad looking back at the wall
        camera.position.set(5.5, 1.0, WALL.pad.z - 22); camera.lookAt(carPos.x, carPos.y + 0.3, carPos.z); st.fov = 34; break;
    }
  }

  function titleWall(time) {
    // The car parked at the foot of the curl; the camera sways on the approach side so the curl
    // towers behind it.
    const a = Math.sin(time * 0.07) * 0.5, R = 12.5;
    const cx = 0, cz = -11;   // matches the wall look's titlePose
    camera.position.set(cx + Math.sin(a) * R, 1.25 + Math.sin(time * 0.2) * 0.08, cz - Math.cos(a) * R);
    camera.lookAt(cx * 0.5, 7.2, cz + 9);
    st.fov = 54;
  }

  function frameOffset(on) {
    const w = innerWidth, h = innerHeight;
    if (on && w / h > 1.15) camera.setViewOffset(w, h, -w * 0.2, h * 0.04, w, h);
    else if (camera.view?.enabled) camera.clearViewOffset();
  }

  // The Show's second leg: run a Lineup rig in the lane's frame, then turn the camera onto it.
  function inLane(fn, carPos, carVel, phase, dt) {
    lp.set(showLocalX(carPos.x), carPos.y, showLocalZ(carPos.z));
    lv.set(-carVel.x, carVel.y, -carVel.z);
    fn(lp, lv, phase, dt);
    camera.position.set(showLocalX(camera.position.x), camera.position.y, showLocalZ(camera.position.z));
    camera.quaternion.premultiply(halfTurn);
  }

  // update(dt, time, { carPos, carVel, phase, mode: 'title' | 'live' | 'replay', course: 'show' | 'wall' | 'lineup', leg })
  function update(dt, time, { carPos, carVel, phase, mode, course = 'show', leg = 0 }) {
    if (mode !== st.mode || course !== st.course) {
      st.mode = mode; st.course = course; st.t = 0; st.shot = -1; st.peak = 0; st.launched = false; st.leg = leg;
      st.hx = 0; st.hz = 1;
      snap(); frameOffset(mode === 'title');
    }
    if (leg !== st.leg) { st.leg = leg; st.t = 0; st.shot = -1; st.hx = 0; st.hz = 1; snap(); }
    st.t += dt;
    if (course === 'show' && mode !== 'title' && leg === 1) {
      inLane(mode === 'replay' ? (p) => replay(p) : chase, carPos, carVel, phase, dt);
    } else if (course === 'wall' || course === 'show') {
      if (mode === 'title') titleWall(time);
      else if (mode === 'replay') wallReplay(carPos, carVel, phase);
      else wallLive(carPos, carVel, phase, dt);
    } else if (mode === 'title') titleLineup(time);
    else if (mode === 'replay') replay(carPos);
    else chase(carPos, carVel, phase, dt);
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt * 3);
      tmp.set(Math.sin(time * 91), Math.sin(time * 77 + 1), 0).multiplyScalar(st.shake * 0.08);
      camera.position.add(tmp);
    }
    if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
  }

  return { update, snap, reframe: () => frameOffset(st.mode === 'title'), shake: (s) => { st.shake = Math.max(st.shake, s); }, state: st };
}
