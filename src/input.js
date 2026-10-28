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
//            the run off one-thumb; a finger brings them back. Blur, a hidden tab, pagehide, pause
//            and every new run or drill let go of everything (`resetInput`, `freshRun`), and what was
//            held then counts again only once it is pressed again (0099). Gamepad Start pauses.
import { newInput, clearInput, VALVE_KEYS } from './sim/vehicle.js';
import { createKeyRamp, padValves, bindNozzlePad, VALVES } from './valves.js';
import { createOneThumb } from './onethumb.js';
import { tiltSteer, buzz, armTiltGrant } from './touch-settings.js';
import { createDriver, shapeStick, applyGround, loadDriving, saveDriving, validLevel, TC_MODES } from './driving.js';

const keys = new Set();
const touch = { active: false, x: 0, y: 0, lift: false, land: false, go: false, brk: false, goAmt: 1, brkAmt: 1 };

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
// pad, and the pressed look on each. On blur, a hidden tab, pagehide, pause and every new run: a finger
// or a key lifted while the page wasn't listening must not stay held.
// And what is still down then waits for a fresh press (0099): a key's auto-repeat doesn't bring it back
// (keydown below), a finger still on a button sends no new pointerdown, and a gamepad is ignored until
// it has been at rest once (`padHeld`, copyPads). A restart with Space held used to lift the new run
// off the line within a second; a finger left on LAND as the results hid it boosted the next run-up.
const resetters = [];
function resetTouch() { for (const fn of resetters) fn(); }
export function resetInput() {
  keys.clear(); resetTouch();
  for (let i = 0; i < padHeld.length; i++) padHeld[i] = true;
}
// A new run or drill: let go of everything, and the hands start from rest (the wheel centred, no
// pedal still ramping down from the last run, no valve still open on the key ramp).
export function freshRun() {
  resetInput();
  driver.reset();
  keyRamp.reset();
}

// Does this keydown hold its key? An auto-repeat of a key that isn't held is a key we let go of (a
// restart, pause, blur): it counts again on its next real press, not on the repeats of the press from
// before (0099). The first press, and a repeat of a key still held, do.
export const keyHolds = (e, held) => !e.repeat || held.has(e.code);

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
    if (keyHolds(e, keys)) keys.add(e.code);
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
    // GO and BRAKE are analog pedals in Advanced driving: how far up the pad the finger is (or slides).
    const pedal = k === 'go' ? 'goAmt' : k === 'brk' ? 'brkAmt' : null;
    const press = (e) => {
      if (!pedal) return;
      const r = b.getBoundingClientRect();
      touch[pedal] = r.height > 0 ? pedalAmount((e.clientY - r.top) / r.height) : 1;
      if (driver.level === 'advanced') b.style.setProperty('--amt', touch[pedal].toFixed(2));
    };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[k] = true; touch.active = true; press(e); b.classList.add('on'); b.setPointerCapture(e.pointerId); buzz('tap'); });
    if (pedal) b.addEventListener('pointermove', (e) => { if (touch[k]) press(e); });
    const off = () => { touch[k] = false; b.classList.remove('on'); b.style.removeProperty('--amt'); };
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
// What it read is what every tick of this frame samples (0049): Chrome's getGamepads() makes a new array
// on every call, each axis and button value read from a pad is a new number, and a frame runs up to eight
// 240 Hz ticks. So the pads are copied once a frame into reused objects of the same shape (every axis and
// button there, as plain numbers). Before the first poll (tests, benches) a sample copies them itself.
let startWas = false, yWas = false;
// A gamepad's Y, pressed (the edge, once a frame): Free Drive toggles AI drive with it on the ground (0109).
const padYFns = new Set();
export const onPadY = (fn) => { padYFns.add(fn); return () => padYFns.delete(fn); };
const NO_PADS = [], PAD_BUTTONS = 18;
const newPadCopy = () => ({ axes: new Float64Array(4), buttons: Array.from({ length: PAD_BUTTONS }, () => ({ pressed: false, value: 0 })) });
const padCopies = [newPadCopy(), newPadCopy(), newPadCopy(), newPadCopy()];   // more if a browser lists more slots
const padsFrame = [null, null, null, null];
const padHeld = [false, false, false, false];   // let go of (resetInput) and not yet back at rest: ignored
let padsNow = null;
function copyPad(p, c) {
  for (let a = 0; a < 4; a++) c.axes[a] = p.axes[a] || 0;
  for (let b = 0; b < PAD_BUTTONS; b++) {
    const s = p.buttons[b], d = c.buttons[b];
    d.pressed = !!s?.pressed; d.value = s?.value || 0;
  }
  return c;
}
function copyPads() {
  const pads = navigator.getGamepads?.();
  const n = pads ? pads.length : 0;
  while (padCopies.length < n) { padCopies.push(newPadCopy()); padsFrame.push(null); padHeld.push(false); }
  for (let i = 0; i < padsFrame.length; i++) {
    const c = i < n && pads[i] ? copyPad(pads[i], padCopies[i]) : null;
    // A pad held through a reset drives nothing until it has been let go (padIntent: a button, a trigger
    // past 0.3 or a stick past half; a stick resting under half and its drift never hold it off).
    if (c && padHeld[i] && padIntent(c)) { padsFrame[i] = null; continue; }
    padHeld[i] = false;
    padsFrame[i] = c;
  }
  return pads;
}
const readPads = () => padsNow || (copyPads(), padsFrame);
export function pollPads() {
  const pads = copyPads();
  padsNow = padsFrame;
  if (!pads) return;
  let start = false, intent = false, y = false;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p) continue;
    if (p.buttons[9]?.pressed) start = true;
    else if (!intent && padIntent(p)) intent = true;
    if (padsFrame[i] && padsFrame[i].buttons[3].pressed) y = true;   // a pad held off by a reset doesn't count
  }
  if (intent || start) device.note('pad');
  if (start && !startWas) onPauseCb?.();
  startWas = start;
  if (y && !yWas) for (const fn of padYFns) fn();
  yWas = y;
  return intent || start;   // a pad in use: the title isn't idle (src/main.js syncLife)
}

// One-thumb: the run's input for this tick from the one control (and tilt, on the ground).
export function sampleThumb(run, released, out = newInput()) {
  clearInput(out);
  return thumb.sample(run, released, out, tiltSteer());
}

const k = (a, b) => keys.has(a) || (b !== undefined && keys.has(b));   // no rest args: 240 calls a second each (0049)


// Keys are on/off; a driver's hands aren't: src/hands.js turns keys and the touch stick into a
// steering wheel and pedals (speed-aware), once per 240 Hz sim tick, the same hands the drive
// bench (scripts/drive-feel.mjs) and the unit tests use. On the ground they belong to the driving
// level (src/driving.js: Easy / Standard / Advanced, one setting for every mode); in the air the
// flight keeps the hands it always had, whatever the level.
export const driving = loadDriving(primaryCoarse);
const driver = createDriver(driving.level, driving);
const hands = driver.hands;
const drivingFns = new Set();
export const onDriving = (fn) => { drivingFns.add(fn); return () => drivingFns.delete(fn); };
export const drivingLevel = () => driver.level;
// Change the driving setting (level, tc, abs, ai: Free Drive's AI drive, 0109) and remember it on this device.
export function setDriving(patch = {}) {
  if (validLevel(patch.level)) driving.level = patch.level;
  if (TC_MODES.includes(patch.tc)) driving.tc = patch.tc;
  if (typeof patch.abs === 'boolean') driving.abs = patch.abs;
  if (typeof patch.ai === 'boolean') driving.ai = patch.ai;
  driving.saved = true;
  saveDriving(driving);
  driver.set(driving.level, driving);
  for (const fn of drivingFns) fn(driving);
  return driving;
}
// What the driver did on the last ground tick (tests): the level, AI drive, the steer, the aids (allocates).
export const drivingState = () => ({ level: driver.level, ai: driver.ai, steer: driver.steer, throttle: driver.throttle, aid: { ...driver.aid } });
// A finger near the top of an Advanced pedal is full; near the bottom about a third.
export const pedalAmount = (fy) => Math.max(0.35, Math.min(1, 0.35 + 0.65 * (1 - fy)));
const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
const raw = { keyAx: 0, stickAx: 0, tilt: 0, up: false, down: false, thrA: 0, brkA: 0, hb: 0 };
const drv = { steer: 0, throttle: 0, brake: 0, ground: null };

// Touch is the device in use: its controls are on screen and the cues name its buttons.
export const usingTouch = () => device.touch;

// Sample into a sim input. `phase` is the run phase; `tier` the flight tier ('assist' | 'pro' |
// 'advanced'; a boolean means assist on/off); `released` whether the car has let go of the Wall;
// `car` (optional) the vehicle state, for the keyboard's speed-sensitive steering and the driving
// aids; `ctx` (optional) { free: an unscored mode (Free Drive, the Sandbox), road: Free Drive's road }.
// On a scored run the flight tier keeps the `assist`/`manual` channels (any Assist tick makes an Assist
// run); on an unscored ground the driving level sets them, and the car's TC/ABS/handbrake.
// Everything is driver-relative: + steer, roll and yaw are to the right (src/sim/vehicle.js).
const vScratch = new Float64Array(VALVES);
if (VALVE_KEYS.join() !== 'v0,v1,v2,v3,v4,v5,v6,v7,v8,v9') throw new Error('input.js: the valves changed; update advanced()');
const keyRamp = createKeyRamp(), isDown = (c) => keys.has(c);
export function sample(phase, tier, out = newInput(), released = false, car = null, ctx = null) {
  clearInput(out);
  if (typeof tier === 'boolean') tier = tier ? 'assist' : 'pro';
  out.assist = tier === 'assist' ? 1 : 0;
  out.manual = tier === 'advanced' ? 1 : 0;
  // Let go of the Wall, you're flying (the sim calls it airborne 0.1 s later).
  const air = phase === 'air' || (phase === 'ramp' && released);
  let ax = 0, ay = 0, lift = 0, land = 0, thr = 0, brk = 0, yaw = 0;
  const v = !air && car ? Math.sqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z) : 0;   // not Math.hypot: it boxes its answer
  // On the ground the touch stick goes through the same hands as the keys: a thumb can't feather
  // a 2 cm stick, so it sets where the wheel is going and the wheel follows at the speed's rate
  // (with a mild expo: the middle of the stick is the fine part of the lock). The level shapes it.
  const lvl = driver.level;
  const stickGround = touch.active && !air ? shapeStick(lvl, touch.x, 'touch') : 0;
  // A gamepad's stick too: shaped (src/hands.js stickShape) and rate-limited like a thumb, or a
  // full flick at 140 km/h reached the rack's lock in 29 ms and the yaw overshot by half.
  const pads = readPads();
  let padGround = 0;
  if (!air) for (let i = 0; i < pads.length; i++) if (pads[i]) padGround += shapeStick(lvl, pads[i].axes[0], 'pad');
  const keyAx = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0), stickAx = stickGround + padGround;
  // The air's roll keeps the hands it always had; the ground's wheel is the driving level's (below).
  if (air) ax = hands.steer(Math.max(-1, Math.min(1, keyAx + stickAx)), v, keyAx === 0 && stickAx !== 0);
  if (k('ArrowUp', 'KeyW')) ay -= 1;
  if (k('ArrowDown', 'KeyS')) ay += 1;
  if (k('KeyQ')) yaw -= 1;
  if (k('KeyE')) yaw += 1;
  if (k('Space')) lift = 1;
  if (k('ShiftLeft', 'ShiftRight')) land = 1;
  let boost = k('KeyF') ? 1 : 0;
  // The phone's GO and BRAKE are buttons too: on the ground they press the pedals like the keys.
  const tGo = touch.active && touch.go && !air, tBrk = touch.active && touch.brk && !air;
  if (air) ({ thr, brk } = hands.pedals(ay < 0 || tGo, ay > 0 || tBrk));

  let thrA = 0, brkA = 0, hb = 0;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p) continue;
    const rt = p.buttons[7].value, lt = p.buttons[6].value;
    if (!air) {
      // Driving: the triggers are analog pedals, A is LIFT (the ledge's RELEASE), B the handbrake.
      thrA = Math.max(thrA, rt); brkA = Math.max(brkA, lt);
      if (p.buttons[0].pressed) lift = 1;
      if (p.buttons[1].pressed) hb = 1;
      continue;
    }
    if (out.manual) continue;
    ax += dz(p.axes[0]);
    ay += dz(p.axes[1]);
    yaw += dz(p.axes[2]) * 0.8;
    lift = Math.max(lift, rt, p.buttons[0].pressed ? 1 : 0); land = Math.max(land, lt > 0.3 || p.buttons[1].pressed ? 1 : 0); if (p.buttons[5].pressed) boost = 1;
  }
  if (!air) {
    // The driving level turns keys, sticks, triggers, the touch pedals and the tilt into the wheel and
    // the pedals (src/driving.js). Advanced's touch pedals are analog: how far up the pad the finger is.
    const adv = lvl === 'advanced';
    raw.keyAx = keyAx; raw.stickAx = stickAx; raw.tilt = tiltSteer();
    raw.up = ay < 0 || (tGo && !adv); raw.down = ay > 0 || (tBrk && !adv);
    raw.thrA = Math.max(thrA, tGo && adv ? touch.goAmt : 0); raw.brkA = Math.max(brkA, tBrk && adv ? touch.brkAmt : 0);
    raw.hb = ctx?.free && (k('KeyH') || hb) ? 1 : 0;
    driver.tick(raw, car, ctx, drv);
    ax = drv.steer; thr = drv.throttle; brk = drv.brake;
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
  ax = Math.max(-1, Math.min(1, ax)); ay = Math.max(-1, Math.min(1, ay));

  // An unscored ground: the level's stability control, traction control, ABS and handbrake. In the air,
  // and on every scored run, the flight tier's channels and a stock car.
  if (ctx?.free && car) applyGround(air ? null : drv.ground, out, car, air);
  if (out.manual) return advanced(out, air, lift, ax, thr, brk);
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
// Space on the ledge is still RELEASE (and opens the four down-jets, like the real push-off). On the
// ground the wheel and pedals come through the driving level like every tier's (this used to add the
// raw gamepad stick and skip the hands).
function advanced(out, flying, liftKey, ax, thr, brk) {
  if (!flying) {
    out.steer = ax; out.throttle = thr; out.brake = brk; out.lift = liftKey;
    return out;
  }
  const pads = readPads();
  vScratch.fill(0);
  keyRamp(isDown, vScratch);
  for (let i = 0; i < pads.length; i++) if (pads[i]) padValves(pads[i], vScratch);
  const pad = nozzlePad.valves;
  // By name, not out[VALVE_KEYS[i]]: a store by a computed key boxes the number (0049; ten valves, v0…v9).
  const v = vScratch;
  out.v0 = Math.max(v[0], pad[0]); out.v1 = Math.max(v[1], pad[1]); out.v2 = Math.max(v[2], pad[2]); out.v3 = Math.max(v[3], pad[3]);
  out.v4 = Math.max(v[4], pad[4]); out.v5 = Math.max(v[5], pad[5]); out.v6 = Math.max(v[6], pad[6]); out.v7 = Math.max(v[7], pad[7]);
  out.v8 = Math.max(v[8], pad[8]); out.v9 = Math.max(v[9], pad[9]);
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
