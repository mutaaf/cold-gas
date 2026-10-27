// Advanced mode: the ten valves by hand. One map from keyboard, gamepad and a touch nozzle pad to
// per-valve commands (0..1, NOZZLE_SPEC order), plus the chords a pilot actually uses:
//   LIFT   all four down-jets at the pitch-free trim (front 100 %, rear ≈66 %)
//   BOOST  all four rear jets
//   FRONTS both front down-jets (nose up)
// The keyboard is laid out like the car seen from above, nose up (left hand). The 3 × 3 block is
// the four down-jets: corners are single jets, edges are the pairs on that side.
//    1   ·   3      fender (yaw) jets, left / right
//    Q   W   E      front-left · both fronts · front-right
//    A   ·   D      left pair · right pair (trimmed: a pure roll)
//    Z   S   C      rear-left · both rears · rear-right
//    V B N M        the rear row, left → right (as you sit in it)
//   Space LIFT (all four, trimmed) · F BOOST (the rear row) · Shift held: every key half open
//   With Space held, W A S D throttle the opposite pair back instead (steer a burn by unbalancing it)
// Valves only answer in the air (and on the ledge once released): on the ground W A S D drive.
import { NOZZLE_SPEC } from './sim/spec.js';
import { TRIM } from './sim/vehicle.js';

export const VALVES = NOZZLE_SPEC.length;
const IDX = Object.fromEntries(NOZZLE_SPEC.map((n, i) => [n.id, i]));
const DOWN = ['down-fl', 'down-fr', 'down-rl', 'down-rr'].map((id) => IDX[id]);
const REAR = ['rear-4', 'rear-3', 'rear-2', 'rear-1'].map((id) => IDX[id]);   // left → right

// Per nozzle: its key, a short name, and where it sits on the touch pad (a 300 × 380 car, nose up).
export const NOZZLE_UI = {
  'yaw-l': { key: '1', code: 'Digit1', name: 'Left fender', pad: [44, 34] },
  'yaw-r': { key: '3', code: 'Digit3', name: 'Right fender', pad: [256, 34] },
  'down-fl': { key: 'Q', code: 'KeyQ', name: 'Front left', pad: [58, 116] },
  'down-fr': { key: 'E', code: 'KeyE', name: 'Front right', pad: [242, 116] },
  'down-rl': { key: 'Z', code: 'KeyZ', name: 'Rear left', pad: [58, 250] },
  'down-rr': { key: 'C', code: 'KeyC', name: 'Rear right', pad: [242, 250] },
  'rear-4': { key: 'V', code: 'KeyV', name: 'Tail 1', pad: [36, 342] },
  'rear-3': { key: 'B', code: 'KeyB', name: 'Tail 2', pad: [96, 342] },
  'rear-2': { key: 'N', code: 'KeyN', name: 'Tail 3', pad: [204, 342] },
  'rear-1': { key: 'M', code: 'KeyM', name: 'Tail 4', pad: [264, 342] },
};
const pair = (a, b) => [[IDX[a], 1], [IDX[b], 1]];
// A side pair at the lift trim (front 100 %, rear ≈66 %): the rear jet sits further from the CoM,
// so an even pair would pitch the nose down with every roll. Trimmed, it's a pure roll.
const sidePair = (a, b) => [[IDX[a], TRIM[IDX[a]]], [IDX[b], TRIM[IDX[b]]]];
export const CHORDS = {
  lift: { label: 'LIFT', key: 'Space', code: 'Space', pad: [150, 183], valves: DOWN.map((i) => [i, TRIM[i]]) },
  boost: { label: 'BOOST', key: 'F', code: 'KeyF', pad: [150, 342], valves: REAR.map((i) => [i, 1]) },
  fronts: { label: 'FRONTS', key: 'W', code: 'KeyW', pad: [150, 60], valves: pair('down-fl', 'down-fr') },
  rears: { label: 'REARS', key: 'S', code: 'KeyS', valves: pair('down-rl', 'down-rr') },
  left: { label: 'LEFT', key: 'A', code: 'KeyA', valves: sidePair('down-fl', 'down-rl') },
  right: { label: 'RIGHT', key: 'D', code: 'KeyD', valves: sidePair('down-fr', 'down-rr') },
};
const KEY_VALVE = NOZZLE_SPEC.map((n) => NOZZLE_UI[n.id].code);

// Keyboard → valves. `down(code)` says whether a key is held.
// With LIFT (Space) held, every down-jet is already open, so a pair key can't open its pair any
// further: instead it throttles the OPPOSITE pair back to half (A: the right pair, so the left
// side lifts; W: the rears, so the nose lifts). Steering on a full burn is unbalancing it.
const OPPOSITE = { left: 'right', right: 'left', fronts: 'rears', rears: 'fronts' };
// Flat lists, built once: this runs every 240 Hz tick in Advanced (no allocation in the hot path).
const CHORD_LIST = Object.entries(CHORDS).map(([id, c]) => ({ code: c.code, valves: c.valves, pair: !!OPPOSITE[id] }));
const PAIR_LIST = Object.entries(OPPOSITE).map(([id, opp]) => ({ code: CHORDS[id].code, other: CHORDS[opp].valves }));
export function keyValves(down, out) {
  const k = down('ShiftLeft') || down('ShiftRight') ? 0.5 : 1;
  const lift = down(CHORDS.lift.code);
  for (let i = 0; i < VALVES; i++) if (down(KEY_VALVE[i])) out[i] = Math.max(out[i], k);
  for (let c = 0; c < CHORD_LIST.length; c++) {
    const ch = CHORD_LIST[c];
    if (!down(ch.code) || (lift && ch.pair)) continue;
    for (let j = 0; j < ch.valves.length; j++) out[ch.valves[j][0]] = Math.max(out[ch.valves[j][0]], ch.valves[j][1] * k);
  }
  if (lift) {
    for (let p = 0; p < PAIR_LIST.length; p++) {
      if (!down(PAIR_LIST[p].code)) continue;
      const o = PAIR_LIST[p].other;
      for (let j = 0; j < o.length; j++) out[o[j][0]] *= 0.5;
    }
  }
  return out;
}

// A key is on or off; a thumb on a valve isn't. Held, a key's valves open to full over 0.2 s (a
// tap is a small impulse, a hold a full one); released, they shut at once. Two 20 kN down-jets
// 0.75 m off the axis roll the car at ≈49 rad/s², so an instant full valve overshoots inside a
// reaction time. Sampled once per 240 Hz tick, in 5 % steps (the input log stays small).
export const KEY_RAMP = 1 / (0.2 * 240);
export function createKeyRamp() {
  const level = new Float64Array(VALVES), want = new Float64Array(VALVES);
  return function ramp(down, out) {
    want.fill(0);
    keyValves(down, want);
    for (let i = 0; i < VALVES; i++) {
      level[i] = want[i] <= level[i] ? want[i] : Math.min(want[i], level[i] + KEY_RAMP);
      out[i] = Math.max(out[i], Math.round(level[i] * 20) / 20);
    }
    return out;
  };
}

// Gamepad (standard mapping) → valves, in the air. The shoulders are the corners: bumpers are the
// front down-jets, the analog triggers the rear ones. A = BOOST, Y = LIFT, X / B = the left / right
// fender jet, d-pad ← / → = the left / right pair of the rear row. Analog values go in 5 % steps
// (a trigger's noise would otherwise fill the input log).
const step5 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 20) / 20;
// Once per 240 Hz tick in the air: no closures, no iterators (0049).
const btn = (p, i) => p.buttons[i]?.value || (p.buttons[i]?.pressed ? 1 : 0);
const setV = (out, i, v) => { const s = Math.round(Math.max(0, Math.min(1, v)) * 20) / 20; if (s > out[i]) out[i] = s; };   // step5, inline
const I_FL = IDX['down-fl'], I_FR = IDX['down-fr'], I_RL = IDX['down-rl'], I_RR = IDX['down-rr'], I_YL = IDX['yaw-l'], I_YR = IDX['yaw-r'];
export function padValves(p, out) {
  setV(out, I_FL, btn(p, 4)); setV(out, I_FR, btn(p, 5));
  setV(out, I_RL, btn(p, 6)); setV(out, I_RR, btn(p, 7));
  setV(out, I_YL, btn(p, 2)); setV(out, I_YR, btn(p, 1));
  if (btn(p, 0) > 0.5) for (let j = 0; j < REAR.length; j++) setV(out, REAR[j], 1);
  if (btn(p, 3) > 0.5) { const lv = CHORDS.lift.valves; for (let j = 0; j < lv.length; j++) setV(out, lv[j][0], lv[j][1]); }
  if (btn(p, 14) > 0.5) { setV(out, REAR[0], 1); setV(out, REAR[1], 1); }
  if (btn(p, 15) > 0.5) { setV(out, REAR[2], 1); setV(out, REAR[3], 1); }
  return out;
}

// The touch nozzle pad: ten pads on a car outline plus the three chords. Multi-touch; a finger can
// slide from pad to pad (a thumb rolled from front-left to front-right). Pressure-sensitive where
// the device reports real pressure (a pen, a force-touch screen), else a touch is a full valve.
export function bindNozzlePad(root) {
  const el = root.querySelector('[data-nozzle-pad]');
  const valves = new Float64Array(VALVES);
  if (!el) return { valves, el: null, active: () => false, show: () => {}, sync: () => {} };
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = el.querySelector('svg');
  const targets = [];   // { el, ring, valves: [[i, v]] }
  const ringLen = 2 * Math.PI * 22;
  const addPad = (x, y, r, label, sub, valvesOf, cls) => {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `np ${cls}`);
    g.setAttribute('transform', `translate(${x} ${y})`);
    g.innerHTML = `<circle class="np-hit" r="${r + 6}"/><circle class="np-bg" r="${r}"/><circle class="np-ring" r="22" pathLength="${ringLen.toFixed(1)}" stroke-dasharray="0 ${ringLen.toFixed(1)}" transform="rotate(-90)"/><text class="np-k" y="${sub ? -2 : 4}">${label}</text>${sub ? `<text class="np-s" y="11">${sub}</text>` : ''}`;
    svg.appendChild(g);
    const t = { el: g, ring: g.querySelector('.np-ring'), valves: valvesOf, last: -1 };
    g.dataset.pad = String(targets.length);
    targets.push(t);
    return t;
  };
  NOZZLE_SPEC.forEach((n, i) => {
    const u = NOZZLE_UI[n.id];
    addPad(u.pad[0], u.pad[1], n.group === 'lift' ? 28 : 24, u.key, n.group === 'lift' ? n.id.slice(5).toUpperCase() : '', [[i, 1]], `g-${n.group}`);
  });
  for (const c of Object.values(CHORDS)) if (c.pad) addPad(c.pad[0], c.pad[1], c === CHORDS.lift ? 34 : 28, c.label, '', c.valves, 'chord');
  const nozzleTargets = targets.slice(0, VALVES);

  const touches = new Map();   // pointerId → { pad, pressure }
  const realPressure = (e) => e.pointerType === 'pen' || (e.pressure > 0 && e.pressure !== 0.5 && e.pressure !== 1);
  const padAt = (x, y) => {
    const hit = document.elementFromPoint(x, y)?.closest?.('[data-pad]');
    return hit && el.contains(hit) ? Number(hit.dataset.pad) : -1;
  };
  const recompute = () => {
    valves.fill(0);
    for (const { pad, pressure } of touches.values()) {
      if (pad < 0) continue;
      for (const [i, v] of targets[pad].valves) valves[i] = Math.max(valves[i], step5(v * pressure));
    }
    for (let i = 0; i < targets.length; i++) {
      let on = false;
      for (const t of touches.values()) if (t.pad === i) on = true;
      targets[i].el.classList.toggle('on', on);
    }
  };
  const down = (e) => {
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    touches.set(e.pointerId, { pad: padAt(e.clientX, e.clientY), pressure: realPressure(e) ? Math.max(0.15, e.pressure) : 1 });
    recompute();
  };
  const move = (e) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.pad = padAt(e.clientX, e.clientY);
    if (realPressure(e)) t.pressure = Math.max(0.15, e.pressure);
    recompute();
  };
  const up = (e) => { touches.delete(e.pointerId); recompute(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  return {
    valves, el,
    active: () => !el.hidden,
    show(on) { el.hidden = !on; if (!on) { touches.clear(); recompute(); } },
    // Every finger off (blur, a hidden tab, pause): no valve stays open, no pad stays lit.
    reset() { if (touches.size) { touches.clear(); recompute(); } },
    // Each nozzle's live valve as a ring around its pad (only touched when it changes).
    sync(throttles) {
      for (let i = 0; i < VALVES; i++) {
        const t = nozzleTargets[i], v = Math.round(throttles[i] * 50);
        if (v === t.last) continue;
        t.last = v;
        t.ring.setAttribute('stroke-dasharray', `${((v / 50) * ringLen).toFixed(1)} ${ringLen.toFixed(1)}`);
      }
    },
  };
}
