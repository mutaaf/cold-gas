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

let mode = null;
const subs = new Set();

function stored() {
  try { const v = localStorage.getItem(KEY); return HUD_MODES.includes(v) ? v : null; } catch { return null; }
}

export function hudMode() {
  if (mode) return mode;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  mode = stored() || defaultHudMode({ coarse, w: globalThis.innerWidth || 0, h: globalThis.innerHeight || 0 });
  return mode;
}

// Every handle says what a tap will do, and whether the full set is out.
function label(m) { return m === 'compact' ? 'Show all instruments (I)' : 'Show fewer instruments (I)'; }
function paint(m) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.hud = m;
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
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyI' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    toggleHudMode();
  });
}
