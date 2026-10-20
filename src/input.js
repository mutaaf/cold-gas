// One input surface for keyboard, gamepad and touch, sampled once per frame into the sim's
// input shape. Context matters: on the ground the stick drives; in the air it flies.
//
// Keyboard   ground: ↑/W throttle · ↓/S brake · ←/→ A/D steer · Shift boost · Space LIFT
//            air:    ←/→ A/D roll · ↑/W nose down · ↓/S nose up · Q/E yaw · Space LIFT · Shift LAND
//                    · F BOOST (the rear jets: carry off the Wall's ledge, over the row)
// Gamepad    left stick steer/roll+pitch · RT throttle/LIFT · LT brake/LAND · A LIFT · B LAND
// Touch      ground: steer stick · GO and BRAKE pedals · LIFT (RELEASE on the wall)
//            air:    stick rolls and pitches (up = nose up) · LIFT · LAND
import { newInput } from './sim/vehicle.js';

const keys = new Set();
const touch = { active: false, x: 0, y: 0, lift: false, land: false, go: false, brk: false };

export function bindInput(root, { onPause } = {}) {
  addEventListener('keydown', (e) => {
    if (e.target?.tagName === 'INPUT') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
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
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[k] = true; touch.active = true; b.classList.add('on'); b.setPointerCapture(e.pointerId); });
    const off = () => { touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
  }
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

// Sample into a sim input. `phase` is the run phase; `assist` the flight computer setting.
// Everything is driver-relative: + steer, roll and yaw are to the right (src/sim/vehicle.js).
export function sample(phase, assist, out = newInput()) {
  Object.assign(out, newInput());
  out.assist = assist ? 1 : 0;
  const air = phase === 'air';
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
    if (!p) continue;
    ax += dz(p.axes[0] || 0); ay += dz(p.axes[1] || 0);
    yaw += dz(p.axes[2] || 0) * 0.8;
    const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
    if (air) { lift = Math.max(lift, rt, p.buttons[0]?.pressed ? 1 : 0); land = Math.max(land, lt > 0.3 || p.buttons[1]?.pressed ? 1 : 0); if (p.buttons[5]?.pressed) boost = 1; }
    else { thr = Math.max(thr, rt); brk = Math.max(brk, lt); if (p.buttons[0]?.pressed) lift = 1; }
  }

  if (touch.active) {
    // Touch: on the ground (and up the wall) the stick only steers and the pedals drive. In the
    // air it flies, and pushing up raises the nose: what people expect on a phone.
    ax += touch.x;
    if (air) ay -= touch.y;
    if (touch.lift) lift = 1;
    if (touch.land) land = 1;
    if (touch.go) { thr = 1; boost = 1; }
    if (touch.brk) brk = 1;
  }
  ax = Math.max(-1, Math.min(1, ax)); ay = Math.max(-1, Math.min(1, ay));

  if (air) {
    out.roll = ax; out.pitch = -ay; out.yaw = yaw; out.lift = lift; out.level = land; out.thrust = boost;
  } else {
    out.steer = ax; out.throttle = thr; out.brake = brk; out.lift = lift;
    out.thrust = land && !brk ? 1 : 0;   // Shift on the ground = rear boost
  }
  return out;
}
