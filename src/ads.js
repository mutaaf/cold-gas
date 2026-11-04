// Marquee ads (owner's decision, 2026-10-30; AGENTS.md §3.3). Ads live only between runs, never in one:
// - `title`  banner on the title (menu), in Marquee's removable frame (0122),
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
/** The title's slot, as Marquee's removable same-origin frame (0122, owner's decision on #194): the frame holds the loader
 *  and one [data-marquee] slot, so whatever AdSense starts for it lives in the frame's document, and removing the frame
 *  on leaving the title stops all of it (requests, timers, scripts). Root-absolute: Marquee is its own Worker at /ads. */
export const TITLE_FRAME_SRC = '/ads/v1/frame.html?app=coldgas&slot=title';
/** Screens with no room for the title's banner (styles.css hides .ad-banner at the same query): no frame is placed
 *  there at all, so nothing asks for an ad nobody would see. */
export const TITLE_SKIP_MQ = '(max-height: 620px), (max-width: 360px)';
/** The frame's height, from the frame's own report ({marqueeFrame, h}), held to the in-page slot's 90 px cap. */
export function frameHeight(data, slot = 'title') {
  if (!data || typeof data !== 'object' || data.marqueeFrame !== slot) return null;
  const h = Math.round(Number(data.h));
  return Number.isFinite(h) ? Math.max(0, Math.min(90, h)) : null;
}
/** Does the frame's document hold a drawn ad (0142)? Marquee's banner() puts AdSense's <ins> in the slot, which Google marks
 *  data-ad-status="filled" | "unfilled" (unfilled falls back to a direct sponsor's <img>/<video>), so a reserved but empty
 *  unit reads as not filled. Same-origin, so the page can read it; any error (a cross-origin or torn-down document) is "no". */
export const FILLED_SEL = '[data-marquee] ins.adsbygoogle[data-ad-status="filled"], [data-marquee] img, [data-marquee] video';
export function frameFilled(doc) {
  try { return !!doc?.querySelector?.(FILLED_SEL); } catch { return false; }
}
/** The event the title's fit (src/comeback.js) sends on the title when a shown banner would cost the Daily its room: the ad
 *  is the first thing to step aside (0142). */
export const NO_ROOM_EVENT = 'coldgas:ad-no-room';
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
  // The title's banner exists only while the title shows (0117). Once the slot can fill (an empty slot changes no
  // layout) and the title has stayed up TITLE_DWELL_MS, so a quick Jump asks for nothing, it goes in as Marquee's
  // frame (TITLE_FRAME_SRC). The moment the title goes, the frame is removed, filled or not (0122): its document is
  // torn down with every request AdSense has started, so nothing of the title's ad reaches the countdown or the run.
  // The next title gets a fresh frame after its own dwell. The frame starts 0 px high (see 0142 below for when it
  // grows). Postrun and reroll stay in the page.
  // 0142: the frame takes no room and paints nothing until its document holds a drawn ad: a reserved, unfilled or
  // undrawn unit moves no title element, and the frame's own canvas (opaque white when the OS is light, as the frame
  // page says `light dark`) is never seen. `data-filled` gates the margin and the visibility (styles.css); the height is
  // the frame's last report while filled, else 0. Its document is watched for Google's verdict, which may change no size.
  // And when the title's fit finds no room for a shown banner (NO_ROOM_EVENT), the frame goes for the rest of this title.
  let dwell = 0, onFrameMsg = null, frameMo = null, reportedH = 0, noRoom = false;
  const frameDoc = () => { try { return titleEl?.contentDocument || null; } catch { return null; } };
  function applyFill() {
    if (!titleEl) return;
    const filled = frameFilled(frameDoc());
    if (filled) titleEl.dataset.filled = ''; else delete titleEl.dataset.filled;
    if (titleEl.style) titleEl.style.height = `${filled ? reportedH : 0}px`;
  }
  function watchFrame() {
    frameMo?.disconnect(); frameMo = null;
    const d = frameDoc();
    if (d?.documentElement && typeof win.MutationObserver === 'function') {
      frameMo = new win.MutationObserver(applyFill);
      frameMo.observe(d.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ad-status', 'hidden'] });
    }
    applyFill();
  }
  function drop() {
    if (titleEl) { titleEl.remove(); titleEl = null; }
    frameMo?.disconnect(); frameMo = null;
    if (onFrameMsg) { win.removeEventListener?.('message', onFrameMsg); onFrameMsg = null; }
    reportedH = 0;
  }
  const onNoRoom = () => { if (titleEl) { noRoom = true; drop(); } };
  function place() {
    dwell = 0;
    if (!titleParent || noRoom || mode() !== 'title' || !canFill(cfg, 'title') || titleEl || titleParent.querySelector('[data-marquee-frame]')) return;
    if (win.matchMedia?.(TITLE_SKIP_MQ)?.matches) return;   // short or narrow: no banner (the next title looks again)
    const el = doc.createElement('iframe');
    el.className = 'ad-banner';
    el.dataset.marqueeFrame = 'title';
    el.title = 'Advertisement';
    el.setAttribute?.('scrolling', 'no');
    if (el.style) el.style.height = '0px';
    el.src = TITLE_FRAME_SRC;
    onFrameMsg = (e) => {
      if (!titleEl || e.source !== titleEl.contentWindow || (win.location?.origin && e.origin !== win.location.origin)) return;
      const h = frameHeight(e.data);
      if (h !== null) { reportedH = h; applyFill(); }
    };
    win.addEventListener?.('message', onFrameMsg);
    el.addEventListener?.('load', () => { if (el === titleEl) watchFrame(); });
    titleParent.appendChild(el);
    titleEl = el;
  }
  function syncTitle() {
    if (!titleParent) return;
    if (mode() === 'title') {
      if (!titleEl && !dwell && !noRoom && canFill(cfg, 'title')) dwell = setTimeout(place, TITLE_DWELL_MS);
      return;
    }
    noRoom = false;   // the next title looks again
    if (dwell) { clearTimeout(dwell); dwell = 0; }
    drop();
  }
  /** The title's banner, wanted in this parent (placed and removed by the mode, see syncTitle). */
  function titleBanner(parent) {
    if (titleParent !== (parent || null)) {
      titleParent?.removeEventListener?.(NO_ROOM_EVENT, onNoRoom);
      parent?.addEventListener?.(NO_ROOM_EVENT, onNoRoom);
    }
    titleParent = parent || null; syncTitle();
  }
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
