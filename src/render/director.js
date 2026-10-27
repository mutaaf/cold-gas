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
// Show: the Wall's cameras; the row sits under the ledge, so the fall and the carry over it play
// out in the same wide shots.
//
// Pilot view (L, and the default in practice): from the release to the touchdown the camera rides
// behind and above the car along its line of flight, looking down at the ground ahead. The side
// shots read pitch beautifully but see a roll end-on; from behind, the roll-out and the drift
// toward the pad read at a glance.
import * as THREE from 'three';
import { LINEUP, WALL, SHOW } from '../sim/courses.js';
import { hudMode } from '../hud-mode.js';

const PAD = LINEUP.pad, LINEUP_Z0 = LINEUP.lineupZ0, LINEUP_END = LINEUP.lineupEnd;
const tmp = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3(), qInv = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// The Wall's rigs were framed on a 19.8 m lip; they scale with the wall's real height.
const K = WALL.lip.y / 19.8;

export function createDirector(camera) {
  const st = {
    mode: '', course: '', t: 0, shot: -1, smooth: new THREE.Vector3(), lookS: new THREE.Vector3(), fov: 52, shake: 0, init: false,
    dip: 0, punch: 0,           // touchdown: camera drop (m) and FOV punch-in (deg), both decay
    peak: 0, launched: false, launchT: 0,
    hx: 0, hz: 1,                 // chase heading (unit, xz), follows the car's travel
    cutT: 0, cutPos: new THREE.Vector3(), cutFov: 40,   // a crash cut (src/render/crash.js)
    view: 'broadcast', px: 0, pz: -1,                    // pilot view: on/off, its heading
    clear: 1,                                            // keepClear's strength (0 in the pilot view)
    // The replay's own region of the screen (0068): what the results leave uncovered, in CSS px. The
    // replay's lens is shifted to its centre, and the wide locked-off rig aims toward the car's path by
    // `aim` (0 = the reference framing, 1 = on the path) as the region narrows.
    rl: 0, rt: 0, rr: 0, rb: 0, aim: 0,
  };

  // Behind, above and to the side of the car along its line of flight (the last good heading when
  // it's slow), looking down at the ground ahead. Off to the side so that, at the release, the
  // camera is clear of the Wall's deck and truss (3.7 m wide) behind the car.
  function pilot(carPos, carVel, dt) {
    const hl = Math.hypot(carVel.x, carVel.z);
    if (hl > 1.2) { st.px = carVel.x / hl; st.pz = carVel.z / hl; }
    const sx = -st.pz, sz = st.px;   // the side (+x for a car heading −z: the broadcast side)
    want.set(carPos.x - st.px * 8 + sx * 7, carPos.y + 5.5, carPos.z - st.pz * 8 + sz * 7);
    lookWant.set(carPos.x + st.px * 4, Math.max(0, carPos.y * 0.85 - 3), carPos.z + st.pz * 4);
    ease(dt, 3.6, 9);
    fovTo(58, dt);
  }

  function snap() { st.init = false; }
  // A new run, a replay from the top or its loop: forget the last stunt (the Wall starts a few
  // metres from where it lands, so the car's position can't tell a new run from a landing).
  function restart() { st.peak = 0; st.launched = false; snap(); }

  // Smoothly fly the camera toward want/lookWant (rate per second).
  function ease(dt, rate, lookRate = 8) {
    if (!st.init) { st.smooth.copy(want); st.lookS.copy(lookWant); st.init = true; }
    st.smooth.lerp(want, 1 - Math.exp(-dt * rate));
    st.lookS.lerp(lookWant, 1 - Math.exp(-dt * lookRate));
    camera.position.copy(st.smooth);
    camera.lookAt(st.lookS);
  }
  const fovTo = (f, dt, rate = 2) => { st.fov += (f - st.fov) * (1 - Math.exp(-dt * rate)); };

  // Keep the car out from under the HUD (0063): after a shot has looked where it wants, turn the camera
  // just enough that the car's centre is no higher than a quarter of the way down the frame (under the
  // top bar and the timeline), and, once launched, where the compact HUD stands as a rail on the left
  // edge (a touch screen held upright), right of it as the car rises into the top third. A car already
  // clear is left where the shot put it; the turn comes in through a soft knee as the car nears the line,
  // and the whole correction fades in and out (the pilot view goes without it), so it never cuts.
  // Upright with the full set (a 13" iPad), the telemetry strip stands under the mission block down to
  // about 29 % of the height, so the line drops to 35 % there.
  const TOP = 0.5, TOP_TALL = 0.3, RAIL = 0.3, KNEE = 0.06;   // NDC: the highest the car's centre goes (upright, full HUD); upright, the leftmost up there; rad
  const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  const knee = (e) => (e <= 0 ? 0 : e < KNEE ? (e * e) / (2 * KNEE) : e - KNEE / 2);   // 0 → e − k/2, C¹
  function keepClear(carPos, on, dt) {
    st.clear += ((on ? 1 : 0) - st.clear) * (1 - Math.exp(-dt * 5));
    if (st.clear < 0.002) return;
    const tv = Math.tan(st.fov * Math.PI / 360);
    if (st.launched && camera.aspect < 1 && coarse?.matches && hudMode() === 'compact') {
      tmp.copy(carPos).sub(camera.position).applyQuaternion(qInv.copy(camera.quaternion).invert());
      if (tmp.z > -0.5) return;
      const ny = tmp.y / -tmp.z / tv, w = clamp((ny - 0.1) / 0.25, 0, 1);
      const min = Math.atan(RAIL * w * tv * camera.aspect) + KNEE / 2;
      // About the world's up, so the horizon stays level.
      camera.rotateOnWorldAxis(UP, st.clear * knee(min - Math.atan2(tmp.x, -tmp.z)));
    }
    tmp.copy(carPos).sub(camera.position).applyQuaternion(qInv.copy(camera.quaternion).invert());
    if (tmp.z > -0.5) return;
    const top = camera.aspect < 1 && hudMode() === 'full' ? TOP_TALL : TOP;
    camera.rotateX(st.clear * knee(Math.atan2(tmp.y, -tmp.z) - Math.atan(top * tv) + KNEE / 2));
  }

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
    // The mark sits just past the row: the orbit flattens on the row's side rather than skim the cab.
    camera.position.set(PAD.x + Math.cos(a) * 9.6, 1.45 + Math.sin(time * 0.2) * 0.12, Math.max(LINEUP_END + 3, PAD.z + Math.sin(a) * 9.6));
    camera.lookAt(PAD.x, 0.55, PAD.z);
    st.fov = 34;
  }

  // --- Wall --------------------------------------------------------------------------------------
  // Where the stunt is, from the car's state alone: climbing, hanging on the ledge, launched.
  function trackWall(carPos, carVel, phase) {
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
    } else if (!st.launched && carPos.y < 15 * K) {
      // Climbing: swing out to the side, keep the car and the whole curl in frame.
      want.set(24 * K, clamp(carPos.y * 0.7 + 4, 3.2, 22 * K), Math.min(carPos.z, 6 * K) - 11 * K);
      lookWant.set(carPos.x * 0.5, carPos.y * 0.75 + 3.5, carPos.z * 0.6 + 3);
      ease(dt, 2.6, 6);
      fovTo(50, dt);
    } else if (!st.launched) {
      // Hanging inverted on the ledge: the dramatic wide shot.
      want.set(27 * K, 13.5 * K, -13 * K);
      lookWant.set(carPos.x * 0.3, carPos.y * 0.6 + 6, carPos.z * 0.5 + 2.5);
      ease(dt, 1.8, 4);
      fovTo(46, dt, 1.5);
    } else if (!landed && st.view === 'pilot') {
      pilot(carPos, carVel, dt);
    } else if (!landed && st.course === 'show') {
      // The carry over the row: low and wide from the side, so the roofs under the car stay in frame.
      // High in the fall it stands back and rises with the car, so the car (held under the top HUD by
      // keepClear) and the roofs below it both fit (0063).
      want.set(carPos.x + 21 + 0.5 * Math.max(0, carPos.y - 10), clamp(carPos.y * 0.5 + 1.5, 2.2, 14), carPos.z + 2);
      lookWant.set(carPos.x * 0.5, carPos.y * 0.55 + 0.8, carPos.z - 2);
      ease(dt, 3.2, 9);
      fovTo(54, dt);
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
    else if (!st.launched && carPos.y < 8 * K) shot = 1;
    else if (!st.launched && carPos.y < 16 * K) shot = 2;
    else if (!st.launched) shot = 3;
    else if (carPos.y > 2.6) shot = 4;
    else shot = 5;
    if (shot !== st.shot) { st.shot = shot; st.init = false; }
    switch (shot) {
      case 0: // low tracking on the approach, front quarter
        camera.position.set(carPos.x - 3.4, 0.55, carPos.z + 9); camera.lookAt(carPos.x, carPos.y + 0.4, carPos.z); st.fov = 38; break;
      case 1: { // the reference image: wide from the side, the whole curl, truss and beams
        const a = st.aim;
        if (a === 0) { camera.position.set(31 * K, 8.5 * K, -9 * K); camera.lookAt(0.5, 11.5 * K, 5.5 * K); st.fov = 47; break; }
        // In a narrow region (0068) it stays locked off but turns toward the middle of the car's path still to
        // come in the shot (from where the car is to the curl at 8 K), so the climb plays in the strip the
        // results leave. Locked off, not a pan (a pan over the lit truss shimmers, flicker.mjs); a strip too
        // narrow for the whole climb gets a hard cut to the rest of it when the car nears its edge.
        camera.position.set(31 * K, 8.5 * K, -9 * K);
        if (st.init) {
          camera.lookAt(st.lookS); camera.updateMatrixWorld();
          tmp.copy(carPos).project(camera);
          const px = (tmp.x + 1) / 2 * innerWidth, mx = (st.rr - st.rl) * 0.1;
          if (px < st.rl + mx || px > st.rr - mx) st.init = false;
        }
        if (!st.init) {
          st.lookS.set(carPos.x / 2, (carPos.y + 8 * K) / 2, (carPos.z + 9.3 * K) / 2);
          st.lookS.set(0.5 + (st.lookS.x - 0.5) * a, 11.5 * K + (st.lookS.y - 11.5 * K) * a, 5.5 * K + (st.lookS.z - 5.5 * K) * a);
          st.init = true;
        }
        camera.lookAt(st.lookS); st.fov = 47; break;
      }
      case 2: // at the foot of the wall, looking straight up it
        camera.position.set(1.9, 0.45, -2.6); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 60; break;
      case 3: // ledge close-up: below and in front of the overhang, looking up at the car hanging under it
        camera.position.set(7.5, WALL.lip.y - 5, WALL.lip.z - 10); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 44; break;
      case 4: { // the fall and the roll, wide from the side (on the Show, over the row)
        const show = st.course === 'show';
        camera.position.set(show ? 30 : 28, show ? 8.5 : 7.5, show ? -19 : -16);
        camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = show ? 46 : 42; break;
      }
      default: // landing cam, beyond the pad looking back at the wall
        camera.position.set(5.5, 1.0, (st.course === 'show' ? SHOW.pad.z : WALL.pad.z) - 22); camera.lookAt(carPos.x, carPos.y + 0.3, carPos.z); st.fov = 34; break;
    }
  }

  function titleWall(time) {
    // The car parked at the foot of the curl; the camera sways on the approach side so the curl
    // towers behind it.
    const a = Math.sin(time * 0.07) * 0.5, R = 12.5 * K;
    const cx = 0, cz = -11;   // matches the wall look's titlePose
    camera.position.set(cx + Math.sin(a) * R, 1.25 + Math.sin(time * 0.2) * 0.08, cz - Math.cos(a) * R);
    camera.lookAt(cx * 0.5, 7.2 * K, cz + 9 * K);
    st.fov = 54;
  }

  function titleShow(time) {
    // The car at the start, just short of the curl, the parked row behind it: a slow side sway
    // that keeps all three in frame.
    const a = Math.sin(time * 0.07) * 0.28;
    camera.position.set(15 * K * Math.cos(a), 2.4 + Math.sin(time * 0.2) * 0.08, -13 + 15 * K * Math.sin(a));
    camera.lookAt(-1, 6.2 * K, -4);
    st.fov = 56;
  }

  // The title's lens sits right of the panel on a wide screen. The replay's sits at the centre of the
  // region the results leave uncovered (0068): left of the sheet on a wide screen, above the peek on a
  // phone. A full-screen region is no shift at all.
  function frameOffset(mode) {
    const w = innerWidth, h = innerHeight;
    if (mode === 'title' && w / h > 1.15) return camera.setViewOffset(w, h, -w * 0.2, h * 0.04, w, h);
    if (mode === 'replay' && st.rr > 0) {
      const dx = w / 2 - (st.rl + st.rr) / 2, dy = h / 2 - (st.rt + st.rb) / 2;
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) return camera.setViewOffset(w, h, dx, dy, w, h);
    }
    if (camera.view?.enabled) camera.clearViewOffset();
  }
  // Where the replay can be seen (CSS px); nothing given, or nothing left, is the whole screen.
  function setRegion(l = 0, t = 0, r = innerWidth, b = innerHeight) {
    if (r - l < 40 || b - t < 40) { l = 0; t = 0; r = innerWidth; b = innerHeight; }
    st.rl = l; st.rt = t; st.rr = r; st.rb = b;
    // As wide as tall or wider: the reference framing. A portrait strip: on the car. The whole screen (no
    // results beside or under the replay) keeps the reference framing whatever its shape.
    const full = l === 0 && t === 0 && r === innerWidth && b === innerHeight;
    st.aim = full ? 0 : clamp((1 - (r - l) / (b - t)) / 0.4, 0, 1);
    if (st.mode === 'replay') frameOffset('replay');
  }

  // update(dt, time, { carPos, carVel, phase, mode: 'title' | 'live' | 'replay', course: 'show' | 'wall' | 'lineup' })
  function update(dt, time, { carPos, carVel, phase, mode, course = 'show' }) {
    if (mode !== st.mode || course !== st.course) {
      st.mode = mode; st.course = course; st.t = 0; st.shot = -1; st.peak = 0; st.launched = false; st.dip = 0; st.punch = 0;
      st.hx = 0; st.hz = 1; st.cutT = 0;
      snap(); frameOffset(mode);
    }
    st.t += dt;
    if (st.cutT > 0) {
      // A crash cut: a locked-off camera near the impact, watching the car, then a hard cut back.
      st.cutT -= dt;
      camera.position.copy(st.cutPos);
      camera.lookAt(carPos.x, carPos.y + 0.15, carPos.z);
      st.fov = st.cutFov;
      if (st.cutT <= 0) { st.shot = -1; snap(); }
    } else if (course === 'wall' || course === 'show') {
      if (mode === 'title') (course === 'show' ? titleShow : titleWall)(time);
      else if (mode === 'replay') wallReplay(carPos, carVel, phase);
      else { wallLive(carPos, carVel, phase, dt); keepClear(carPos, st.view !== 'pilot', dt); }
    } else if (mode === 'title') titleLineup(time);
    else if (mode === 'replay') replay(carPos);
    else chase(carPos, carVel, phase, dt);
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt * 3);
      tmp.set(Math.sin(time * 91), Math.sin(time * 77 + 1), 0).multiplyScalar(st.shake * 0.08);
      camera.position.add(tmp);
      if (st.shake > 0.5) camera.rotateZ(Math.sin(time * 53) * (st.shake - 0.5) * 0.02);   // a crash rattles the frame too
    }
    // Touchdown: the camera rides the car's suspension down and back, and punches in, over ≈0.4 s.
    const k = Math.exp(-dt * 7);
    if (st.dip > 0.001) { camera.position.y -= st.dip; st.dip *= k; } else st.dip = 0;
    if (st.punch > 0.01) st.punch *= k; else st.punch = 0;
    const fov = st.fov - st.punch;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // Hold a locked-off camera at `pos` for `seconds` (crash cuts); a mode change cancels it.
  function cut(pos, seconds, fov = 40) { st.cutPos.copy(pos); st.cutT = seconds; st.cutFov = fov; }

  return { update, snap, restart, cut, setView: (v) => { st.view = v; }, view: () => st.view, reframe: () => frameOffset(st.mode), setRegion, shake: (s) => { st.shake = Math.max(st.shake, s); },
    impact: (dip, punch) => { st.dip = Math.max(st.dip, dip); st.punch = Math.max(st.punch, punch); }, state: st };
}
