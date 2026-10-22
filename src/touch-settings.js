// Touch settings on this device: the control scheme (one-thumb Assist or classic), the hand,
// tilt steering and haptics. Stored in localStorage, read once, changed from the Controls sheet.
//
// Tilt steering (off by default): DeviceOrientation, with the permission prompt iOS requires (it
// must come from a tap), calibrated to however the phone is held. ±20° of tilt is full lock, with
// a 3° dead zone, in 5 % steps so the input log stays small (src/sim/run.js quantises to 1 %).
// Haptics: navigator.vibrate where it exists (Android Chrome); a no-op elsewhere.
const KEY = 'coldgas_touch';
const DEFAULTS = { scheme: 'thumb', hand: 'right', tilt: false, haptics: true };
export const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage blocked */ }
if (!['thumb', 'classic'].includes(settings.scheme)) settings.scheme = DEFAULTS.scheme;
const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
  for (const fn of listeners) fn(settings);
}

// --- Haptics --------------------------------------------------------------------------------
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const hasHaptics = () => canVibrate;
const PATTERNS = { tap: 8, release: 22, warn: [28, 60, 28], crash: [70, 40, 90], phase: 10 };
export function buzz(kind, ms) {
  if (!canVibrate || !settings.haptics) return;
  try { navigator.vibrate(ms ?? PATTERNS[kind] ?? 10); } catch { /* not allowed (no user gesture yet) */ }
}

// --- Tilt -------------------------------------------------------------------------------------
const TILT_FULL = 20, TILT_DEAD = 3;
const tilt = { raw: 0, zero: 0, value: 0, listening: false, seen: false, needZero: true };
// The roll of the phone about the screen's vertical axis, whichever way up it is held.
function screenRoll(e) {
  const a = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
  if (a === 90) return e.beta ?? 0;
  if (a === -90 || a === 270) return -(e.beta ?? 0);
  return e.gamma ?? 0;
}
function onOrient(e) {
  if (e.beta == null && e.gamma == null) return;
  tilt.seen = true;
  tilt.raw = screenRoll(e);
  if (tilt.needZero) { tilt.zero = tilt.raw; tilt.needZero = false; }   // the first reading is straight ahead
  let d = tilt.raw - tilt.zero;
  d = Math.abs(d) < TILT_DEAD ? 0 : d - Math.sign(d) * TILT_DEAD;
  tilt.value = Math.round(Math.max(-1, Math.min(1, d / (TILT_FULL - TILT_DEAD))) * 20) / 20;
}
function listen(on) {
  if (on === tilt.listening) return;
  tilt.listening = on;
  if (on) { tilt.needZero = true; addEventListener('deviceorientation', onOrient); }
  else { removeEventListener('deviceorientation', onOrient); tilt.value = 0; }
}
// Turn tilt on from a tap: asks iOS for motion access first. Resolves to true when it's on.
export async function enableTilt() {
  const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === 'function') {
    let answer;
    try { answer = await DOE.requestPermission(); } catch { return false; }
    // Refused: iOS won't ask again, so the setting says Off rather than On-but-dead.
    if (answer !== 'granted') { if (answer === 'denied' && settings.tilt) setSetting('tilt', false); return false; }
  }
  listen(true);
  setSetting('tilt', true);
  return true;
}
export function disableTilt() { listen(false); setSetting('tilt', false); }
export function calibrateTilt() { tilt.zero = tilt.raw; tilt.value = 0; tilt.needZero = !tilt.seen; }
export const tiltSeen = () => tilt.seen;
// The steer to add this tick (0 when tilt is off).
export const tiltSteer = () => (settings.tilt && tilt.listening ? tilt.value : 0);
// A saved "on" still needs the listener (Android needs no prompt; iOS asks again on the next tap).
if (settings.tilt && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') listen(true);
// On iOS a saved "on" isn't granted after a reload: the permission prompt must come from a tap, so the
// next Jump (or Retry) asks. requestPermission is called inside the click, before any await.
export const tiltNeedsGrant = () => !!settings.tilt && !tilt.listening;
export function armTiltGrant(doc = typeof document !== 'undefined' ? document : null) {
  doc?.addEventListener('click', (e) => {
    if (tiltNeedsGrant() && e.target?.closest?.('[data-start], [data-again], [data-drill-again], [data-drill-retry]')) enableTilt();
  }, true);
}
// Turning the phone round changes which axis is roll and where level is: zero again on the next reading.
function rezero() { tilt.needZero = true; tilt.value = 0; }
if (typeof screen !== 'undefined' && screen.orientation?.addEventListener) screen.orientation.addEventListener('change', rezero);
else if (typeof addEventListener === 'function') addEventListener('orientationchange', rezero);
