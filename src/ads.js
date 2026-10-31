// Marquee ads (owner's decision, 2026-10-30; AGENTS.md §3.3). Ads live only between runs, never in one:
// - `title`  banner on the title (menu),
// - `postrun` interstitial when the player leaves a results sheet (Retry / Home), after the judges have
//   spoken: never the first run of the session, at most one per POSTRUN_GAP_MS (the loader caps it too),
// - `reroll` rewarded, opt-in only: "Watch an ad · ask the panel again" re-runs the judges' words (the
//   score is scoreRun's and never changes).
// The loader is same-origin (/ads/v1/ads.js, the Marquee Worker beside ours on mutaafaziz.com). It is
// fetched only on the production host (a local preview has no /ads and would report a failed script),
// or with ?marquee= in the URL. Every call resolves at once when nothing fills: no ad ever holds the game.
export const SLOTS = 'title:banner:menu,postrun:interstitial:menu,reroll:rewarded:menu';
export const POSTRUN_GAP_MS = 180_000;
// The title's banner is asked for only after the title has stayed up this long (0117). Marquee starts AdSense
// (≈ 430 KB of script, then the ad request) the moment a slot is placed, and nothing can call that download
// back: a player who presses Jump within a few seconds must never start it, or it finishes in the run.
export const TITLE_DWELL_MS = 4000;

/** Is the loader worth fetching here? Not on a local preview or a test server (unless asked for). */
export function wantLoader(loc) {
  return /[?&]marquee=/.test(loc.search || '') || !['localhost', '127.0.0.1', ''].includes(loc.hostname || '');
}
/** May the loader be injected, or the title's banner be asked for, in this mode? Only between runs (0117):
 *  the title and the results. Never the countdown, a run, a drill, a replay or Free Drive. */
export function mayStartAds(mode) {
  return mode === 'title' || mode === 'results';
}
/** A slot that can fill, read from a resolved config: config.slots[id].source is 'none' when nothing can. */
export function canFill(cfg, id) {
  const s = cfg && cfg.enabled ? cfg.slots?.[id] : null;
  return !!s && s.source !== 'none';
}
/** The between-runs interstitial: not after the first run, and not again within the gap. */
export function postrunDue({ runs, lastAt, now, gap = POSTRUN_GAP_MS }) {
  return runs >= 2 && (!lastAt || now - lastAt >= gap);
}

export function createAds({ win = globalThis.window, doc = globalThis.document, now = () => Date.now(), mode = () => 'title' } = {}) {
  let cfg = null, runs = 0, lastAt = 0, busy = false, started = false, armed = false, titleParent = null, titleEl = null;
  const api = () => (win?.marquee?.v ? win.marquee : null);   // the real loader, not the {q:[]} stub
  // Read from the boot URL: the title rewrites the address (?course=), which drops a ?marquee= asked for.
  const wanted = !!win && wantLoader(win.location || {});
  const listeners = [];
  function config(c) { cfg = c; for (const f of listeners) { try { f(c); } catch { /* a listener's fault */ } } syncTitle(); }

  // Injects the loader once, and only between runs (0117): the loader's own work and the network it starts
  // (the config, then AdSense for a banner) must never land in a countdown or a run.
  function start() {
    if (started || !win || !doc || !mayStartAds(mode())) return;
    started = true;
    if (api()) { api().ready().then(config, () => {}); return; }
    if (!wanted) return;
    const m = win.marquee || (win.marquee = { q: [] });
    m.q = m.q || [];
    m.q.push((a) => a.ready().then(config, () => {}));
    const s = doc.createElement('script');
    s.async = true;
    s.src = '/ads/v1/ads.js';   // root-absolute on purpose: Marquee is its own Worker at mutaafaziz.com/ads
    s.dataset.app = 'coldgas';
    s.dataset.slots = SLOTS;
    doc.head.appendChild(s);
  }
  // The title's banner exists only while the title shows (0117). It is placed once the slot can fill (an empty
  // slot changes no layout) and the title has stayed up TITLE_DWELL_MS, so a quick Jump never starts the AdSense
  // pipeline. Leaving the title takes out a slot that hasn't finished filling (a pipeline still in flight then
  // finds no slot to ask an ad for) and a fresh one is placed on the next title; a filled slot stays, hidden with
  // the title, so coming back doesn't ask for another ad.
  let dwell = 0;
  const settled = (el) => !!(el.hidden || el.querySelector?.('ins[data-ad-status], img, video, iframe'));
  function place() {
    dwell = 0;
    if (!titleParent || mode() !== 'title' || !canFill(cfg, 'title') || titleEl || titleParent.querySelector('[data-marquee]')) return;
    const el = doc.createElement('div');
    el.className = 'ad-banner';
    el.dataset.marquee = 'title';
    el.dataset.marqueeContext = 'menu';
    titleParent.appendChild(el);
    titleEl = el;
  }
  function syncTitle() {
    if (!titleParent) return;
    if (mode() === 'title') {
      if (!titleEl && !dwell && canFill(cfg, 'title')) dwell = setTimeout(place, TITLE_DWELL_MS);
      return;
    }
    if (dwell) { clearTimeout(dwell); dwell = 0; }
    if (titleEl && !settled(titleEl)) { titleEl.remove(); titleEl = null; }
  }
  /** The title's banner, wanted in this parent (placed and removed by the mode, see syncTitle). */
  function titleBanner(parent) { titleParent = parent || null; syncTitle(); }
  /** After boot: from now on every mode change may start the loader or move the banner. */
  function arm(parent) { armed = true; titleBanner(parent); sync(); }
  /** Call on every mode change. Before arm() it does nothing (the first load's critical path stays clear). */
  function sync() {
    if (!armed) return;
    start();
    syncTitle();
  }
  return {
    start,
    titleBanner,
    arm,
    sync,
    get config() { return cfg; },
    /** A run of the player's own reached its results (counts toward "skip the first"). */
    noteRun() { runs++; },
    /** Leaving a results sheet: show the interstitial if due, then go. With no ad, go() runs synchronously. */
    postrun(go, hooks = {}) {
      if (busy) return;
      const m = api();
      if (!m || !canFill(cfg, 'postrun') || !postrunDue({ runs, lastAt, now: now() })) { go(); return; }
      busy = true;
      lastAt = now();
      let done = false;
      const finish = () => { if (done) return; done = true; busy = false; go(); };
      Promise.resolve().then(() => m.interstitial('postrun', { beforeAd: hooks.beforeAd, afterAd: hooks.afterAd })).then(finish, finish);
    },
    /** Should the opt-in "watch an ad" button show? Only when the rewarded slot can fill. */
    rewardReady() { return !!api() && canFill(cfg, 'reroll'); },
    /** Opt-in rewarded break. Resolves true only when the reward was earned; never rejects. */
    async reward(hooks = {}) {
      const m = api();
      if (!m || busy || !canFill(cfg, 'reroll')) return false;
      busy = true;
      try { return !!(await m.rewarded('reroll', { beforeAd: hooks.beforeAd, afterAd: hooks.afterAd })); } catch { return false; } finally { busy = false; }
    },
    onConfig(f) { if (cfg) f(cfg); else listeners.push(f); },
  };
}
