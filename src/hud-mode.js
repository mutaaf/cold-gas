// How much HUD this device shows (ticket 0061). 'compact' is one slim line of telemetry (speed or
// sink, altitude, G, N₂ on the Show; speed, elevation, grade on a road) docked at an edge away from
// the car and the thumbs, with the critical cues (the cue line, the descent's state and BRAKE line,
// the touchdown ring) always up; 'full' is every instrument. Phones and small tablets start compact,
// everything else full. One tap on the handle at the end of the telemetry (or I on a keyboard)
// switches, and the choice is kept on this device. CSS does the layout off :root[data-hud].
const KEY = 'coldgas_hud';
export const HUD_MODES = ['compact', 'full'];

// A touch screen whose short side is a phone's or a small tablet's (an 11" iPad in portrait is
// 820 px wide; a 13" one, 1024, keeps the full set).
export function defaultHudMode({ coarse = false, w = 0, h = 0 } = {}) {
  return coarse && Math.min(w, h) <= 900 ? 'compact' : 'full';
}

// Room for every instrument (0103): sideways, the full set needs 720 px between the edges (the stick, the
// band and the right thumb's slots side by side). A phone that narrow sideways (the folding phone closed
// and turned: 594 or 678 px, 0102) shows the compact line, and the handle that would open MORE is put away;
// the player's choice is kept and comes back on a screen with the room (unfolded, or upright).
export function fullFits({ coarse = false, w = 0, h = 0 } = {}) {
  return !(coarse && w > h && w < 720);
}
const fitsNow = () => fullFits({ coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, w: globalThis.innerWidth || 0, h: globalThis.innerHeight || 0 });
// What the HUD shows: the mode, unless the full set has no room here.
export const shownHudMode = () => (hudMode() === 'full' && !fitsNow() ? 'compact' : hudMode());

let mode = null;
const subs = new Set();

function stored() {
  try { const v = localStorage.getItem(KEY); return HUD_MODES.includes(v) ? v : null; } catch { return null; }
}

function deviceDefault() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return defaultHudMode({ coarse, w: globalThis.innerWidth || 0, h: globalThis.innerHeight || 0 });
}

export function hudMode() {
  if (mode) return mode;
  mode = stored() || deviceDefault();
  return mode;
}

// The screen changed shape (0075: a folding phone opened or closed, a window resized, a tablet's
// split view): the default follows the new shape, but only while the player hasn't chosen. A choice
// (one tap on the handle, or I) is kept on this device and a fold never flips it.
export function refitHudMode() {
  const next = stored() || deviceDefault();
  if (next !== hudMode()) setHudMode(next, { persist: false });
  else paint(next);   // the same choice, but the room for it may have changed (0103)
}

// Every handle says what a tap will do, and whether the full set is out.
function label(m) { return m === 'compact' ? 'Show all instruments (I)' : 'Show fewer instruments (I)'; }
function paint(m) {
  if (typeof document === 'undefined') return;
  const fits = fitsNow();
  document.documentElement.dataset.hud = m === 'full' && !fits ? 'compact' : m;
  document.documentElement.toggleAttribute('data-hud-tight', !fits);   // CSS puts the handle away
  for (const b of document.querySelectorAll('[data-hud-toggle]')) {
    b.setAttribute('aria-expanded', String(m === 'full'));
    b.setAttribute('aria-label', label(m));
  }
}

export function setHudMode(next, { persist = true } = {}) {
  if (!HUD_MODES.includes(next)) return;
  mode = next;
  if (persist) { try { localStorage.setItem(KEY, next); } catch { /* not kept: still switches */ } }
  paint(next);
  for (const fn of subs) { try { fn(next); } catch (e) { console.error(e); } }
}
export const toggleHudMode = () => setHudMode(hudMode() === 'compact' ? 'full' : 'compact');
export function onHudMode(fn) { subs.add(fn); return () => subs.delete(fn); }

// The handle's markup, for HUDs built after boot (Free Drive, the Sandbox): a hairline cell with its
// word over a chevron (CSS shows MORE ▾ or LESS ▴ from :root[data-hud]).
export function hudToggleHtml(extra = '') {
  const m = hudMode();
  return `<button type="button" class="h-handle${extra ? ` ${extra}` : ''}" data-hud-toggle aria-expanded="${m === 'full'}" aria-label="${label(m)}" title="Instruments (I)">`
    + '<span class="hh-w hh-more">More</span><span class="hh-w hh-less">Less</span>'
    + '<svg class="hh-chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.75 6 6.25l4.5-4.5" /></svg></button>';
}

// One delegated listener for every handle (the Show's, Free Drive's, the Sandbox's), and I.
let wired = false;
export function initHudMode() {
  if (typeof document === 'undefined') return;
  paint(hudMode());
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-hud-toggle]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    toggleHudMode();
    if (e.detail > 0) t.blur();   // a tap leaves no focus behind: Space is the game's
  }, true);
  // Settled, not per event: a fold swings through sizes no pose has (466×498 on the one we measured).
  let settle = 0;
  addEventListener('resize', () => { clearTimeout(settle); settle = setTimeout(refitHudMode, 200); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyI' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    toggleHudMode();
  });
}
