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

// A software rasterizer (SwiftShader, llvmpipe, WARP: no usable GPU, a blocklisted driver, CI)
// draws every pixel on the CPU, where canvas MSAA costs about a third of the frame rate (the Show
// on SwiftShader: 9.7 fps without it, 6.2 with). 'low' skips MSAA there.
export const isSoftwareRenderer = (renderer = '') => /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);

// The renderer's name from a throwaway context. Firefox names it in RENDERER (and warns about the
// debug extension); Chromium and WebKit answer "WebKit WebGL" there and name it in the extension.
export function probeRenderer(doc = globalThis.document, ua = globalThis.navigator?.userAgent || '') {
  try {
    const gl = doc.createElement('canvas').getContext('webgl2') || doc.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = /Firefox\//.test(ua) ? null : gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}
