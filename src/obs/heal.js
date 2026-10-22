// Self-healing, in the page. The frame loop can't die (an exception is caught, recorded and, if it
// keeps happening, escalated), a lost WebGL context is restored and the stage rebuilt, a physics
// trap stops the run cleanly instead of freezing it, a broken backdrop is taken off the stage, and
// a lazy chunk that vanished in a deploy reloads the page once (only into a new build, and never
// into an offline page). Every step is recorded (obs.recovery) so the nerds panel, the ledger and
// the server digest see what happened.
//
//   const heal = installHeal({ stage, canvas, ui, S, toTitle, pause, closeNerds, activeWorld })
//   heal.frame(now, body)   run one frame's body under the guard, timed for obs.frame
//   heal.markStale(why)     a chunk failed mid-run: check the build at the next title
import { obs } from './index.js';
import { moduleOf } from './signature.js';
import { SCALES } from './ledger.js';
import { decideReload, entryOf } from './reload.js';
import { fetchWithDeadline } from '../net.js';

const RELOAD_KEY = 'coldgas_heal_reload';
const GIVE_UP_MS = 10_000;       // a lost context gets this long, counted while the page is visible
const PROBE_MS = 5000;           // the build probe's deadline

export function installHeal({ stage, canvas, ui, S, toTitle, pause = () => {}, closeNerds = () => {}, activeWorld = () => null }) {
  const toast = (msg, ms = 3200) => { try { ui.cue_(msg, ms); } catch { /* the HUD itself may be what broke */ } };
  const heal = { consecutive: 0, escalated: false, lastNow: -1, renMs: 0, stale: '', lastMode: S.mode, deciding: null };
  // The entry this page booted from (the built page: <script type="module" src=".../index-HASH.js">).
  let bootEntry = null;
  try { bootEntry = entryOf(document.querySelector('script[type="module"][src]')?.outerHTML) || null; } catch { /* no DOM */ }
  const lastReload = () => { try { return Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { return 0; } };

  // --- Reload: at most once per two minutes, and only when the origin answers ----------------------
  // A reload offline lands on the browser's "no internet" page and the game is gone, so first ask
  // our own index.html (no-store): no answer, no reload. For a missing chunk it must also name a
  // different entry than this page's (a deploy really happened; otherwise it was the network).
  async function probe() {
    try {
      const res = await fetchWithDeadline(import.meta.env?.BASE_URL ?? '/coldgas/', { ms: PROBE_MS, cache: 'no-store' });
      return { ok: res.ok, html: res.ok ? await res.text() : '' };
    } catch { return null; }
  }
  function decide(reason, { needNewBuild = false } = {}) {
    // Single flight: one probe at a time, whoever asks.
    heal.deciding ??= (async () => {
      const online = globalThis.navigator?.onLine !== false;
      const d = decideReload({ online, probe: online ? await probe() : null, current: bootEntry, needNewBuild, lastReload: lastReload(), now: Date.now() });
      if (!d.reload) {
        obs.recovery('reload', false, `${reason}: no reload (${d.why})`);
        if (d.why === 'reloaded recently') toast('Something keeps failing. Reload the page to start fresh.', 6000);
        return false;
      }
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
      obs.recovery('reload', true, `${reason} (${d.why})`);
      obs.flush('reload', { force: true });
      if (needNewBuild) toast('A new version of COLD GAS is out: reloading', 1600);
      setTimeout(() => location.reload(), 1200);
      return true;
    })().finally(() => { heal.deciding = null; });
    return heal.deciding;
  }
  const reloadOnce = (reason) => decide(reason);
  heal.reloadOnce = reloadOnce;
  heal.decide = decide;
  heal.markStale = (why) => { heal.stale = String(why || 'a chunk failed to load'); };

  // --- The renderer: timed, and skipped while the context is lost ----------------------------------
  const render = stage.render;
  stage.render = function (time, mode) {
    if (obs.glLost) { heal.renMs = 0; return; }
    const t = performance.now();
    try { render(time, mode); } finally { heal.renMs = performance.now() - t; }
  };
  obs.onScale = (k) => stage.setPixelScale?.(k);
  if (obs.scale > 0) stage.setPixelScale?.(SCALES[obs.scale]);

  // Shader compile/link failures: three calls this instead of logging.
  try {
    stage.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      let log = '';
      try { log = (gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || '').trim().split('\n')[0]; } catch { /* lost context */ }
      const err = new Error(`shader program failed: ${log || 'no log'}`);
      err.stack = '    at compile (shader:0:0)';
      obs.error('shader', err, 'shader');
      console.error('THREE.WebGLProgram: shader error', log);
    };
  } catch { /* no debug hook */ }

  // --- WebGL context loss ----------------------------------------------------------------------------
  let lostAt = 0, restoreTimer = 0, giveUpTimer = 0;
  // Held from boot: once the context is lost, getExtension() returns null (three's
  // forceContextRestore looks it up then, and so can't restore).
  let loseExt = null;
  try { loseExt = stage.renderer.getContext().getExtension('WEBGL_lose_context'); } catch { /* none */ }
  // The give-up clock runs only while the page is visible: a backgrounded tab (iOS drops the contexts
  // of hidden tabs) must not reload and lose the results it was showing.
  let giveUpLeft = 0, giveUpFrom = 0;
  const visible = () => globalThis.document?.visibilityState !== 'hidden';
  const armGiveUp = () => {
    clearTimeout(giveUpTimer); giveUpTimer = 0;
    if (!obs.glLost || !visible() || giveUpLeft <= 0) return;
    giveUpFrom = performance.now();
    giveUpTimer = setTimeout(() => { giveUpTimer = 0; giveUpLeft = 0; if (obs.glLost) reloadOnce('the WebGL context did not come back'); }, giveUpLeft);
  };
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (!obs.glLost) return;
    if (visible()) armGiveUp();
    else if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = 0; giveUpLeft = Math.max(0, giveUpLeft - (performance.now() - giveUpFrom)); }
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();   // ask the browser to give it back
    if (obs.glLost) return;
    lostAt = performance.now();
    obs.markCtxLost();
    const err = new Error('WebGL context lost'); err.stack = '    at contextlost (webgl:0:0)';
    obs.error('webgl', err, 'ctxlost');
    if (S.mode === 'live' || S.mode === 'countdown') pause(true);
    toast('Graphics reset by the browser: restoring…', 4000);
    // A real GPU reset comes back by itself; nudge it after 2 s, give up (reload) after 10 visible s.
    restoreTimer = setTimeout(() => { if (obs.glLost) { try { loseExt?.restoreContext(); } catch { /* not lost through the extension */ } } }, 2000);
    giveUpLeft = GIVE_UP_MS;
    armGiveUp();
  });
  // An outside look (a Free Drive road, the endless world, the Sandbox) baked its environment on the
  // GPU too: bake it again and hand it back to the stage.
  function rebakeLook() {
    const w = activeWorld?.();
    if (!w) return false;
    if (typeof w.setTod === 'function') { stage.setLook?.(w.setTod(w.tod)); return true; }
    if (typeof w.look?.rebake === 'function') { w.look.rebake(); stage.setLook?.(w.look); return true; }
    return false;
  }
  heal.rebakeLook = rebakeLook;
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(restoreTimer); clearTimeout(giveUpTimer); giveUpTimer = 0; giveUpLeft = 0;
    // three re-initialises its GL state on this same event (registered first); rebuild what lived
    // only on the GPU: the baked environments, the composer's targets, the size.
    let ok = true, look = false;
    try { stage.restoreGL?.(); } catch (err) { ok = false; obs.error('webgl', err); }
    try { look = rebakeLook(); } catch (err) { ok = false; obs.error('webgl', err); }
    obs.glLost = false;
    obs.recovery('webgl', ok, `context restored in ${Math.round(performance.now() - lostAt)} ms, renderer rebuilt${look ? ', look rebaked' : ''}`);
    toast(ok ? 'Graphics restored' : 'Graphics restored, with errors', 1800);
  });

  // --- Lazy chunks ---------------------------------------------------------------------------------
  // A chunk that failed: after a deploy the page is stale (its hashed chunks are gone), or the
  // network dropped it. On the title (nothing to lose) check now; mid-run, at the next title. Either
  // way the page reloads only if the origin answers with a different build.
  const staleCheck = (why) => decide(why, { needNewBuild: true });
  obs.on('lazy', () => {
    if (S.mode === 'title') staleCheck('a lazy chunk failed to load');
    else heal.markStale('a lazy chunk failed to load mid-run');
  });

  // --- The frame loop's guard ----------------------------------------------------------------------
  function physicsTrap(err) {
    obs.fail('physics', err, 'trap');
    try { toTitle(); } catch (e2) { obs.error('frame', e2, 'frame'); }
    if (obs.breaker('physics').state === 'open') {
      toast('The physics engine tripped twice: reloading it', 3000);
      reloadOnce('physics trapped twice').then((ok) => { if (!ok) obs.recovery('physics', false, 'run stopped; reload refused'); });
    } else {
      toast('The physics engine tripped and the run was stopped. Fly again when you’re ready.', 4200);
      obs.recovery('physics', true, 'run stopped, back to the title');
    }
  }
  function frameError(err) {
    heal.consecutive++;
    if ((S.mode === 'live' || S.mode === 'countdown') && obs.isTrap(err)) { heal.consecutive = 0; return physicsTrap(err); }
    const mod = moduleOf(err?.stack);
    if (mod === 'rocket' && stage.rocket) {
      obs.fail('rocket', err);
      try { stage.rocket.group.visible = false; stage.rocket.group.parent?.remove(stage.rocket.group); } catch { /* best effort */ }
      stage.rocket = null;
      obs.recovery('rocket', true, 'backdrop removed from the stage; retried next session');
      heal.consecutive = 0;
      return;
    }
    if (mod === 'nerds') { try { closeNerds(); } catch { /* best effort */ } obs.recovery('nerds', true, 'panel closed'); }
    obs.error(mod === 'app' ? 'frame' : mod, err, 'frame');
    if (heal.consecutive === 1) console.error(err);
    // A second of frames failing in a row in a run: back to the title. Ten seconds of it: reload.
    if (heal.consecutive === 60 && S.mode !== 'title') {
      try { toTitle(); obs.recovery('frame', true, `${S.mode} kept failing: back to the title`); } catch { obs.recovery('frame', false, 'title failed too'); }
      toast('Something went wrong. Back to the title.', 3200);
    }
    if (heal.consecutive === 600) reloadOnce('the frame loop kept failing');
  }

  heal.frame = (now, body) => {
    const dtMs = heal.lastNow < 0 ? 16.7 : now - heal.lastNow;
    heal.lastNow = now;
    // Back on the title with a stale mark: the safe moment to check the build.
    if (S.mode !== heal.lastMode) {
      if (S.mode === 'title' && heal.stale) { const why = heal.stale; heal.stale = ''; staleCheck(why); }
      heal.lastMode = S.mode;
    }
    const t0 = performance.now();
    heal.renMs = 0;
    try { body(now); if (heal.consecutive) heal.consecutive = 0; } catch (err) { frameError(err); }
    const work = performance.now() - t0;
    const live = S.mode === 'live' && !S.paused;
    // The sim clock keeps at most 100 ms a frame (main.js): the rest is dropped ticks (240 Hz).
    obs.frame(now, dtMs, live ? S.simMs || 0 : 0, heal.renMs, work, live && dtMs > 100 && dtMs < 1000 ? (dtMs - 100) * 0.24 : 0);
  };

  // Retry later: the physics breaker belongs to this page's WASM instance, not to the device.
  obs.breaker('physics').reset();
  return heal;
}
