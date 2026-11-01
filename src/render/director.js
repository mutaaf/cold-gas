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
import { hudMode, onHudMode } from '../hud-mode.js';

const PAD = LINEUP.pad, LINEUP_Z0 = LINEUP.lineupZ0, LINEUP_END = LINEUP.lineupEnd;
const tmp = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3(), qInv = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// The Wall's rigs were framed on a 19.8 m lip; they scale with the wall's real height.
const K = WALL.lip.y / 19.8;
// The live Show after the release (0063), as st.shot: a locked-off hold on the drop off the lip, then
// the tracking carry over the row, each entered by a hard cut.
const HOLD = 'hold', CARRY = 'carry', FOLLOW = 'follow';
const HOLD_POS = [30, 12, -6];      // from the car at the release: out to the side, level with the curl's middle, ahead (m)
const HOLD_LOOK = [21, -4];         // aim: this height, this far ahead of the release point (m)
const HOLD_MAX = 1.6;               // s: the latest the hold lasts
// The hold cuts to the carry a metre before the car reaches the row, so the roofs are in shot over it.
const ROW_FRONT = Math.max(...SHOW.boxes.map((b) => b.maxZ)) + 1;
// The row's near side (the camera stands out at +x) and its length, for the carry's fit (0113).
const ROW_X = Math.max(...SHOW.boxes.map((b) => b.maxX)), ROW_Z0 = Math.min(...SHOW.boxes.map((b) => b.minZ)), ROW_Z1 = ROW_FRONT - 1;
// The HUD boxes the carry frames the row above (tests/e2e/frame-probe.js measures against the same).
const HUD_SEL = '[data-hud-box], [data-hud-toggle], .top-actions';
// The ground shots (the landed rig, a crash cut) are framed side-on to a 4.65 m car with a vertical lens, so on a
// screen narrower than it is tall the car came out wider than the screen (0108: 1.2–1.45 screens upright on a
// phone). Under this aspect they hold the horizontal lens they have at it, so the car keeps its share of the
// width (at most ≈ 0.75 of it); at this aspect and wider the lens is unchanged.
const LENS_ASPECT = 0.9;
// The landed rig's stand from the car (x, z m): ahead of it on a wide screen; on an upright one (0119) beside it on
// the open side, broadside, so its view runs across the lit floor to the launch complex (src/sim/complex.js, far −x).
// 12 m keeps the 4.65 m car under 0.75 of an upright phone's width (0108).
const LAND_AHEAD = [6.5, -9], LAND_SIDE = [12, 0];
const LAND_LIFT = 0.2;   // NDC: an upright landed car sits this far under the middle (≈ 60 % down)

export function createDirector(camera) {
  const st = {
    mode: '', course: '', t: 0, shot: -1, smooth: new THREE.Vector3(), lookS: new THREE.Vector3(), fov: 52, shake: 0, init: false,
    dip: 0, punch: 0,           // touchdown: camera drop (m) and FOV punch-in (deg), both decay
    peak: 0, launched: false, launchT: 0,
    hx: 0, hz: 1,                 // chase heading (unit, xz), follows the car's travel
    cutT: 0, cutPos: new THREE.Vector3(), cutFov: 40,   // a crash cut (src/render/crash.js)
    holdPos: new THREE.Vector3(), holdLook: new THREE.Vector3(),   // the Show's locked-off release shot (0063)
    view: 'broadcast', px: 0, pz: -1,                    // pilot view: on/off, its heading
    clear: 1,                                            // keepClear's strength (0 in the pilot view)
    // The replay's own region of the screen (0068): what the results leave uncovered, in CSS px. The
    // replay's lens is shifted to its centre, and the wide locked-off rig aims toward the car's path by
    // `aim` (0 = the reference framing, 1 = on the path) as the region narrows.
    rl: 0, rt: 0, rr: 0, rb: 0, aim: 0,
    bandT: 1, bandB: -1,                                 // the carry's band (0113, NDC): under the top HUD, over the bottom one
    bandL: 1,                                            // under the HUD standing at the top of the left edge (0116, NDC)
    placed: false, carryPos: new THREE.Vector3(), carryLook: new THREE.Vector3(),   // the carry's locked-off placement (0113)
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
  function restart() { st.peak = 0; st.launched = false; st.shot = -1; snap(); }

  // Smoothly fly the camera toward want/lookWant (rate per second).
  function ease(dt, rate, lookRate = 8) {
    if (!st.init) { st.smooth.copy(want); st.lookS.copy(lookWant); st.init = true; }
    st.smooth.lerp(want, 1 - Math.exp(-dt * rate));
    st.lookS.lerp(lookWant, 1 - Math.exp(-dt * lookRate));
    camera.position.copy(st.smooth);
    camera.lookAt(st.lookS);
  }
  const fovTo = (f, dt, rate = 2) => { st.fov += (f - st.fov) * (1 - Math.exp(-dt * rate)); };
  // How far under LENS_ASPECT the screen is: 0 at it and wider, 1 from an upright phone's 0.5 down (0119).
  const upright = () => clamp((LENS_ASPECT - camera.aspect) / 0.4, 0, 1);
  // The height to add to a ground shot's aim, `d` m from it under lens(fov), so the car sits about LAND_LIFT × u of
  // the half-frame below the middle (0119).
  const liftFor = (u, d, fov) => d * LAND_LIFT * u * Math.tan(lens(fov) * Math.PI / 360);
  // Whether a parked body stands across the level line from the car to `dx` m out at +x, the side stand's sight (0119).
  const rowBlocks = (c, dx) => {
    for (const b of SHOW.boxes) if (c.z >= b.minZ - 0.5 && c.z <= b.maxZ + 0.5 && b.maxX >= c.x - 0.5 && b.minX <= c.x + dx) return true;
    return false;
  };
  const lens = (f) => (camera.aspect >= LENS_ASPECT ? f : (Math.atan(Math.tan(f * Math.PI / 360) * LENS_ASPECT / camera.aspect) * 360) / Math.PI);

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
  // On a very short touch screen a quarter of the way down is still under the top HUD (0107: a flip phone's
  // cover screen upright, 380 px, under the compact rail's head; its tall screen sideways with the bars,
  // 300 px, under the top bar). So the line is also held this many CSS px down: the HUD's foot (the rail's
  // head ≈ 105 px upright, the top bar ≈ 56 px sideways) plus 0063's 24 px and a little. It binds only under
  // 524 px upright and 336 px sideways (no phone, tablet or desktop we fly the flicker probe at).
  const CLEAR_TALL = 131, CLEAR_WIDE = 84;
  let viewH = typeof innerHeight === 'number' ? innerHeight : 0;   // the canvas's height (reframe: every resize)
  const knee = (e) => (e <= 0 ? 0 : e < KNEE ? (e * e) / (2 * KNEE) : e - KNEE / 2);   // 0 → e − k/2, C¹
  function keepClear(carPos, on, dt) {
    st.clear += ((on ? 1 : 0) - st.clear) * (1 - Math.exp(-dt * 5));
    if (st.clear < 0.002) return;
    const tv = Math.tan(st.fov * Math.PI / 360);
    if (st.launched && camera.aspect < 1 && coarse?.matches && hudMode() === 'compact' && st.shot !== CARRY) {
      tmp.copy(carPos).sub(camera.position).applyQuaternion(qInv.copy(camera.quaternion).invert());
      if (tmp.z > -0.5) return;
      const ny = tmp.y / -tmp.z / tv, w = clamp((ny - 0.1) / 0.25, 0, 1);
      const min = Math.atan(RAIL * w * tv * camera.aspect) + KNEE / 2;
      // About the world's up, so the horizon stays level.
      camera.rotateOnWorldAxis(UP, st.clear * knee(min - Math.atan2(tmp.x, -tmp.z)));
    }
    tmp.copy(carPos).sub(camera.position).applyQuaternion(qInv.copy(camera.quaternion).invert());
    if (tmp.z > -0.5) return;
    // (Under 440 px upright the rail's head rides in the top bar, src/styles.css: the top bar's clearance.)
    camera.rotateX(st.clear * knee(Math.atan2(tmp.y, -tmp.z) - Math.atan(topLine() * tv) + KNEE / 2));
  }
  // The highest the car's centre goes, in NDC.
  function topLine() {
    const clearPx = coarse?.matches && viewH ? (camera.aspect < 1 && viewH >= 440 ? CLEAR_TALL : CLEAR_WIDE) : 0;
    return Math.min(camera.aspect < 1 && hudMode() === 'full' ? TOP_TALL : TOP, clearPx ? 1 - (2 * clearPx) / viewH : 1);
  }

  // The carry over the row (0113): the band the HUD leaves, read from the DOM once per run and after a resize (NDC:
  // `bandT` under the top HUD's foot + 24 px, `bandB` over the top of the HUD docked at the bottom across the middle
  // of the screen, −1 when nothing is). On a landscape phone and the desktop that bottom band is where the row is.
  // `bandL` under the foot of whatever stands up top at the left edge + 24 px (an upright touch screen's compact rail,
  // 0116), where the upright carry brings the car in.
  let bandDirty = true;
  function measureBand() {
    bandDirty = false; st.bandT = 1; st.bandB = -1; st.bandL = 1;
    const cv = typeof document !== 'undefined' && document.getElementById('stage');
    if (!cv) return;
    const c = cv.getBoundingClientRect();
    if (c.height < 40) return;
    const ndc = (y) => 1 - (2 * (y - c.top)) / c.height;
    for (const el of document.querySelectorAll(HUD_SEL)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || !shown(el)) continue;
      // Up top only the mission block and the top bar count (the side instruments stand beside the car, not over it);
      // at the bottom whatever stands across the middle of the screen, where the row is.
      const top = r.top + r.bottom < 2 * c.top + c.height;
      if (top && r.left < c.left + c.width * 0.15) st.bandL = Math.min(st.bandL, ndc(r.bottom + 24));
      if (top && (el.dataset.hudBox === 'mission' || el.classList.contains('top-actions'))) st.bandT = Math.min(st.bandT, ndc(r.bottom + 24));
      else if (!top && r.right > c.left + c.width * 0.15 && r.left < c.left + c.width * 0.85) st.bandB = Math.max(st.bandB, ndc(r.top));
    }
  }
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  onHudMode(() => { bandDirty = true; });   // compact ⇄ full reflows the boxes without a resize
  // The carry's placement: the tracking framing for the car where it is, trucked along the flight so the car stands
  // left of centre with the way it's going in frame (no further than halfway to the pad), then fitted to the band.
  const CARRY_AHEAD = 0.5, CARRY_EDGE = 0.9, CAR_HALF = 2.6;   // NDC: where the car starts across the frame, where its nose cuts again; m
  function placeCarry(carPos) {
    want.set(carPos.x + 21 + 0.5 * Math.max(0, carPos.y - 10), clamp(carPos.y * 0.5 + 1.5, 2.2, 14), carPos.z + 2);
    lookWant.set(carPos.x * 0.5, carPos.y * 0.55 + 0.8, carPos.z - 2);
    const d = Math.hypot(want.x - carPos.x, want.z - carPos.z), tanH = Math.tan(st.fov * Math.PI / 360) * camera.aspect;
    const ahead = Math.min(CARRY_AHEAD * d * tanH, Math.max(0, (carPos.z - SHOW.pad.z) / 2));
    want.z -= ahead; lookWant.z -= ahead;
    if (camera.aspect < 1) fitRowAcross(carPos, tanH);
    fitCarry(carPos);
    st.carryPos.copy(want); st.carryLook.copy(lookWant); st.placed = true;
  }
  // On a screen taller than it is wide the vertical lens leaves a narrow one across (≈ 26° at 390×844), and the carry
  // framed for the car showed three of the row's five bodies (0116). There the camera stands abeam of the row's middle,
  // back far enough that the stretch from the car's tail at the cut to its nose at the row's back fits across the frame
  // inside the edge carryOut cuts at, so the whole row is in shot and the car crosses it without a re-placement. A cut
  // on the hold's timeout can come with the car still short of the row: the stretch then starts where the car is.
  function fitRowAcross(carPos, tanH) {
    const z1 = Math.max(carPos.z, ROW_FRONT) + CAR_HALF, z0 = ROW_Z0 - CAR_HALF;
    const back = ROW_X + (z1 - z0) / 2 / (CARRY_EDGE * tanH);
    if (want.x < back) want.x = back;
    want.z = lookWant.z = (z1 + z0) / 2;
  }
  // The car's nose near the far edge of the locked-off frame (or the car behind it).
  function carryOut(carPos) {
    tmp.copy(carPos).sub(st.carryPos).applyQuaternion(qInv.copy(camera.quaternion).invert());
    return tmp.z > -0.5 || (tmp.x + CAR_HALF) / -tmp.z > CARRY_EDGE * Math.tan(st.fov * Math.PI / 360) * camera.aspect;
  }

  // After the carry has looked where it wants (want, lookWant), fit the car and the row between those lines: the car's
  // centre under the top line, the row's near foot over the bottom band. A framing that already fits is left as it is
  // (the upright phone, whose HUD is at the top); one that needs it is pitched within the band, and where the span
  // from the car to the row's foot is taller than the band at this lens the camera stands back, about the middle of
  // the two, just as far as it needs. All from the car's state alone, so the move is as smooth as the car.
  // A point's angle above the camera's level line, from `want`, with its depth along the shot's bearing (ux, uz), so a
  // point off to the side comes out lower as it does on the screen (rad).
  let ux = 0, uz = -1;
  const elev = (x, y, z) => Math.atan2(y - want.y, Math.max(0.5, (x - want.x) * ux + (z - want.z) * uz));
  const bearing = () => {   // sets (ux, uz) from want toward lookWant; returns that horizontal distance
    const d = Math.hypot(lookWant.x - want.x, lookWant.z - want.z);
    if (d >= 0.5) { ux = (lookWant.x - want.x) / d; uz = (lookWant.z - want.z) / d; }
    return d;
  };
  const footElev = (z) => Math.min(elev(ROW_X, 0, z), elev(ROW_X, 0, ROW_Z0), elev(ROW_X, 0, ROW_Z1));
  const FIT_CAR = 0.06, FIT_ROW = 0.04;   // NDC margins: the car under the top line, the row's foot over the band
  // The farthest it stands back, × the shot's distance (the 300 px-tall flip screen sideways needs ≈ 1.9×, a desktop ≈ 1.35×).
  const FIT_BACK = 2.5;
  function fitCarry(carPos) {
    if (bandDirty) measureBand();
    const T = Math.tan(st.fov * Math.PI / 360);
    const tN = Math.min(topLine(), st.bandT, camera.aspect < 1 ? st.bandL : 1) - FIT_CAR, bN = st.bandB + FIT_ROW;
    if (tN - bN < 0.2) return;
    const aC = Math.atan(tN * T), aB = Math.atan(bN * T), span = aC - aB;   // the angles the band allows
    // The row's foot: the bottom of its near side, at the camera's own place along the row or at whichever end sits lower.
    const bz = clamp(want.z, ROW_Z0, ROW_Z1);
    let dh = bearing();
    if (dh < 0.5) return;
    const phi0 = Math.atan2(lookWant.y - want.y, dh);   // the shot's own pitch
    let eC = elev(carPos.x, carPos.y, carPos.z), eB = footElev(bz);
    if (eC - eB > span) {
      const s = Math.min(FIT_BACK, Math.tan((eC - eB) / 2) / Math.tan(span / 2));
      const mx = (carPos.x + ROW_X) / 2, my = carPos.y / 2, mz = (carPos.z + bz) / 2;
      want.set(mx + (want.x - mx) * s, my + (want.y - my) * s, mz + (want.z - mz) * s);
      dh = bearing();
      eC = elev(carPos.x, carPos.y, carPos.z); eB = footElev(clamp(want.z, ROW_Z0, ROW_Z1));
    }
    // The pitch: the shot's, within [car on the top line, foot on the bottom line] (their middle if they cross).
    const lo = eC - aC, hi = eB - aB;
    const phi = lo > hi ? (lo + hi) / 2 : clamp(phi0, lo, hi);
    lookWant.y = want.y + dh * Math.tan(phi);
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
      // The release is a hard cut, broadcast-style (0063), to a locked-off camera standing out to the side
      // and ahead of the ledge: it holds still while the car drops off the lip toward the row (keepClear
      // turns it only if the car would rise under the top HUD), then cuts to the carry as the car reaches the
      // row. A tracking camera there followed the car past the lit curl and the tower close up, and every lit
      // edge of the Wall crawled 2–4 px a frame through it (show-live-jets wall 226‰ on a desktop against
      // main's 128‰).
      if (st.shot !== HOLD && st.shot !== CARRY && st.shot !== FOLLOW) {
        st.shot = HOLD; st.fov = 54; snap();
        st.holdPos.set(carPos.x + HOLD_POS[0], HOLD_POS[1], carPos.z + HOLD_POS[2]);
        st.holdLook.set(carPos.x * 0.5, HOLD_LOOK[0], carPos.z + HOLD_LOOK[1]);
      }
      if (st.shot === HOLD && (carPos.z < ROW_FRONT || st.t - st.launchT > HOLD_MAX)) { st.shot = CARRY; snap(); bandDirty = true; st.placed = false; }
      if (st.shot === HOLD) {
        camera.position.copy(st.holdPos);
        camera.lookAt(st.holdLook);
        return;
      }
      // The carry is locked off too (0113): placed at the cut so the car (at its highest) and the whole row fit the
      // band the HUD leaves, aimed ahead along the flight, then still while the car crosses it. A camera tracking the
      // car from that far out walked the lit Wall across the frame (show-live-jets wall 104 → 188‰ on a phone). If
      // the car nears the far edge (a narrow screen, a long flight) it cuts to a fresh placement from there.
      // Past the row's back it cuts to the tracking follow down to the pad, which the landing rig eases out of.
      if (st.shot === CARRY && carPos.z < ROW_Z0) { st.shot = FOLLOW; snap(); }
      if (st.shot === CARRY) {
        if (!st.placed || carryOut(carPos)) placeCarry(carPos);
        camera.position.copy(st.carryPos);
        camera.lookAt(st.carryLook);
        // A car that comes down on the row: the landing rig eases in from here.
        st.smooth.copy(st.carryPos); st.lookS.copy(st.carryLook); st.init = true;
        return;
      }
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
      // Landed: low, ahead of the car as it rolls back down the approach. On the Show, on a screen narrower than it
      // is tall (0119), the rig swings round to the car's open side, broadside on, looking across it at the lit launch
      // complex, and lifts its aim so the car sits under the middle: from ahead, 0108's wider lens spent the
      // lower 40 % of an upright phone on unlit floor at the camera's feet (78–98 % black).
      // The Wall's landed shot is unchanged; so is a car that comes to rest with a parked body between it and the side stand.
      const u = st.course === 'show' && !rowBlocks(carPos, LAND_SIDE[0]) ? upright() : 0;
      const ox = LAND_AHEAD[0] + u * (LAND_SIDE[0] - LAND_AHEAD[0]), oz = LAND_AHEAD[1] + u * (LAND_SIDE[1] - LAND_AHEAD[1]);
      want.set(carPos.x + ox, 1.25, carPos.z + oz);
      lookWant.set(carPos.x, carPos.y + 0.2 + liftFor(u, Math.hypot(ox, oz), 40), carPos.z);
      ease(dt, 3, 8);
      fovTo(lens(40), dt);
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
      st.fov = lens(st.cutFov);
      // The Lineup's chase eases its lens back from the cut's, as it did before 0108 (not from the wider one).
      if (st.cutT <= 0) { st.shot = -1; snap(); if (course === 'lineup') st.fov = st.cutFov; }
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

  return { update, snap, restart, cut, setView: (v) => { st.view = v; }, view: () => st.view, reframe: () => { viewH = (typeof document !== 'undefined' && document.getElementById('stage')?.clientHeight) || innerHeight; bandDirty = true; frameOffset(st.mode); }, setRegion, shake: (s) => { st.shake = Math.max(st.shake, s); },
    impact: (dip, punch) => { st.dip = Math.max(st.dip, dip); st.punch = Math.max(st.punch, punch); }, state: st };
}
