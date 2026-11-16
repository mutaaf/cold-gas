// The verdict behind scripts/prod-hosts.mjs (0262): which hosts a production page may reach, and when.
// AGENTS.md §3.3: our own origin (mutaafaziz.com: the game, /coldgas/api, Marquee's /ads/, Box Office's
// /boxoffice/), plus Google's ad hosts, and those only from a Marquee /ads/ frame or from the /ads/ loader's own
// scripts. Nothing else, ever (Cloudflare's Web Analytics beacon included: the operator's call on 0155). And no
// third party at all while a run is on (`countdown` or `live`), except a request an /ads/ frame started as the game
// removed it at the Jump (its unload), within UNLOAD_GRACE_MS of the title → countdown change.
//
// Pure: no browser, no network. An entry is
//   { t, url, frames: [request's frame url, its parent's, …, the top page], initiators: [script urls], mode }
// with `t` in ms and `mode` the page's S.mode when the request started (modeAt below).

export const OWN_HOSTS = ['mutaafaziz.com'];
export const AD_HOST_SUFFIXES = ['googlesyndication.com', 'doubleclick.net', 'adtrafficquality.google'];
export const UNLOAD_GRACE_MS = 500;
const RUN_MODES = new Set(['countdown', 'live']);

const parse = (u) => { try { return new URL(u); } catch { return null; } };
export const hostOf = (u) => parse(u)?.hostname || '';

// Not a network request (a data: image, a blob: worker, an about:blank frame): nothing leaves the device.
export const isLocal = (u) => !/^(https?|wss?):/i.test(u || '');

export const isOwn = (u, own = OWN_HOSTS) => own.includes(hostOf(u));

// Google's ad hosts as §3.3 lists them: *.googlesyndication.com, *.doubleclick.net, *.adtrafficquality.google, and
// www.google.com only under /recaptcha (the ad's own bot check).
export function isGoogleAd(u) {
  const p = parse(u); if (!p) return false;
  const h = p.hostname;
  if (AD_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))) return true;
  return h === 'www.google.com' && (p.pathname === '/recaptcha' || p.pathname.startsWith('/recaptcha/'));
}

// A Marquee URL on our own origin: the slot frame (/ads/v1/frame.html) or the loader (/ads/v1/ads.js).
export const isAds = (u, own = OWN_HOSTS) => { const p = parse(u); return !!p && own.includes(p.hostname) && p.pathname.startsWith('/ads/'); };

// Did Marquee start it? Its frame is the request's frame or an ancestor, or an /ads/ script is on its initiator stack.
export const inAdsFrame = (e, own = OWN_HOSTS) => (e.frames || []).some((f) => isAds(f, own));
export const viaAds = (e, own = OWN_HOSTS) => inAdsFrame(e, own) || (e.initiators || []).some((s) => isAds(s, own));

// The scripts that started a request, from the CDP events seen for its URL ({ doc, urls }, doc = the requesting
// document). The one from the request's own document wins; with none, only what every event agrees on, so a URL
// that Marquee's frame and the game's page both request never lends the page Marquee's initiators.
export function pickInitiators(seen, doc) {
  if (!seen?.length) return [];
  const mine = seen.find((x) => x.doc && x.doc === doc);
  if (mine) return mine.urls;
  return seen.map((x) => x.urls).reduce((a, b) => a.filter((u) => b.includes(u)));
}

// The mode at time t from a timeline of [t, mode] changes (sorted). Before the first change: undefined.
export function modeAt(timeline, t) {
  let m;
  for (const [at, mode] of timeline) { if (at > t) break; m = mode; }
  return m;
}

// When the run that contains t started, and from which mode: the last change into countdown|live at or before t.
export function runStartBefore(timeline, t) {
  let start = null, prev;
  for (const [at, mode] of timeline) {
    if (at > t) break;
    if (RUN_MODES.has(mode) && !RUN_MODES.has(prev)) start = { at, from: prev };
    prev = mode;
  }
  return start;
}

// Did the recording see a whole run (title → countdown → live → results)? Without it the run check would pass
// on nothing, so the probe exits 2 instead.
export function sawRun(timeline) {
  const want = ['countdown', 'live', 'results']; let i = 0;
  for (const [, mode] of timeline || []) if (mode === want[i]) i++;
  return i === want.length;
}

// Did the title place Marquee's slot frame? Without it the title's check saw nothing Marquee does (a slow loader
// can miss a 60 s title on a phone), so the probe calls the screen inconclusive (exit 2), not clean.
export const framePlaced = (entries, own = OWN_HOSTS) =>
  entries.some((e) => e.mode === 'title' && isAds(e.url, own) && parse(e.url).pathname.endsWith('/frame.html'));

// One entry's verdict: null when allowed, else the reason.
export function judge(e, { own = OWN_HOSTS, timeline = null } = {}) {
  if (isLocal(e.url) || isOwn(e.url, own)) return null;
  const ads = viaAds(e, own);
  if (!(isGoogleAd(e.url) && ads)) {
    return isGoogleAd(e.url) ? `Google ad host outside a Marquee /ads/ frame or loader` : `host ${hostOf(e.url)} is not allowed (§3.3)`;
  }
  if (!RUN_MODES.has(e.mode)) return null;
  // The one allowed request in a run: the title's /ads/ frame's own unload, started as the Jump removed it. Not a
  // Retry from the results (the interstitial's place), and not a request the in-page loader made.
  const start = timeline ? runStartBefore(timeline, e.t) : null;
  if (start && start.from === 'title' && inAdsFrame(e, own) && e.t - start.at <= UNLOAD_GRACE_MS) return null;
  return `third party during the run (${e.mode})`;
}

// The whole log: { ok, bad: [{ e, why }] }.
export function verdict(entries, opts = {}) {
  const bad = [];
  for (const e of entries) { const why = judge(e, opts); if (why) bad.push({ e, why }); }
  return { ok: bad.length === 0, bad };
}

// One line a person can read: t (s), host, the request's frame, mode, and the verdict.
export function line(e, why = null) {
  const frame = (e.frames || [])[0] || '';
  const fp = parse(frame);
  const f = !frame ? '(new frame)' : fp ? `${fp.hostname}${fp.pathname}` : frame;
  const t = Number.isFinite(e.t) ? (e.t / 1000).toFixed(2).padStart(7) : '      ?';
  return `${t}s  ${(hostOf(e.url) || e.url.slice(0, 30)).padEnd(32)} ${f.padEnd(44)} ${String(e.mode ?? '-').padEnd(9)} ${why ? `FAIL ${why}` : 'ok'}`;
}
