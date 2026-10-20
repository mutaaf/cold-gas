// The camera director. Live: a low chase cam that swings out to a broadcast three-quarter when
// the car leaves the lip, so the roll reads in profile. Replay: hard cuts between fixed rigs,
// like the reveal film. Title: a slow turntable on the pad.
import * as THREE from 'three';
import { RAMP, LINEUP_Z0, LINEUP_END, PAD } from '../sim/course.js';

const tmp = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3();

export function createDirector(camera) {
  const st = { mode: '', t: 0, shot: 0, shotT: 0, smooth: new THREE.Vector3(), lookS: new THREE.Vector3(), fov: 52, shake: 0, init: false };

  function snap() { st.init = false; }

  function chase(carPos, carVel, phase, dt) {
    const speed = Math.hypot(carVel.x, carVel.z);
    if (phase === 'air' || (phase === 'landed' && st.t < 1.2)) {
      // Broadcast three-quarter: off to the right, a little ahead, low.
      want.set(carPos.x + 13, Math.max(2.2, carPos.y * 0.55 + 1.6), carPos.z + 2 - Math.min(6, speed * 0.15));
      lookWant.set(carPos.x, carPos.y + 0.2, carPos.z + 3);
    } else if (phase === 'landed' || phase === 'done') {
      want.set(carPos.x + 7, 2.4, carPos.z - 6);
      lookWant.copy(carPos);
    } else {
      // Car sits just below centre, clear of the HUD.
      want.set(carPos.x * 0.6, carPos.y + 2.0 + speed * 0.012, carPos.z - 7.4 - speed * 0.06);
      lookWant.set(carPos.x, carPos.y + 0.35, carPos.z + 4.5);
    }
    const k = 1 - Math.exp(-dt * (phase === 'air' ? 3.2 : 5));
    if (!st.init) { st.smooth.copy(want); st.lookS.copy(lookWant); st.init = true; }
    st.smooth.lerp(want, k);
    st.lookS.lerp(lookWant, 1 - Math.exp(-dt * 8));
    camera.position.copy(st.smooth);
    camera.lookAt(st.lookS);
    const fovWant = 48 + Math.min(16, speed * 0.42) + (phase === 'air' ? 4 : 0);
    st.fov += (fovWant - st.fov) * (1 - Math.exp(-dt * 2));
  }

  // Replay rigs, cut by where the car is.
  function replay(carPos) {
    let shot;
    if (carPos.z < RAMP.z0 - 25) shot = 0;
    else if (carPos.z < LINEUP_Z0 - 4) shot = 1;
    else if (carPos.z < LINEUP_END + 6) shot = 2;
    else shot = 3;
    if (shot !== st.shot) { st.shot = shot; st.init = false; }
    switch (shot) {
      case 0: // low tracking, front quarter
        want.set(carPos.x - 3.2, 0.5, carPos.z + 7.5);
        camera.position.copy(want); camera.lookAt(carPos.x, carPos.y + 0.3, carPos.z); st.fov = 36; break;
      case 1: // locked off at the lip, very low
        camera.position.set(-5.5, 0.35, RAMP.z1 + 3); camera.lookAt(carPos.x, carPos.y + 0.4, carPos.z); st.fov = 42; break;
      case 2: // wide side-on over the lineup: the money shot
        camera.position.set(26, 3.6, (LINEUP_Z0 + LINEUP_END) / 2 + 2); camera.lookAt(carPos.x, carPos.y, carPos.z); st.fov = 34; break;
      default: // landing cam, behind the pad
        camera.position.set(6, 1.1, PAD.z + 22); camera.lookAt(carPos.x, carPos.y + 0.2, carPos.z); st.fov = 30; break;
    }
  }

  function frameOffset(on) {
    const w = innerWidth, h = innerHeight;
    if (on && w / h > 1.15) camera.setViewOffset(w, h, -w * 0.2, h * 0.04, w, h);
    else if (camera.view?.enabled) camera.clearViewOffset();
  }

  function title(time) {
    const a = time * 0.12;
    camera.position.set(PAD.x + Math.cos(a) * 9.6, 1.45 + Math.sin(time * 0.2) * 0.12, PAD.z + Math.sin(a) * 9.6);
    camera.lookAt(PAD.x, 0.55, PAD.z);
    st.fov = 34;
  }

  function update(dt, time, { carPos, carVel, phase, mode }) {
    if (mode !== st.mode) { st.mode = mode; st.t = 0; snap(); frameOffset(mode === 'title'); }
    st.t += dt;
    if (mode === 'title') title(time);
    else if (mode === 'replay') replay(carPos);
    else chase(carPos, carVel, phase, dt);
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt * 3);
      tmp.set(Math.sin(time * 91), Math.sin(time * 77 + 1), 0).multiplyScalar(st.shake * 0.08);
      camera.position.add(tmp);
    }
    if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
    void look;
  }

  return { update, snap, reframe: () => frameOffset(st.mode === 'title'), shake: (s) => { st.shake = Math.max(st.shake, s); }, state: st };
}
