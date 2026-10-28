// The graphics tier a device boots with before its own history (src/obs/ledger.js) moves it.
// Pure: everything it reads is passed in, so tests/unit/gfx-tier.test.js can play any device.
//
// One look everywhere (0097): a phone or a tablet boots 'high' like a desktop, so it draws the same
// scene: the same shadows (2048), film look (atmosphere, height fog, lamp halos, vignette), the wet
// slab's reflection, the plume mist and the geometry detail, at the same pixel-ratio cap (2). What a
// device can't afford is taken from its pixels first: the resolution governor steps the drawing
// buffer down in-session, and the ledger boots a slow device at a lower resolution; only a device
// still slow at the resolution floor drops a tier (src/obs/ledger.js chooseBoot).
// Core counts are not a signal: Safari caps `hardwareConcurrency` (an iPhone or iPad reports 4 or
// fewer) and has no `deviceMemory`. Only a device that reports very little memory (Android's
// `deviceMemory` ≤ 2 GB) starts 'low', the floor.

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
  if (!isIOS({ ua, maxTouchPoints }) && deviceMemory && deviceMemory <= 2) return { tier: 'low', reason: `touch device with ${deviceMemory} GB` };
  return { tier: 'high', reason: `${isIOS({ ua, maxTouchPoints }) ? 'iOS ' : ''}touch device: the desktop look, resolution governed` };
}

// The edge filter after the OutputPass on the composer tiers → 'smaa' | 'fxaa': the one thing besides
// the pixel count a touch device draws differently from a desktop. 0037 gave phones FXAA because SMAA
// raised their flicker; 0097 re-measured it on the high look (flicker.mjs --phone --gl=swiftshader, same
// machine, main vs each filter): SMAA still raised 14 regions over main (show-wide wall 29 → 50 ‰,
// drive-road other 4 → 25 ‰), FXAA lowered most of them (show-wide car 96 → 37 ‰). So touch keeps FXAA.
export const AA_TOUCH = 'fxaa';
export function pickAA({ tier = 'high', touch = false } = {}) {
  if (tier !== 'high') return 'fxaa';
  return touch ? AA_TOUCH : 'smaa';
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
