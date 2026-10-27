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
const tmp = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// The Wall's rigs were framed on a 19.8 m lip; they scale with the wall's real height.
const K = WALL.lip.y / 19.8;
// The Show's carry (0063): its FOV, the lowest roof in the row, and how far down the frame (NDC) a roof may sit.
const CARRY_FOV = 54, ROOF_Y = Math.min(...SHOW.boxes.map((b) => b.h)), ROOF_NDC = 0.88;

export function createDirector(camera) {
  const st = {
    mode: '', course: '', t: 0, shot: -1, smooth: new THREE.Vector3(), lookS: new THREE.Vector3(), fov: 52, shake: 0, init: false,
    dip: 0, punch: 0,           // touchdown: camera drop (m) and FOV punch-in (deg), both decay
    peak: 0, launched: false, launchT: 0,
    hx: 0, hz: 1,                 // chase heading (unit, xz), follows the car's travel
    cutT: 0, cutPos: new THREE.Vector3(), cutFov: 40,   // a crash cut (src/render/crash.js)
    view: 'broadcast', px: 0, pz: -1,                    // pilot view: on/off, its heading
    carryD: 0,                                           // the Show's carry: its camera's distance (0063)
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
      st.carryD = 0;
      want.set(27 * K, 13.5 * K, -13 * K);
      lookWant.set(carPos.x * 0.3, carPos.y * 0.6 + 6, carPos.z * 0.5 + 2.5);
      ease(dt, 1.8, 4);
      fovTo(46, dt, 1.5);
    } else if (!landed && st.view === 'pilot') {
      pilot(carPos, carVel, dt);
    } else if (!landed && st.course === 'show') {
      carry(carPos, dt);
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

  // The Show's carry, from the release over the row (0063): low and wide from the side, framed on two
  // points, the car and the roofs under it. The car's centre stays below the top HUD (the mission
  // block, or the compact rail on a portrait phone) and the roofs above the bottom of the frame: the
  // camera backs off as far as that takes (the drop starts 22 m above the roofs) and closes back in
  // as the car comes down, and its tilt is solved from where the camera actually is, so the ease
  // can't carry the car up behind the HUD.
  function carry(carPos, dt) {
    const H = innerHeight || 1, portrait = camera.aspect < 0.8, compact = hudMode() === 'compact';
    // Highest the car's centre may sit, px from the top: under the rail (portrait, compact: the rail
    // reaches ≈ 260 px, plus half the car), under the mission block + 24 px (full: its bottom ≈ 130 px),
    // or clear of the top bar (a compact landscape phone keeps its block at the bottom).
    const topPx = compact ? (portrait ? 300 : Math.max(80, H * 0.22)) : 175;
    const t = Math.tan(CARRY_FOV * Math.PI / 360);
    const aTop = Math.max(0.05, 1 - 2 * topPx / H);
    const upMax = Math.atan(aTop * t), downMax = Math.atan(ROOF_NDC * t);
    const yc = carPos.y, yr = Math.min(ROOF_Y, yc - 1);
    const h = clamp(yc * 0.4 + 2.2, 2.2, 12);
    // The nearest distance at which both fit (bisection: the angle between them falls with distance).
    let lo = 21, hi = 90;
    if (Math.atan2(yc - h, lo) + Math.atan2(h - yr, lo) > upMax + downMax) {
      for (let i = 0; i < 18; i++) {
        const d = (lo + hi) / 2;
        if (Math.atan2(yc - h, d) + Math.atan2(h - yr, d) > upMax + downMax) lo = d; else hi = d;
      }
      lo = hi;
    }
    // Backed off, it closes in no faster than 3 m/s: dollying in at the fall's pace made the curl's deck
    // crawl (scripts/flicker.mjs show-live-jets, wall region).
    st.carryD = Math.max(lo, st.carryD - dt * 3);
    want.set(carPos.x + st.carryD, h, carPos.z + 2);
    // Tilt from the camera as it stands: the car no higher than the band, the roofs no lower than
    // the frame's foot; with room to spare, the car mid-frame.
    const c = st.init ? st.smooth : want;
    const ax = carPos.x * 0.5 - c.x, az = carPos.z - 2 - c.z, al = Math.hypot(ax, az) || 1;
    const dc = Math.hypot(carPos.x - c.x, carPos.z - c.z) || 1, dr = Math.hypot(c.x, carPos.z - c.z) || 1;
    // (At the FOV the camera has now: it is still easing in from the hang's.)
    const tNow = Math.tan(st.fov * Math.PI / 360);
    const pc = Math.atan2(yc - c.y, dc), pLo = pc - Math.atan(aTop * tNow), pHi = Math.atan2(yr - c.y, dr) + Math.atan(ROOF_NDC * tNow);
    const p = Math.max(pLo, Math.min(pc, pHi)), cp = Math.cos(p);
    lookWant.set(c.x + ax * cp, c.y + Math.sin(p) * al, c.z + az * cp);
    ease(dt, 3.2, 9);
    fovTo(CARRY_FOV, dt);
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
      case 1: // the reference image: wide from the side, the whole curl, truss and beams
        camera.position.set(31 * K, 8.5 * K, -9 * K); camera.lookAt(0.5, 11.5 * K, 5.5 * K); st.fov = 47; break;
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

  function frameOffset(on) {
    const w = innerWidth, h = innerHeight;
    if (on && w / h > 1.15) camera.setViewOffset(w, h, -w * 0.2, h * 0.04, w, h);
    else if (camera.view?.enabled) camera.clearViewOffset();
  }

  // update(dt, time, { carPos, carVel, phase, mode: 'title' | 'live' | 'replay', course: 'show' | 'wall' | 'lineup' })
  function update(dt, time, { carPos, carVel, phase, mode, course = 'show' }) {
    if (mode !== st.mode || course !== st.course) {
      st.mode = mode; st.course = course; st.t = 0; st.shot = -1; st.peak = 0; st.launched = false; st.dip = 0; st.punch = 0;
      st.hx = 0; st.hz = 1; st.cutT = 0;
      snap(); frameOffset(mode === 'title');
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
      else wallLive(carPos, carVel, phase, dt);
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

  return { update, snap, restart, cut, setView: (v) => { st.view = v; }, view: () => st.view, reframe: () => frameOffset(st.mode === 'title'), shake: (s) => { st.shake = Math.max(st.shake, s); },
    impact: (dip, punch) => { st.dip = Math.max(st.dip, dip); st.punch = Math.max(st.punch, punch); }, state: st };
}
