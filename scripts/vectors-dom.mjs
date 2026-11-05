// The page's input layer (src/input.js, src/touch-settings.js) in Node, for the native port's input vectors
// (scripts/vectors-lib.mjs inputList, ticket 0154). input.js reads touches only through DOM pointer events on
// the controls it binds, and the tilt through `deviceorientation`; this is the least DOM that lets a script
// press those same controls, so the vectors come from the code the page runs, not from a copy of it.
// Importing this installs the shim on globalThis (a Node process with no DOM: scripts/vectors.mjs, the
// vectors unit test) and then imports the real modules.
const win = {};   // window listeners by type (deviceorientation)
const store = { coldgas_touch: JSON.stringify({ tilt: true }) };   // tilt on (it reads 0 until a reading)
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
if (typeof globalThis.document === 'undefined') {
  def('addEventListener', (t, f) => { (win[t] ||= []).push(f); });
  def('removeEventListener', () => {});
  // The nozzle pad (src/valves.js bindNozzlePad) builds its pads as SVG and finds the one under a finger with
  // elementFromPoint: here a finger's clientX is 1000 + the pad's index (−1: off every pad).
  const node = () => ({ setAttribute() {}, appendChild() {}, querySelector: () => node(), dataset: {}, classList: { toggle() {} }, innerHTML: '' });
  def('document', {
    documentElement: { dataset: {}, classList: { add() {}, remove() {} }, offsetWidth: 0 },   // src/units.js stamps the units on it
    addEventListener() {}, querySelectorAll: () => [], activeElement: null, createElementNS: node,
    elementFromPoint: (x) => (x >= 1000 ? { closest: () => ({ dataset: { pad: String(x - 1000) } }) } : null),
  });
  def('screen', { orientation: { angle: 0, addEventListener() {} } });
  def('DeviceOrientationEvent', class {});
  def('localStorage', { getItem: (k) => store[k] ?? null, setItem() {}, removeItem() {} });
}

// A control: its box, and the listeners input.js put on it.
function control(rect) {
  const on = {};
  return {
    addEventListener(t, f) { (on[t] ||= []).push(f); },
    dispatch(t, e) { for (const f of on[t] || []) f(e); },
    getBoundingClientRect: () => rect,
    setPointerCapture() {}, contains: () => true,
    classList: { add() {}, remove() {}, toggle() {} },
    style: { transform: '', setProperty() {}, removeProperty() {} },
  };
}
// The stick: 112 px across, centred at (100, 747); input.js's radius is 56 px. The pedals: 80 × 100 px.
export const STICK = { cx: 100, cy: 747, R: 56 };
const els = {
  '[data-stick]': control({ left: 44, top: 691, width: 112, height: 112 }),
  '[data-knob]': control({ left: 0, top: 0, width: 0, height: 0 }),
  '[data-btn-lift]': control({ left: 200, top: 600, width: 80, height: 100 }),
  '[data-btn-land]': control({ left: 290, top: 600, width: 80, height: 100 }),
  '[data-btn-go]': control({ left: 290, top: 720, width: 80, height: 100 }),
  '[data-btn-brake]': control({ left: 200, top: 720, width: 80, height: 100 }),
  '[data-onethumb]': control({ left: 230, top: 630, width: 120, height: 120 }),
  '[data-nozzle-pad]': Object.assign(control({ left: 0, top: 0, width: 390, height: 300 }), { querySelector: () => ({ appendChild() {} }), hidden: true }),
};
const root = { querySelector: (s) => els[s] || null, querySelectorAll: () => [] };

export const input = await import('../src/input.js');
export const touchSettings = await import('../src/touch-settings.js');
input.bindInput(root);

const ev = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, pressure: 0.5, preventDefault() {} });
const BTN = { go: ['[data-btn-go]', 11], brk: ['[data-btn-brake]', 12], lift: ['[data-btn-lift]', 13], land: ['[data-btn-land]', 14] };
let stickDown = false;
const nozzleDown = new Set();
// What a finger does on the controls, through input.js's own handlers.
export const dom = {
  // The stick's thumb at (dx, dy) px from its centre (input.js clamps it to the ring): down, or a move.
  stick(dx, dy) {
    const s = els['[data-stick]'], e = ev(1, STICK.cx + dx, STICK.cy + dy);
    if (!stickDown) { stickDown = true; s.dispatch('pointerdown', e); } else s.dispatch('pointermove', e);
  },
  stickUp() { if (stickDown) { stickDown = false; els['[data-stick]'].dispatch('pointerup', ev(1, 0, 0)); } },
  // A button pressed (`fy`: how far down the pad, 0 top … 1 bottom: an Advanced pedal's amount) or let go.
  press(name, fy = 0.5) { const [sel, id] = BTN[name], b = els[sel], r = b.getBoundingClientRect(); b.dispatch('pointerdown', ev(id, r.left + 10, r.top + fy * r.height)); },
  release(name) { const [sel, id] = BTN[name]; els[sel].dispatch('pointerup', ev(id, 0, 0)); },
  // A finger on the nozzle pad (Advanced in the air): `pad` a nozzle 0–9 (NOZZLE_SPEC order) or a chord 10+,
  // −1 off every pad; null lifts it. Finger ids from 20.
  nozzle(finger, pad) {
    const el = els['[data-nozzle-pad]'], e = ev(20 + finger, pad === null ? 0 : 1000 + pad, 0);
    if (pad === null) el.dispatch('pointerup', e);
    else el.dispatch(nozzleDown.has(finger) ? 'pointermove' : 'pointerdown', e);
    if (pad === null) nozzleDown.delete(finger); else nozzleDown.add(finger);
  },
  // The phone's roll (deg) as DeviceOrientation reports it in portrait.
  tilt(gamma) { for (const f of win.deviceorientation || []) f({ beta: 0, gamma }); },
  // Everything let go, the hands from rest (a new run: src/input.js freshRun), and the one-thumb pad reset.
  fresh() { stickDown = false; nozzleDown.clear(); input.freshRun(); input.thumb.reset(); },
};
