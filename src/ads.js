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

/** Is the loader worth fetching here? Not on a local preview or a test server (unless asked for). */
export function wantLoader(loc) {
  return /[?&]marquee=/.test(loc.search || '') || !['localhost', '127.0.0.1', ''].includes(loc.hostname || '');
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

export function createAds({ win = globalThis.window, doc = globalThis.document, now = () => Date.now() } = {}) {
  let cfg = null, runs = 0, lastAt = 0, busy = false;
  const api = () => (win?.marquee?.v ? win.marquee : null);   // the real loader, not the {q:[]} stub
  const listeners = [];
  function config(c) { cfg = c; for (const f of listeners) { try { f(c); } catch { /* a listener's fault */ } } }

  function start() {
    if (!win || !doc) return;
    if (api()) { api().ready().then(config, () => {}); return; }
    if (!wantLoader(win.location || {})) return;
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
  /** The title's banner: placed only once the slot can fill, so an empty slot changes no layout. */
  function titleBanner(parent) {
    const place = (c) => {
      if (!canFill(c, 'title') || !parent || parent.querySelector('[data-marquee]')) return;
      const el = doc.createElement('div');
      el.className = 'ad-banner';
      el.dataset.marquee = 'title';
      el.dataset.marqueeContext = 'menu';
      parent.appendChild(el);
    };
    if (cfg) place(cfg); else listeners.push(place);
  }
  return {
    start,
    titleBanner,
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
