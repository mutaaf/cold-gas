// What the HUD audit flies and how the gate splits it (0087): the viewports, and a shard plan by
// estimated cost, so no CI job runs past its timeout while another idles (every M-th viewport put both
// 1080×1920 and 1280×720 with the title audit in one shard: 45 minutes, cancelled).
//
//   planShards(viewports, M) → M lists of items, each a viewport [w, h, safe] or 'title'
//
// Cost model: seconds on a CI runner (ubuntu-latest, SwiftShader), both HUD states, fitted on the
// per-viewport seconds of this PR's own CI run (0087; each report's `seconds`): 28 s a viewport (20, and
// about 8 more since 0092 opens and measures the pause sheet once per viewport) + 145 s
// per CSS megapixel (software GL fills every pixel) + 110 s per megapixel more with Free Drive (a third
// page, the road and its terrain: 1920×1080 is the dearest viewport, ≈ 600 s) + 85 s on a touch screen
// (the Lineup hop, a 2–3× pixel ratio). Within 0.8–1.4× of every viewport; most of what is left is the
// runner (the same viewport ran up to 1.5× slower on one runner than another). The title audit is one
// item (≈ 460 s there). Longest first, each to the least-loaded shard (LPT): deterministic.
export const PHONES = [[390, 844], [430, 932], [844, 390], [932, 430], [320, 568], [814, 380], [393, 659]];
export const TABLETS = [[768, 1024], [1024, 768], [820, 1180], [1180, 820], [1024, 1366], [1366, 1024]];
// The book-style folding phone (0103), as Safari gives a page, measured on the simulated device (Device Hub,
// docs/backlog/0102): in a tab closed upright 382×580, closed sideways 594×368 one way and 678×384 the other,
// open 669×871 and 951×589, and the 466×498 a fold passes through; installed (0081, standalone) open 669×930
// and 951×648, closed 466×657 (with an 84 px side inset) and sideways 678×445. Each flies with its own
// measured safe-area insets (FOLD_INSETS) at 3×, the device's ratio.
export const FOLD = [[382, 580], [594, 368], [678, 384], [669, 871], [951, 589], [466, 498], [669, 930], [951, 648], [466, 657], [678, 445]];
export const FOLD_INSETS = {
  '594x368': { l: 84 }, '678x384': { b: 34 }, '669x871': { t: 2, b: 34 }, '951x589': { t: 2, b: 34 }, '466x498': { r: 84 },
  '669x930': { t: 61, b: 34 }, '951x648': { t: 2, b: 34 }, '466x657': { r: 84 }, '678x445': { l: 84, b: 34 },
};
// A flip phone (0104), in Chrome: the tall inner screen upright (360×748: 1080 px across at 3×, less Chrome's
// bars) and sideways (800×300: less the URL bar and the status bar), and the near-square cover screen when
// the browser runs there (360×380, a Flip's; 424×360, a razr's). Estimates: no primary source gives Chrome's
// CSS viewport on any of them (docs/backlog/0102); each is the cramped end of its range. 3×.
export const FLIP = [[360, 748], [800, 300], [360, 380], [424, 360]];
export const DESKTOPS = [[1280, 720], [1920, 1080], [720, 1280], [1080, 1920]];
export const SAFE = [[390, 844, 1], [430, 932, 1], [844, 390, 1], [932, 430, 1], [814, 380, 1]];
// Free Drive is flown at these (phones, iPads and the two desktop sizes), and since 0110/0112 at the cramped screens
// of the fold and the flip (the fold closed and turned in a tab and installed, closed upright installed; the flip's
// two cover screens and its tall screen turned).
export const DRIVE = ['390x844', '844x390', '1280x720', '1920x1080', '768x1024', '820x1180', '1180x820', '844x390s',
  '594x368', '678x445', '466x657', '360x380', '424x360', '800x300'];

const parse = (v) => { const m = v.match(/^(\d+)x(\d+)(s?)$/); return [Number(m[1]), Number(m[2]), m[3] ? 1 : 0]; };
export function viewportsFor(set) {
  return set === 'phones' ? PHONES : set === 'tablets' ? TABLETS : set === 'fold' ? FOLD : set === 'flip' ? FLIP : set === 'safe' ? SAFE
    : set === 'quick' ? [[390, 844], [844, 390], [1280, 720]] : /^\d+x\d+/.test(set) ? set.split(',').map(parse) : [...PHONES, ...TABLETS, ...FOLD, ...FLIP, ...DESKTOPS, ...SAFE];
}
export const vpBase = ([w, h, safe]) => `${w}x${h}${safe ? 's' : ''}`;
export const touchFor = (w, h) => [...PHONES, ...TABLETS, ...FOLD, ...FLIP].some(([a, b]) => a === w && b === h);
// The device pixel ratio a viewport flies at: the fold's measured 3, else 2.
export const dprFor = (w, h) => ([...FOLD, ...FLIP].some(([a, b]) => a === w && b === h) ? 3 : 2);
// The --safe-* insets forced on a viewport: a notched phone's on the safe-area pass (`s`: 47 px on the notch
// side in landscape, as iOS reports both sides, 34 px home indicator upright, 21 px sideways), a fold pose's
// measured ones, else none (null).
export function insetsFor(w, h, safe = 0) {
  if (safe) return w > h ? { t: 0, l: 47, r: 47, b: 21 } : { t: 47, l: 0, r: 0, b: 34 };
  const m = FOLD_INSETS[`${w}x${h}`];
  return m ? { t: 0, l: 0, r: 0, b: 0, ...m } : null;
}
export const insetCss = (w, h, safe = 0) => {
  const i = insetsFor(w, h, safe);
  return i && `:root { --safe-t: ${i.t}px !important; --safe-l: ${i.l}px !important; --safe-r: ${i.r}px !important; --safe-b: ${i.b}px !important; }`;
};

export const TITLE_COST = 640;   // 460 s for 23 viewports on CI; 29 since 0103, 33 since 0104
export function cost(item) {
  if (item === 'title') return TITLE_COST;
  const [w, h, safe] = item;
  const mpx = (w * h) / 1e6;
  return 28 + 145 * mpx + (DRIVE.includes(vpBase(item)) ? 110 * mpx : 0) + (safe || touchFor(w, h) ? 85 : 0);
}

export function planShards(viewports, M, { title = true } = {}) {
  const items = [...viewports.map((v, i) => ({ v, i, c: cost(v) })), ...(title ? [{ v: 'title', i: viewports.length, c: cost('title') }] : [])];
  items.sort((a, b) => b.c - a.c || a.i - b.i);
  const shards = Array.from({ length: M }, () => ({ load: 0, items: [] }));
  for (const it of items) {
    let k = 0;
    for (let j = 1; j < M; j++) if (shards[j].load < shards[k].load) k = j;
    shards[k].load += it.c;
    shards[k].items.push(it);
  }
  // Each shard flies its viewports in the listed order (the title audit last).
  return shards.map((s) => s.items.sort((a, b) => a.i - b.i).map((it) => it.v));
}
export const planLoad = (items) => items.reduce((a, v) => a + cost(v), 0);

// How much of the scene the HUD covers (0112), measured in the page (serialised into it: no closures). Painted HUD chrome
// (a background with alpha ≥ 0.08, a backdrop filter, a visible border, an SVG/canvas/img, a line of text's glyph boxes)
// is unioned on a 4 px grid: `any` (cover), `solid` (a background ≥ 0.5: hides the scene outright), `tint` (a gradient
// shade alone: darkens it). scripts/hud-cover.mjs reports it per size; scripts/hud-audit.mjs gates `any` (coverCeiling).
export const COVER_ROOTS = '[data-screen="hud"], [data-touch], [data-cue], .top, [data-drill-bar], [data-drive-hud], [data-onethumb], .bq-dock, .fd-ai';
export function measureCover(ROOTS) {
  const W = innerWidth, H = innerHeight, C = 4, cols = Math.ceil(W / C), rows = Math.ceil(H / C);
  const any = new Uint8Array(cols * rows), solid = new Uint8Array(cols * rows), tint = new Uint8Array(cols * rows);
  const alpha = (c) => { const m = c.match(/[\d.]+/g); if (!m) return 0; return c.startsWith('rgba') ? Number(m[3]) : 1; };
  const shown = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || e.hidden) return false; } return true; };
  const opac = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const paint = (r, grid) => {
    const x0 = Math.max(0, Math.floor(r.left / C)), x1 = Math.min(cols, Math.ceil(r.right / C)), y0 = Math.max(0, Math.floor(r.top / C)), y1 = Math.min(rows, Math.ceil(r.bottom / C));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * cols + x] = 1;
  };
  const who = new Map();
  const seen = new Set();
  for (const root of document.querySelectorAll(ROOTS)) for (const el of [root, ...root.querySelectorAll('*')]) {
    if (seen.has(el)) continue; seen.add(el);
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el), op = opac(el);
    const bg = alpha(cs.backgroundColor) * op, img = cs.backgroundImage !== 'none';
    const bd = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && alpha(cs[`border${s}Color`]) * op > 0.08);
    const blur = cs.backdropFilter && cs.backdropFilter !== 'none';
    const media = el instanceof SVGSVGElement || el.tagName === 'CANVAS' || el.tagName === 'IMG';
    const key = el.dataset.hudBox || (el.className?.baseVal ?? el.className);
    // A gradient alone (the scrims behind the HUD's band) darkens the scene rather than hiding it: tint.
    if (img && !(bg >= 0.08 || bd || blur || media)) paint(r, tint);
    else if (bg >= 0.08 || bd || blur || media) {
      paint(r, any); if (bg >= 0.5) paint(r, solid);
      who.set(String(key).split(' ')[0] || el.tagName, (who.get(String(key).split(' ')[0] || el.tagName) || 0) + Math.round(r.width * r.height));
    }
    // A shade drawn as a pseudo-element (Free Drive's ::before / ::after): its box from its computed edges.
    for (const ps of ['::before', '::after']) {
      const pc = getComputedStyle(el, ps);
      if (pc.content === 'none' || pc.display === 'none' || pc.position !== 'absolute' || pc.backgroundImage === 'none') continue;
      const h = parseFloat(pc.height), t = pc.top === 'auto' ? r.height - parseFloat(pc.bottom) - h : parseFloat(pc.top);
      paint({ left: r.left, right: r.right, top: r.top + t, bottom: r.top + t + h }, tint);
    }
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim() && op > 0.05) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const tr of rg.getClientRects()) paint(tr, any);
    }
  }
  return { any, solid, tint, cols, rows, C, W, H, who: [...who].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(100 * v / (W * H))}%`) };
}


// The ceiling the audit holds every touch frame of a run to (0112): the HUD may cover at most this share of the glass.
// Measured after 0112 (scripts/hud-cover.mjs): ≤ 30 % on a phone, a fold or an iPad; a flip's cover screen (under
// 160 000 px², 360×380 and 424×360) has the same controls on a quarter of the glass, so it is held to 45 %.
export const coverCeiling = (w, h) => (w * h < 160000 ? 0.45 : 0.3);
