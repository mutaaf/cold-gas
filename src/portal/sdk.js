// The portal adapter: one surface over the CrazyGames SDK v3 and the GameDistribution HTML5 SDK, so the game never
// names either. Every call is safe without an SDK (an ad blocker, a slow network, the wrong domain): it does nothing,
// an ad resolves at once with no ad, a reward resolves false. Nothing here ever throws into the game.
//
//   const p = createPortal('crazygames' | 'gamedistribution' | 'none', { win, doc, gameId })
//   await p.init()                       loads and starts the SDK (never rejects; p.live says if it's up)
//   p.loadingStart() / p.loadingStop()   CrazyGames' loading events (once each)
//   p.gameplayStart() / p.gameplayStop() only on a change (CrazyGames: start on play, stop on every break)
//   await p.midgame(hooks)               a between-runs video ad; hooks.beforeAd when it really starts (pause + mute),
//                                        hooks.afterAd when it's over (always, if beforeAd ran)
//   await p.rewarded(hooks) → boolean    true only when the ad was watched to the end
//   p.deviceType()                       'desktop' | 'tablet' | 'mobile' | null (CrazyGames' system info)
//   p.settings() / p.onSettings(fn)      { muteAudio } (CrazyGames' settings, which win over the game's own)
//   p.data                               CrazyGames' data module (getItem/setItem/removeItem), or null
//
// Sources: docs.crazygames.com/sdk (intro, game, video-ads, data, user) and github.com/GameDistribution/GD-HTML5/wiki
// (SDK-Implementation, Rewarded-Ads), read 2026-11-13.
import { GD_GAME_ID, GD_GAME_ID_PLACEHOLDER, SDK_WAIT_MS } from './config.js';

export const CG_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
export const GD_SDK_URL = 'https://html5.api.gamedistribution.com/main.min.js';
export const GD_SCRIPT_ID = 'gamedistribution-jssdk';

/** Adds a <script> once; resolves true when it loaded, false on an error (blocked) or after `ms`. */
export function loadScript(doc, src, { id = '', ms = SDK_WAIT_MS } = {}) {
  return new Promise((done) => {
    if (!doc?.createElement) { done(false); return; }
    if (id && doc.getElementById?.(id)) { done(true); return; }
    const s = doc.createElement('script');
    if (id) s.id = id;
    s.async = true;
    s.src = src;
    const t = setTimeout(() => done(false), ms);
    s.onload = () => { clearTimeout(t); done(true); };
    s.onerror = () => { clearTimeout(t); done(false); };
    (doc.head || doc.documentElement).appendChild(s);
  });
}

const safe = (f) => { try { return f(); } catch { return undefined; } };
const withDeadline = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

export function createPortal(kind, { win = globalThis.window, doc = globalThis.document, gameId = GD_GAME_ID, ms = SDK_WAIT_MS, load = loadScript } = {}) {
  let live = false, loading = 0, playing = null;   // loading: 0 never, 1 started, 2 stopped
  let settings = { muteAudio: false };
  const settingsFns = new Set();
  const emitSettings = () => { for (const f of settingsFns) safe(() => f(settings)); };

  // --- CrazyGames ---------------------------------------------------------------------------------------------
  const cg = () => (live ? win?.CrazyGames?.SDK : null);
  async function initCG() {
    if (!(await load(doc, CG_SDK_URL, { ms }))) return;
    const sdk = win?.CrazyGames?.SDK;
    if (!sdk?.init) return;
    try { await withDeadline(Promise.resolve(sdk.init()), ms, null); } catch { return; }
    // 'disabled' (any other domain): every call throws. 'local' (localhost) and 'crazygames' work.
    if (sdk.environment === 'disabled') return;
    live = true;
    const read = () => { settings = { muteAudio: !!safe(() => sdk.game.settings?.muteAudio) }; emitSettings(); };
    read();
    safe(() => sdk.game.addSettingsChangeListener(read));
  }
  function cgAd(type, hooks) {
    const sdk = cg();
    if (!sdk?.ad?.requestAd) return Promise.resolve(false);
    return new Promise((done) => {
      let started = false, settled = false;
      const end = (ok) => {
        if (settled) return;
        settled = true;
        if (started) safe(() => hooks.afterAd?.());   // unmute and resume, only if it had muted
        done(ok);
      };
      try {
        sdk.ad.requestAd(type, {
          adStarted: () => { started = true; safe(() => hooks.beforeAd?.()); },   // mute when it really plays
          adFinished: () => end(true),
          adError: () => end(false),   // unfilled, adblock, adCooldown, adsDisabled (Basic Launch), other
        });
      } catch { end(false); }
    });
  }

  // --- GameDistribution --------------------------------------------------------------------------------------------
  let gdHooks = null, gdPaused = false, gdRewardDone = false, gdReady = null;
  const gd = () => (live ? win?.gdsdk : null);
  async function initGD() {
    if (!gameId || gameId === GD_GAME_ID_PLACEHOLDER) return;   // no id pasted yet (src/portal/config.js): no ads
    let ready;
    gdReady = new Promise((r) => { ready = r; });
    win.GD_OPTIONS = {
      gameId,
      advertisementSettings: { autoplay: false },
      onEvent(event) {
        switch (event?.name) {
          case 'SDK_READY': ready(true); break;
          case 'SDK_ERROR': ready(false); break;
          case 'SDK_GAME_PAUSE': gdPaused = true; safe(() => gdHooks?.beforeAd?.()); break;   // pause AND mute
          case 'SDK_GAME_START': if (gdPaused) { gdPaused = false; safe(() => gdHooks?.afterAd?.()); } break;
          case 'SDK_REWARDED_WATCH_COMPLETE': gdRewardDone = true; break;
          default: break;
        }
      },
    };
    if (!(await load(doc, GD_SDK_URL, { id: GD_SCRIPT_ID, ms }))) return;
    // Ready when it says so; a script that loaded but never said anything still gets its showAd checked per call.
    await withDeadline(gdReady, ms, false);
    live = typeof win.gdsdk !== 'undefined' && typeof win.gdsdk?.showAd === 'function';
  }
  async function gdAd(type, hooks) {
    const sdk = gd();
    if (!sdk) return false;
    gdHooks = hooks; gdRewardDone = false;
    let ok = false;
    try { await (type === 'rewarded' ? sdk.showAd('rewarded') : sdk.showAd()); ok = type === 'rewarded' ? gdRewardDone : true; } catch { ok = false; }
    if (gdPaused) { gdPaused = false; safe(() => hooks.afterAd?.()); }   // the SDK never said START: resume anyway
    gdHooks = null;
    return ok;
  }

  return {
    kind,
    get live() { return live; },
    async init() {
      try {
        if (kind === 'crazygames') await initCG();
        else if (kind === 'gamedistribution') await initGD();
      } catch { live = false; }
      return live;
    },
    loadingStart() { if (loading) return; loading = 1; safe(() => cg()?.game.loadingStart()); },
    loadingStop() { if (loading === 2) return; loading = 2; safe(() => cg()?.game.loadingStop()); },
    gameplayStart() { if (playing === true) return; playing = true; safe(() => cg()?.game.gameplayStart()); },
    gameplayStop() { if (playing !== true) return; playing = false; safe(() => cg()?.game.gameplayStop()); },
    get playing() { return playing === true; },
    async midgame(hooks = {}) {
      if (kind === 'crazygames') await cgAd('midgame', hooks);
      else if (kind === 'gamedistribution') await gdAd('midgame', hooks);
    },
    async rewarded(hooks = {}) {
      if (kind === 'crazygames') return cgAd('rewarded', hooks);
      if (kind === 'gamedistribution') return gdAd('rewarded', hooks);
      return false;
    },
    deviceType() {
      const t = safe(() => cg()?.user?.systemInfo?.device?.type);
      return t === 'desktop' || t === 'tablet' || t === 'mobile' ? t : null;
    },
    settings: () => settings,
    onSettings(f) { settingsFns.add(f); safe(() => f(settings)); return () => settingsFns.delete(f); },
    get data() { const d = cg()?.data; return d && typeof d.getItem === 'function' && typeof d.setItem === 'function' ? d : null; },
  };
}
