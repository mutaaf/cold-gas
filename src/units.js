// Units: what the player reads. The sim is SI and stays SI; every speed, distance, height, mass,
// force and pressure on screen goes through here on its way out, in BOTH systems at once: the
// primary large (US customary by default: mph, mi, ft, lb, lbf, psi) and the other beside it,
// smaller and dimmer ("87 mph · 140 km/h"). Tapping any unit readout swaps which one leads, across
// the whole game at once, and the choice is kept on this device. Pure apart from localStorage and
// the DOM sweep in `applyUnitText`; never imported by src/sim/*.
const KEY = 'coldgas.units';
const SYSTEMS = ['us', 'metric'];

let sys = 'us';
try { const v = localStorage.getItem(KEY); if (SYSTEMS.includes(v)) sys = v; } catch { /* private mode: US leads */ }
const subs = new Set();

// `sys` is the PRIMARY system; the other is always shown beside it.
export const getUnits = () => sys;
export const isMetric = () => sys === 'metric';
const other = (s) => (s === 'us' ? 'metric' : 'us');

export function setUnits(next, { persist = true } = {}) {
  if (!SYSTEMS.includes(next) || next === sys) return;
  sys = next;
  if (persist) { try { localStorage.setItem(KEY, sys); } catch { /* not kept: still swaps */ } }
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.unitSys = sys;
    // A short swap on every unit-bearing readout (CSS: .u-flip; reduced motion turns it off).
    root.classList.remove('u-flip'); void root.offsetWidth; root.classList.add('u-flip');
    clearTimeout(setUnits.t); setUnits.t = setTimeout(() => root.classList.remove('u-flip'), 420);
    applyUnitText();
  }
  for (const fn of subs) { try { fn(sys); } catch (e) { console.error(e); } }
}
export const toggleUnits = () => setUnits(other(sys));
// Subscribe to a swap; returns the unsubscribe.
export function onUnits(fn) { subs.add(fn); return () => subs.delete(fn); }
if (typeof document !== 'undefined') document.documentElement.dataset.unitSys = sys;

// --- Factors (SI → shown) -------------------------------------------------------------------------
export const MPS_TO_MPH = 2.2369362920544, MPS_TO_KMH = 3.6;
export const M_TO_FT = 3.280839895, M_TO_MI = 1 / 1609.344, KG_TO_LB = 2.2046226218;
export const N_TO_LBF = 0.2248089431, KGF_TO_LBF = 2.2046226218, BAR_TO_PSI = 14.503773773, KW_TO_HP = 1.3410220896;

// Each quantity in each system: [factor from SI, unit].
const Q = {
  speed: { us: [MPS_TO_MPH, 'mph'], metric: [MPS_TO_KMH, 'km/h'] },
  rate: { us: [M_TO_FT, 'ft/s'], metric: [1, 'm/s'] },
  len: { us: [M_TO_FT, 'ft'], metric: [1, 'm'] },
  mass: { us: [KG_TO_LB, 'lb'], metric: [1, 'kg'] },
  kgf: { us: [KGF_TO_LBF, 'lbf'], metric: [1, 'kgf'] },
  press: { us: [BAR_TO_PSI, 'psi'], metric: [1, 'bar'] },
  dist: { us: [M_TO_MI, 'mi'], metric: [0.001, 'km'] },
  force: { us: [N_TO_LBF, 'lbf'], metric: [0.001, 'kN'] },
};
// Factor and unit for a quantity: the primary system, or the secondary with `alt`.
export const k = (q, alt = false) => Q[q][alt ? other(sys) : sys][0];
export const u = (q, alt = false) => Q[q][alt ? other(sys) : sys][1];
// The old single-system names, kept for the live readouts (primary).
export const speedK = () => k('speed'), speedUnit = () => u('speed');
export const lenK = () => k('len'), lenUnit = () => u('len');
export const rateK = () => k('rate'), rateUnit = () => u('rate');
export const massK = () => k('mass'), massUnit = () => u('mass');
export const kgfK = () => k('kgf'), kgfUnit = () => u('kgf');
export const pressK = () => k('press'), pressUnit = () => u('press');
export const distK = () => k('dist'), distUnit = () => u('dist');

const num = (n, d = 0) => (Math.abs(n) >= 1000 && d === 0 ? Math.round(n).toLocaleString('en-US') : n.toFixed(d));
// One value in one system: "87 mph". `d` is decimals, or { us, metric }.
export function one(q, si, d = 0, s = sys) {
  const [f, unit] = Q[q][s], dd = typeof d === 'object' ? d[s] : d;
  return `${num(si * f, dd)} ${unit}`;
}
// Both, primary first: "87 mph · 140 km/h".
export const both = (q, si, d = 0) => `${one(q, si, d, sys)} · ${one(q, si, d, other(sys))}`;
// The secondary alone, for a sub-line under a big primary.
export const alt = (q, si, d = 0) => one(q, si, d, other(sys));

// --- Formatters: both systems, primary first --------------------------------------------------------
const LEN_D = { us: 0, metric: 1 };
export const fmtSpeed = (mps, d = 0) => both('speed', mps, d);
export const fmtLen = (m, d = LEN_D) => both('len', m, d);
export const fmtHeight = fmtLen;
export const fmtRate = (mps, d = 1) => both('rate', mps, d);
export const fmtDist = (m, d = 1) => both('dist', m, d);
export const fmtMass = (kg, d = 0) => both('mass', kg, d);
export const fmtForce = (n, d = { us: 0, metric: 1 }) => both('force', n, d);
export const fmtKgf = (kgf, d = 0) => both('kgf', kgf, d);
export const fmtPressure = (bar, d = 0) => both('press', bar, d);
export const fmtSmall = (m) => (sys === 'us' ? `${(m * 39.37007874).toFixed(1)} in · ${Math.round(m * 1000)} mm` : `${Math.round(m * 1000)} mm · ${(m * 39.37007874).toFixed(1)} in`);
// A distance on the road: feet under a tenth of a mile (metres under a kilometre), else mi | km.
const road1 = (m, s) => (s === 'us'
  ? (m < 160.9344 ? `${Math.round(m * M_TO_FT)} ft` : `${(m * M_TO_MI).toFixed(m < 16093 ? 2 : 1)} mi`)
  : (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`));
export const fmtRoad = (m) => `${road1(m, sys)} · ${road1(m, other(sys))}`;
export const fmtRoad1 = (m, secondary = false) => road1(m, secondary ? other(sys) : sys);

// --- Prose: "27.7 m up the wall" → "91 ft (27.7 m) up the wall" ---------------------------------------
// The coach, the drills, the judges' words (local lines and the AI's, written in SI by the Worker),
// cues, quest briefs and the share text are prose with numbers in them. `toUS` rewrites every
// "<number> <SI unit>" it finds; `localize` puts both side by side, the primary first, and with
// `html` the secondary goes in a dimmer <span class="u2">.
const NUM = String.raw`([+−-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?`;
const UNIT = String.raw`(km\/h|m\/s²|m\/s|kgf|kg|kN|kW|km|cm|mm|bar|metres|metre|meters|meter|m)`;
const RX = () => new RegExp(String.raw`(?<![\w.,])${NUM}(\s?| )${UNIT}(?![\w²/])`, 'g');
const CONV = {
  'km/h': [1 / 1.609344, 'mph'], 'm/s': [M_TO_FT, 'ft/s'], 'm/s²': [M_TO_FT, 'ft/s²'], kg: [KG_TO_LB, 'lb'], kgf: [KGF_TO_LBF, 'lbf'],
  kN: [1000 * N_TO_LBF, 'lbf'], kW: [KW_TO_HP, 'hp'], km: [1 / 1.609344, 'mi'], cm: [1 / 2.54, 'in'], mm: [1 / 25.4, 'in'], bar: [BAR_TO_PSI, 'psi'],
  m: [M_TO_FT, 'ft'], metre: [M_TO_FT, 'feet'], metres: [M_TO_FT, 'feet'], meter: [M_TO_FT, 'feet'], meters: [M_TO_FT, 'feet'],
};
function usOf(sign, int, frac = '', sp, unit) {
  const c = CONV[unit];
  const v = Number(int.replace(/,/g, '') + frac) * c[0];
  const srcD = frac ? frac.length - 1 : 0;
  // Keep the source's precision, in the new unit's terms: a foot is a third of a metre, so a
  // one-decimal metre reads as whole feet from 10 ft up; big forces and masses round to whole.
  let d = srcD;
  if (unit === 'm' || unit.startsWith('met')) d = v >= 10 ? 0 : Math.min(1, srcD + 1);
  if (['kN', 'bar', 'kW', 'kg', 'kgf'].includes(unit)) d = v >= 100 ? 0 : srcD;
  if (unit === 'km' || unit === 'mm') d = Math.max(1, srcD);
  const s = (Math.abs(v) >= 1000 && d === 0) || (int.includes(',') && d === 0) ? Math.round(v).toLocaleString('en-US') : v.toFixed(d);
  return `${sign}${s}${sp}${c[1]}`;
}
export const toUS = (text) => String(text).replace(RX(), (all, sign, int, frac, sp, unit) => (CONV[unit] ? usOf(sign, int, frac, sp, unit) : all));
export function localize(text, { html = false } = {}) {
  return String(text).replace(RX(), (all, sign, int, frac, sp, unit) => {
    if (!CONV[unit]) return all;
    const us = usOf(sign, int, frac, sp, unit), si = all;
    const [p, s] = sys === 'us' ? [us, si] : [si, us];
    return html ? `${p}<span class="u2"> ${s}</span>` : `${p} (${s})`;
  });
}
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Bind an element to SI prose: it shows both systems (the secondary dimmer) and re-renders on
// every swap. The SI source rides on the element, so the sweep needs no registry. `html` says the
// source is already markup (a cue with <kbd>); otherwise it's escaped first.
export function unitText(el, text, { html = false } = {}) {
  if (!el) return;
  el.dataset.uSrc = text;
  if (html) el.dataset.uHtml = '1'; else delete el.dataset.uHtml;
  el.innerHTML = localize(html ? text : escHtml(text), { html: true });
}
// Unit labels: <span data-u="speed">mph</span> follows the primary; data-u-alt the secondary.
export function applyUnitText(root = document) {
  for (const el of root.querySelectorAll('[data-u]')) { const q = Q[el.dataset.u]; if (q) { const t = u(el.dataset.u, el.hasAttribute('data-u-2')); if (el.textContent !== t) el.textContent = t; } }
  for (const el of root.querySelectorAll('[data-u-src]')) {
    el.innerHTML = localize(el.dataset.uHtml ? el.dataset.uSrc : escHtml(el.dataset.uSrc), { html: true });
  }
}

// One delegated listener: anything marked [data-units] (a unit label, a readout that's all units)
// swaps the primary system on click/tap, or Enter when focused. `U` swaps it from the keyboard.
let wired = false;
export function wireUnitToggles() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-units]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    toggleUnits();
    if (e.detail > 0 && t.blur) t.blur();   // a tap leaves no focus behind: Space is the game's
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (e.code === 'KeyU' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) { toggleUnits(); return; }
    if (e.key === 'Enter' && e.target.closest?.('[data-units]')) { e.preventDefault(); e.stopPropagation(); toggleUnits(); }
  }, true);
  // First paint: static prose in the page (the title's spec, course cards) marked [data-u-src].
  applyUnitText();
}
