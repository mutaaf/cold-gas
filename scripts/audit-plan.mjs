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
// Free Drive is flown at these (phones, iPads and the two desktop sizes).
export const DRIVE = ['390x844', '844x390', '1280x720', '1920x1080', '768x1024', '820x1180', '1180x820', '844x390s'];

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
