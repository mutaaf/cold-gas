// One input surface for keyboard, gamepad and touch, sampled once per frame into the sim's
// input shape. Context matters: on the ground the stick drives; in the air it flies.
//
// Keyboard   ground: ↑/W throttle · ↓/S brake · ←/→ A/D steer · Shift boost · Space LIFT
//            air:    ←/→ A/D roll · ↑/W nose down · ↓/S nose up · Q/E yaw · Space LIFT · Shift LAND
//                    · F BOOST (the rear jets: carry off the Wall's ledge, over the row)
//            Advanced (air): the ten valves by hand, keys laid out like the car (src/valves.js)
// Gamepad    left stick steer/roll+pitch · RT throttle/LIFT · LT brake/LAND · A LIFT · B LAND
//            Advanced (air): shoulders = the four down-jets, A BOOST, Y LIFT, X/B fender jets
// Touch      ground: steer stick · GO and BRAKE pedals · LIFT (RELEASE on the wall)
//            air:    stick rolls and pitches (up = nose up) · LIFT · LAND
//            Advanced (air): the nozzle pad, a car with a pad on every nozzle
//            The stick has a 15 % dead zone: a thumb resting on it in the air used to command a
//            roll (any |roll| > 0.05 is a rate demand, and it switches off LAND's hold-the-line).
// One-thumb  Assist on the Show and the Wall: one control (src/onethumb.js), hold / tap / hold.
// Tilt       optional steering by tilting the phone (src/touch-settings.js), on the ground only.
import { newInput, VALVE_KEYS } from './sim/vehicle.js';
import { createKeyRamp, padValves, bindNozzlePad, VALVES } from './valves.js';
import { createOneThumb } from './onethumb.js';
import { tiltSteer, buzz } from './touch-settings.js';

const keys = new Set();
const touch = { active: false, x: 0, y: 0, lift: false, land: false, go: false, brk: false };

let nozzlePad = { valves: new Float64Array(VALVES), active: () => false, show: () => {}, sync: () => {} };
export const getNozzlePad = () => nozzlePad;
export const thumb = createOneThumb();
const STICK_DEAD = 0.15;
const deadzone = (v) => (Math.abs(v) < STICK_DEAD ? 0 : (Math.sign(v) * (Math.abs(v) - STICK_DEAD)) / (1 - STICK_DEAD));

export function bindInput(root, { onPause } = {}) {
  nozzlePad = bindNozzlePad(root);
  addEventListener('keydown', (e) => {
    if (e.target?.tagName === 'INPUT') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !e.target?.closest?.('button, a, [role="radio"]')) e.preventDefault();
    if (e.code === 'Escape' || e.code === 'KeyP') onPause?.();
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // Touch: stick on the left, buttons on the right (markup in index.html).
  const stick = root.querySelector('[data-stick]');
  const knob = root.querySelector('[data-knob]');
  let id = null, cx = 0, cy = 0;
  const R = 56;
  stick?.addEventListener('pointerdown', (e) => {
    id = e.pointerId; stick.setPointerCapture(id);
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    touch.active = true; move(e);
  });
  const move = (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    touch.x = dx / R; touch.y = dy / R;
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  stick?.addEventListener('pointermove', move);
  const up = (e) => { if (e.pointerId !== id) return; id = null; touch.x = 0; touch.y = 0; if (knob) knob.style.transform = ''; };
  stick?.addEventListener('pointerup', up);
  stick?.addEventListener('pointercancel', up);
  for (const [sel, k] of [['[data-btn-lift]', 'lift'], ['[data-btn-land]', 'land'], ['[data-btn-go]', 'go'], ['[data-btn-brake]', 'brk']]) {
    const b = root.querySelector(sel);
    if (!b) continue;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[k] = true; touch.active = true; b.classList.add('on'); b.setPointerCapture(e.pointerId); buzz('tap'); });
    const off = () => { touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
  }
  // One-thumb: the whole pad is the control; a press anywhere on it counts.
  const pad = root.querySelector('[data-onethumb]');
  if (pad) {
    let pid = null;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId; pad.setPointerCapture?.(pid);
      touch.active = true; thumb.down(); pad.classList.add('on'); buzz('tap');
    });
    const off = (e) => { if (e.pointerId !== pid) return; pid = null; thumb.up(); pad.classList.remove('on'); };
    pad.addEventListener('pointerup', off); pad.addEventListener('pointercancel', off);
  }
  // A long press must never open a callout or a context menu over the controls.
  for (const el of root.querySelectorAll('[data-touch], [data-nozzle-pad]')) el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// One-thumb: the run's input for this tick from the one control (and tilt, on the ground).
export function sampleThumb(run, released, out = newInput()) {
  Object.assign(out, newInput());
  return thumb.sample(run, released, out, tiltSteer());
}

const k = (...codes) => codes.some((c) => keys.has(c));

// Keys are on/off; a driver's hands aren't. Keyboard steer and roll ramp in over ≈0.25 s and
// centre twice as fast, so a tap is a correction and a hold is full lock. sample() runs once per
// 240 Hz sim tick.
const KEY_IN = 4 / 240, KEY_OUT = 8 / 240;
let keyAx = 0;
function rampKey(target) {
  const rate = Math.abs(target) > Math.abs(keyAx) && Math.sign(target) !== -Math.sign(keyAx) ? KEY_IN : KEY_OUT;
  keyAx += Math.max(-rate, Math.min(rate, target - keyAx));
  return keyAx;
}
const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);

export const usingTouch = () => touch.active;

// Sample into a sim input. `phase` is the run phase; `tier` the flight tier ('assist' | 'pro' |
// 'advanced'; a boolean means assist on/off); `released` whether the car has let go of the Wall.
// Everything is driver-relative: + steer, roll and yaw are to the right (src/sim/vehicle.js).
const vScratch = new Float64Array(VALVES);
const keyRamp = createKeyRamp(), isDown = (c) => keys.has(c);
export function sample(phase, tier, out = newInput(), released = false) {
  Object.assign(out, newInput());
  if (typeof tier === 'boolean') tier = tier ? 'assist' : 'pro';
  out.assist = tier === 'assist' ? 1 : 0;
  out.manual = tier === 'advanced' ? 1 : 0;
  // Let go of the Wall, you're flying (the sim calls it airborne 0.1 s later).
  const air = phase === 'air' || (phase === 'ramp' && released);
  let ax = 0, ay = 0, lift = 0, land = 0, thr = 0, brk = 0, yaw = 0;
  ax = rampKey((k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0));
  if (k('ArrowUp', 'KeyW')) ay -= 1;
  if (k('ArrowDown', 'KeyS')) ay += 1;
  if (k('KeyQ')) yaw -= 1;
  if (k('KeyE')) yaw += 1;
  if (k('Space')) lift = 1;
  if (k('ShiftLeft', 'ShiftRight')) land = 1;
  let boost = k('KeyF') ? 1 : 0;
  if (ay < 0) thr = 1;
  if (ay > 0) brk = 1;

  const pads = navigator.getGamepads?.() || [];
  for (const p of pads) {
    if (!p || out.manual) continue;
    ax += dz(p.axes[0] || 0); ay += dz(p.axes[1] || 0);
    yaw += dz(p.axes[2] || 0) * 0.8;
    const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
    if (air) { lift = Math.max(lift, rt, p.buttons[0]?.pressed ? 1 : 0); land = Math.max(land, lt > 0.3 || p.buttons[1]?.pressed ? 1 : 0); if (p.buttons[5]?.pressed) boost = 1; }
    else { thr = Math.max(thr, rt); brk = Math.max(brk, lt); if (p.buttons[0]?.pressed) lift = 1; }
  }

  if (touch.active) {
    // Touch: on the ground (and up the wall) the stick only steers and the pedals drive. In the
    // air it flies, and pushing up raises the nose: what people expect on a phone.
    ax += deadzone(touch.x);
    if (air) ay -= deadzone(touch.y);
    if (touch.lift) lift = 1;
    if (touch.land) land = 1;
    if (touch.go) { thr = 1; boost = 1; }
    if (touch.brk) brk = 1;
  }
  if (!air) ax += tiltSteer();
  ax = Math.max(-1, Math.min(1, ax)); ay = Math.max(-1, Math.min(1, ay));

  if (out.manual) return advanced(out, air, lift, ax, thr, brk, pads);
  if (air) {
    out.roll = ax; out.pitch = -ay; out.yaw = yaw; out.lift = lift; out.level = land; out.thrust = boost;
  } else {
    out.steer = ax; out.throttle = thr; out.brake = brk; out.lift = lift;
    // Shift on the run-up = rear boost. Not after a landing: it's LAND in the air, and holding it
    // through the touchdown used to fire the rear jets and launch the car off the pad.
    out.thrust = phase === 'drive' && land && !brk ? 1 : 0;
  }
  return out;
}

// Advanced: off the Wall the valves are yours; on the ground (and up the curl) you drive.
// Space on the ledge is still RELEASE (and opens the four down-jets, like the real push-off).
function advanced(out, flying, liftKey, ax, thr, brk, pads) {
  if (!flying) {
    for (const p of pads) {
      if (!p) continue;
      ax += dz(p.axes[0] || 0);
      thr = Math.max(thr, p.buttons[7]?.value || 0); brk = Math.max(brk, p.buttons[6]?.value || 0);
      if (p.buttons[0]?.pressed) liftKey = 1;
    }
    out.steer = Math.max(-1, Math.min(1, ax)); out.throttle = thr; out.brake = brk; out.lift = liftKey;
    return out;
  }
  vScratch.fill(0);
  keyRamp(isDown, vScratch);
  for (const p of pads) if (p) padValves(p, vScratch);
  const pad = nozzlePad.valves;
  for (let i = 0; i < VALVES; i++) out[VALVE_KEYS[i]] = Math.max(vScratch[i], pad[i]);
  out.lift = liftKey;   // the sim ignores it in Advanced; the ledge reads it as RELEASE
  return out;
}

// Any of these keys pressed this frame (the practice keys: R retry, T slow motion, L view).
export const held = (code) => keys.has(code);
