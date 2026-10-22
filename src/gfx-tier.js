// The graphics tier a device boots with before its own history (src/obs/ledger.js) moves it.
// Pure: everything it reads is passed in, so tests/unit/gfx-tier.test.js can play any device.
//
// A fine pointer (a desktop or laptop) boots 'high'. A touch device boots 'mid': bloom, FXAA and
// 1.5× resolution, and the resolution governor steps it down in-session if it can't keep up.
// Core counts are not a signal: Safari caps `hardwareConcurrency` (an iPhone or iPad reports 4 or
// fewer) and has no `deviceMemory`, so the old "≤ 4 cores → low" test sent every iOS device to
// 'low' (DPR 1 on a 3× screen, no AA, no bloom). Only a device that reports very little memory
// (Android's `deviceMemory` ≤ 2 GB) starts 'low'.

// 'phone' | 'tablet' | 'desktop'. iPadOS reports a Mac UA but has touch points; Android tablets
// leave "Mobile" out of the UA; any other coarse pointer on a screen ≥ 600 CSS px short side is
// a tablet too.
export function deviceKind({ ua = '', maxTouchPoints = 0, coarse = false, screenW = 0, screenH = 0 } = {}) {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'tablet';
  if (/iPhone|iPod/.test(ua)) return 'phone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
  if (!coarse) return 'desktop';
  return Math.min(screenW || 0, screenH || 0) >= 600 ? 'tablet' : 'phone';
}

export const isIOS = ({ ua = '', maxTouchPoints = 0 } = {}) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

// → { tier: 'low' | 'mid' | 'high', reason }
export function pickDeviceTier({ coarse = false, ua = '', maxTouchPoints = 0, deviceMemory } = {}) {
  const touch = coarse || isIOS({ ua, maxTouchPoints });
  if (!touch) return { tier: 'high', reason: 'fine pointer' };
  if (isIOS({ ua, maxTouchPoints })) return { tier: 'mid', reason: 'iOS touch device' };
  if (deviceMemory && deviceMemory <= 2) return { tier: 'low', reason: `touch device with ${deviceMemory} GB` };
  return { tier: 'mid', reason: 'touch device' };
}

// The browser's own readings, for the two functions above.
export function readDevice(nav = globalThis.navigator, win = globalThis) {
  return {
    ua: nav?.userAgent || '', maxTouchPoints: nav?.maxTouchPoints || 0, deviceMemory: nav?.deviceMemory,
    coarse: !!win?.matchMedia?.('(pointer: coarse)').matches,
    screenW: win?.screen?.width || 0, screenH: win?.screen?.height || 0,
  };
}
