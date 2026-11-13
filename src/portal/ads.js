// src/ads.js for a portal build (scripts/portal-html.mjs swaps it in): the same object src/main.js already drives, with
// the portal's SDK behind it instead of Marquee. Nothing in main.js changes for it.
//
// - Gameplay events: every mode change reaches sync(); a run's countdown, the run and Free Drive or the Sandbox are
//   play, unless a pause sheet is up (watched here) or an ad is on. Everything else (the title, the results, a
//   replay, a pause) is a break: CrazyGames' gameplayStop "on every game break".
// - Loading events: loadingStart in boot.js, loadingStop once the title's 3D is ready (window.__coldgas.stage.ready).
// - The midgame ad: postrun(go) when a results sheet is left (Retry, Home), the same natural break Marquee uses: never
//   after the first run of a session, our own floor between two (the SDKs keep theirs), behind the player's own press,
//   and the UI is held (a blocker, go() waits) until the ad is over or failed. Never in a run.
// - Rewarded: off (src/portal/config.js REWARDED_REROLL: the reward would be the AI panel's words, and there is no
//   server here). rewardReady() is false, so the opt-in button never shows.
// - The portal's mute setting wins over the game's own sound toggle (src/audio.js setForcedMute).
import { postrunDue } from '../ads.js';
// The rest of src/ads.js's exports (its pure helpers and constants, which other modules read) as they are; only
// createAds is this module's own.
export * from '../ads.js';
import { setForcedMute } from '../audio.js';
import { portal } from './boot.js';
import { MIDGAME_GAP_MS, REWARDED_REROLL } from './config.js';

const PLAY_MODES = new Set(['countdown', 'live', 'drive']);
const PAUSE_SHEETS = ['[data-screen="pause"]', '[data-drive-pause]'];

export function createAds({ win = globalThis.window, doc = globalThis.document, now = () => Date.now(), mode = () => 'title', p = portal } = {}) {
  let runs = 0, lastAt = 0, busy = false, blocker = null;
  const paused = () => PAUSE_SHEETS.some((s) => { const el = doc?.querySelector?.(s); return !!el && !el.hidden; });
  function gameplay() {
    if (PLAY_MODES.has(mode()) && !paused() && !busy) p.gameplayStart(); else p.gameplayStop();
  }
  // A pause sheet opening or closing is a break starting or ending (no mode change happens for it).
  if (typeof win?.MutationObserver === 'function') {
    const mo = new win.MutationObserver(gameplay);
    const watch = () => { for (const s of PAUSE_SHEETS) { const el = doc.querySelector(s); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); } };
    if (doc?.readyState === 'loading') doc.addEventListener('DOMContentLoaded', watch, { once: true }); else watch();
  }
  // The game is loaded once the title's 3D is up.
  if (win) {
    let tries = 0;
    const iv = setInterval(() => {
      const ready = win.__coldgas?.stage?.ready;
      if (ready || ++tries > 600) { clearInterval(iv); Promise.resolve(ready).then(() => p.loadingStop(), () => p.loadingStop()); }
    }, 100);
  }
  p.onSettings((s) => setForcedMute(!!s.muteAudio));

  function hold(on) {
    if (on && !blocker && doc?.body) {
      blocker = doc.createElement('div');
      blocker.className = 'portal-busy';
      blocker.setAttribute('aria-busy', 'true');
      blocker.setAttribute('aria-label', 'Loading');
      blocker.appendChild(doc.createElement('i'));
      doc.body.appendChild(blocker);
    } else if (!on && blocker) { blocker.remove(); blocker = null; }
  }

  return {
    start() {},
    titleBanner() {},
    arm() { gameplay(); },
    sync() { gameplay(); },
    get config() { return null; },
    noteRun() { runs++; },
    /** Leaving a results sheet: the midgame ad if one is due, then go. With no ad, go() runs synchronously. */
    postrun(go, hooks = {}) {
      if (busy) return;
      if (!p.live || !postrunDue({ runs, lastAt, now: now(), gap: MIDGAME_GAP_MS })) { go(); return; }
      busy = true; lastAt = now();
      hold(true); gameplay();
      let done = false;
      const finish = () => { if (done) return; done = true; hold(false); busy = false; go(); };
      Promise.resolve().then(() => p.midgame(hooks)).then(finish, finish);
    },
    rewardReady() { return REWARDED_REROLL && p.live && !busy; },
    async reward(hooks = {}) {
      if (!REWARDED_REROLL || !p.live || busy) return false;
      busy = true; hold(true);
      try { return !!(await p.rewarded(hooks)); } catch { return false; } finally { hold(false); busy = false; }
    },
    onConfig(f) { try { f(null); } catch { /* a listener's fault */ } },
  };
}
