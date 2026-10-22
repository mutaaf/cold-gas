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
// Device     the last one used wins (`device`): a key or a pad hides the touch controls and takes
//            the run off one-thumb; a finger brings them back. Blur, a hidden tab, pagehide and
//            pause let go of everything (`resetInput`). Gamepad Start pauses.
import { newInput, VALVE_KEYS } from './sim/vehicle.js';
import { createKeyRamp, padValves, bindNozzlePad, VALVES } from './valves.js';
import { createOneThumb } from './onethumb.js';
import { tiltSteer, buzz, armTiltGrant } from './touch-settings.js';
import { createHands, stickShape } from './hands.js';

const keys = new Set();
const touch = { active: false, x: 0, y: 0, lift: false, land: false, go: false, brk: false };

let nozzlePad = { valves: new Float64Array(VALVES), active: () => false, show: () => {}, sync: () => {}, reset: () => {} };
export const getNozzlePad = () => nozzlePad;
export const thumb = createOneThumb();
const STICK_DEAD = 0.15;
const deadzone = (v) => (Math.abs(v) < STICK_DEAD ? 0 : (Math.sign(v) * (Math.abs(v) - STICK_DEAD)) / (1 - STICK_DEAD));

// One guard for the game's key handlers: a key typed into a field is never the game's.
export const isEditable = (t) => !!t?.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"])');

// The device the player last used: 'touch' | 'key' | 'pad' | 'mouse' | 'none'. It decides whether the
// touch controls are on screen (a key or a pad on an iPad hides them; a finger on a touchscreen
// laptop shows them), which path the run's input takes (one-thumb only while touch is the device)
// and which glyphs the cues print. Listeners hear only a change between touch and not-touch.
export function createDevice(initial = 'none') {
  let last = initial;
  const fns = new Set();
  return {
    get last() { return last; },
    get touch() { return last === 'touch'; },
    note(kind) {
      if (kind === last) return;
      const was = last === 'touch';
      last = kind;
      if (was !== (kind === 'touch')) for (const fn of fns) fn(kind);
    },
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}
// A gamepad the player is using: a button pressed or a stick pushed past half (an idle pad's drift
// and a trigger at rest never count).
export function padIntent(p) {
  if (!p) return false;
  for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i]?.pressed || (p.buttons[i]?.value || 0) > 0.3) return true;
  for (let i = 0; i < Math.min(4, p.axes.length); i++) if (Math.abs(p.axes[i] || 0) > 0.5) return true;
  return false;
}
const primaryCoarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const device = createDevice(primaryCoarse ? 'touch' : 'none');
export const lastDevice = () => device.last;
export const onDevice = (fn) => device.on(fn);

// Let go of everything: keys, the stick, GO / BRAKE / LIFT / LAND, the one-thumb pad and the nozzle
// pad, and the pressed look on each. On blur, a hidden tab, pagehide and pause: a finger or a key
// lifted while the page wasn't listening must not stay held.
const resetters = [];
function resetTouch() { for (const fn of resetters) fn(); }
export function resetInput() { keys.clear(); resetTouch(); }

let onPauseCb = null;
const MODS = new Set(['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight']);
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const onControl = (t) => !!t?.closest?.('button, a, [role="radio"]');

// `running()`: a run is on (countdown or live), so Space and the arrows belong to the car even
// when a button has focus.
export function bindInput(root, { onPause, running = () => false } = {}) {
  nozzlePad = bindNozzlePad(root);
  onPauseCb = onPause;
  addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;
    // A Cmd chord is the system's (macOS sends no keyup for a key pressed under Cmd: it stuck).
    if (e.metaKey) return;
    // Space on a focused button clicks it on keyup: a mouse-clicked Retry restarted the run mid-flight.
    if (GAME_KEYS.has(e.code) && (running() || !onControl(e.target))) e.preventDefault();
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) onPause?.();
    if (!MODS.has(e.code)) device.note('key');
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'MetaLeft' || e.code === 'MetaRight' || e.code === 'OSLeft' || e.code === 'OSRight') keys.clear();
    if (e.code === 'Space' && running() && onControl(e.target)) e.preventDefault();
  });
  addEventListener('blur', resetInput);
  addEventListener('pagehide', resetInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
  // A finger anywhere means touch (a touchscreen laptop gets the touch controls on its first tap);
  // a mouse means keyboard and mouse, except on a phone or tablet, whose taps can arrive as mouse.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') device.note('touch');
    else if (e.pointerType === 'mouse' && !primaryCoarse) device.note('mouse');
  }, true);
  // A button clicked with the mouse keeps no focus: Space and the arrows are the game's.
  document.addEventListener('click', (e) => {
    if (e.detail === 0) return;   // a keyboard activation keeps its focus (the Tab order)
    const b = e.target?.closest?.('button');
    if (b && document.activeElement === b && !b.closest('form, dialog, [data-ai-modal]')) b.blur();
  });
  // Leaving touch for a key, a pad or a mouse: nothing on the hidden controls stays pressed.
  device.on((kind) => { if (kind !== 'touch') resetTouch(); });

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
  const centre = () => { id = null; touch.x = 0; touch.y = 0; if (knob) knob.style.transform = ''; };
  const up = (e) => { if (e.pointerId === id) centre(); };
  stick?.addEventListener('pointerup', up);
  stick?.addEventListener('pointercancel', up);
  resetters.push(centre);
  for (const [sel, k] of [['[data-btn-lift]', 'lift'], ['[data-btn-land]', 'land'], ['[data-btn-go]', 'go'], ['[data-btn-brake]', 'brk']]) {
    const b = root.querySelector(sel);
    if (!b) continue;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[k] = true; touch.active = true; b.classList.add('on'); b.setPointerCapture(e.pointerId); buzz('tap'); });
    const off = () => { touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
    resetters.push(off);
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
    const release = () => { pid = null; thumb.up(); pad.classList.remove('on'); };
    const off = (e) => { if (e.pointerId === pid) release(); };
    pad.addEventListener('pointerup', off); pad.addEventListener('pointercancel', off);
    resetters.push(release);
  }
  resetters.push(() => nozzlePad.reset());
  // A long press must never open a callout or a context menu over the controls.
  for (const el of root.querySelectorAll('[data-touch], [data-nozzle-pad]')) el.addEventListener('contextmenu', (e) => e.preventDefault());
  armTiltGrant();
}

// Once a frame: a gamepad in use becomes the device, and its Start button pauses (on the press,
// not while it is held).
let startWas = false;
export function pollPads() {
  const pads = navigator.getGamepads?.();
  if (!pads) return;
  let start = false, intent = false;
  for (const p of pads) {
    if (!p) continue;
    if (p.buttons[9]?.pressed) start = true;
    else if (!intent && padIntent(p)) intent = true;
  }
  if (intent || start) device.note('pad');
  if (start && !startWas) onPauseCb?.();
  startWas = start;
}

// One-thumb: the run's input for this tick from the one control (and tilt, on the ground).
export function sampleThumb(run, released, out = newInput()) {
  Object.assign(out, newInput());
  return thumb.sample(run, released, out, tiltSteer());
}

const k = (...codes) => codes.some((c) => keys.has(c));

// Keys are on/off; a driver's hands aren't: src/hands.js turns keys and the touch stick into a
// steering wheel and pedals (speed-aware), once per 240 Hz sim tick, the same hands the drive
// bench (scripts/drive-feel.mjs) and the unit tests use.
const hands = createHands();
const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);

// Touch is the device in use: its controls are on screen and the cues name its buttons.
export const usingTouch = () => device.touch;

// Sample into a sim input. `phase` is the run phase; `tier` the flight tier ('assist' | 'pro' |
// 'advanced'; a boolean means assist on/off); `released` whether the car has let go of the Wall;
// `car` (optional) the vehicle state, for the keyboard's speed-sensitive steering.
// Everything is driver-relative: + steer, roll and yaw are to the right (src/sim/vehicle.js).
const vScratch = new Float64Array(VALVES);
const keyRamp = createKeyRamp(), isDown = (c) => keys.has(c);
export function sample(phase, tier, out = newInput(), released = false, car = null) {
  Object.assign(out, newInput());
  if (typeof tier === 'boolean') tier = tier ? 'assist' : 'pro';
  out.assist = tier === 'assist' ? 1 : 0;
  out.manual = tier === 'advanced' ? 1 : 0;
  // Let go of the Wall, you're flying (the sim calls it airborne 0.1 s later).
  const air = phase === 'air' || (phase === 'ramp' && released);
  let ax = 0, ay = 0, lift = 0, land = 0, thr = 0, brk = 0, yaw = 0;
  const v = !air && car ? Math.hypot(car.vel.x, car.vel.z) : 0;
  // On the ground the touch stick goes through the same hands as the keys: a thumb can't feather
  // a 2 cm stick, so it sets where the wheel is going and the wheel follows at the speed's rate
  // (with a mild expo: the middle of the stick is the fine part of the lock).
  const stickGround = touch.active && !air ? stickShape(touch.x, STICK_DEAD, 0.3) : 0;
  // A gamepad's stick too: shaped (src/hands.js stickShape) and rate-limited like a thumb, or a
  // full flick at 140 km/h reached the rack's lock in 29 ms and the yaw overshot by half.
  const pads = navigator.getGamepads?.() || [];
  let padGround = 0;
  if (!air && !out.manual) for (const p of pads) if (p) padGround += stickShape(p.axes[0] || 0);
  const keyAx = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0), stickAx = stickGround + padGround;
  ax = hands.steer(Math.max(-1, Math.min(1, keyAx + stickAx)), v, keyAx === 0 && stickAx !== 0);
  if (k('ArrowUp', 'KeyW')) ay -= 1;
  if (k('ArrowDown', 'KeyS')) ay += 1;
  if (k('KeyQ')) yaw -= 1;
  if (k('KeyE')) yaw += 1;
  if (k('Space')) lift = 1;
  if (k('ShiftLeft', 'ShiftRight')) land = 1;
  let boost = k('KeyF') ? 1 : 0;
  // The phone's GO and BRAKE are buttons too: on the ground they press the pedals like the keys.
  const tGo = touch.active && touch.go && !air, tBrk = touch.active && touch.brk && !air;
  ({ thr, brk } = hands.pedals(ay < 0 || tGo, ay > 0 || tBrk));

  for (const p of pads) {
    if (!p || out.manual) continue;
    if (air) ax += dz(p.axes[0] || 0);
    ay += dz(p.axes[1] || 0);
    yaw += dz(p.axes[2] || 0) * 0.8;
    const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
    if (air) { lift = Math.max(lift, rt, p.buttons[0]?.pressed ? 1 : 0); land = Math.max(land, lt > 0.3 || p.buttons[1]?.pressed ? 1 : 0); if (p.buttons[5]?.pressed) boost = 1; }
    else { thr = Math.max(thr, rt); brk = Math.max(brk, lt); if (p.buttons[0]?.pressed) lift = 1; }
  }

  if (touch.active) {
    // Touch: on the ground (and up the wall) the stick only steers and the pedals drive. In the
    // air it flies, and pushing up raises the nose: what people expect on a phone.
    if (air) { ax += deadzone(touch.x); ay -= deadzone(touch.y); }
    if (touch.lift) lift = 1;
    if (touch.land) land = 1;
    if (touch.go && air) { thr = 1; boost = 1; }
    if (touch.brk && air) brk = 1;
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
// Everything held right now, for tests (allocates: never per frame).
export const heldState = () => ({
  keys: [...keys], go: touch.go, brk: touch.brk, lift: touch.lift, land: touch.land, x: touch.x, y: touch.y,
  thumb: thumb.held, nozzle: nozzlePad.valves.some((v) => v > 0),
  on: document.querySelectorAll('[data-touch] .on, [data-onethumb].on, [data-nozzle-pad] .on').length,
});
