// What the HUD audit flies and how the gate splits it (0083): the viewports, and a shard plan by
// estimated cost, so no CI job runs past its timeout while another idles (every M-th viewport put both
// 1080×1920 and 1280×720 with the title audit in one shard: 45 minutes, cancelled).
//
//   planShards(viewports, M) → M lists of items, each a viewport [w, h, safe] or 'title'
//
// Cost model: seconds on a CI runner (ubuntu-latest, SwiftShader), both HUD states, fitted on the first
// CI run (0083): 90 s a viewport (two page loads, the theatre, the wreck) + 155 s per CSS megapixel
// (software GL fills every pixel) + 50 s with Free Drive (a third page, the road) + 15 s on a touch
// screen (the Lineup hop). It predicted every viewport within 0.8–1.3×. The title audit is one item
// (23 viewports at ≈ 40 s: two page loads' worth each on software GL). Longest first, each to the
// least-loaded shard (LPT): deterministic, and every shard within a few percent of the mean estimate.
export const PHONES = [[390, 844], [430, 932], [844, 390], [932, 430], [320, 568], [814, 380], [393, 659]];
export const TABLETS = [[768, 1024], [1024, 768], [820, 1180], [1180, 820], [1024, 1366], [1366, 1024]];
export const FOLD = [[382, 580], [678, 340], [669, 825], [951, 543], [466, 498]];
export const DESKTOPS = [[1280, 720], [1920, 1080], [720, 1280], [1080, 1920]];
export const SAFE = [[390, 844, 1], [430, 932, 1], [844, 390, 1], [932, 430, 1], [814, 380, 1]];
// Free Drive is flown at these (phones, iPads and the two desktop sizes).
export const DRIVE = ['390x844', '844x390', '1280x720', '1920x1080', '768x1024', '820x1180', '1180x820', '844x390s'];

const parse = (v) => { const m = v.match(/^(\d+)x(\d+)(s?)$/); return [Number(m[1]), Number(m[2]), m[3] ? 1 : 0]; };
export function viewportsFor(set) {
  return set === 'phones' ? PHONES : set === 'tablets' ? TABLETS : set === 'fold' ? FOLD : set === 'safe' ? SAFE
    : set === 'quick' ? [[390, 844], [844, 390], [1280, 720]] : /^\d+x\d+/.test(set) ? set.split(',').map(parse) : [...PHONES, ...TABLETS, ...FOLD, ...DESKTOPS, ...SAFE];
}
export const vpBase = ([w, h, safe]) => `${w}x${h}${safe ? 's' : ''}`;
export const touchFor = (w, h) => [...PHONES, ...TABLETS, ...FOLD].some(([a, b]) => a === w && b === h);

export const TITLE_COST = 920;
export function cost(item) {
  if (item === 'title') return TITLE_COST;
  const [w, h, safe] = item;
  return 90 + 155 * (w * h) / 1e6 + (DRIVE.includes(vpBase(item)) ? 50 : 0) + (safe || touchFor(w, h) ? 15 : 0);
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
