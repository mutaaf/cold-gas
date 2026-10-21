// Self-healing, in the page. The frame loop can't die (an exception is caught, recorded and, if it
// keeps happening, escalated), a lost WebGL context is restored and the stage rebuilt, a physics
// trap stops the run cleanly instead of freezing it, a broken backdrop is taken off the stage, and
// a lazy chunk that vanished in a deploy reloads the page once. Every step is recorded
// (obs.recovery) so the nerds panel, the ledger and the server digest see what happened.
//
//   const heal = installHeal({ stage, canvas, ui, S, toTitle, pause, closeNerds })
//   heal.frame(now, body)   run one frame's body under the guard, timed for obs.frame
import { obs } from './index.js';
import { moduleOf } from './signature.js';
import { SCALES } from './ledger.js';

const RELOAD_KEY = 'coldgas_heal_reload';
const RELOAD_GAP_MS = 120_000;   // never reload more than once in two minutes (no reload loops)

export function installHeal({ stage, canvas, ui, S, toTitle, pause = () => {}, closeNerds = () => {} }) {
  const toast = (msg, ms = 3200) => { try { ui.cue_(msg, ms); } catch { /* the HUD itself may be what broke */ } };
  const heal = { consecutive: 0, escalated: false, lastNow: -1, renMs: 0 };

  // --- Reload, at most once per two minutes -----------------------------------------------------
  function reloadOnce(reason) {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last < RELOAD_GAP_MS) {
      obs.recovery('reload', false, `${reason} (already reloaded recently)`);
      toast('Something keeps failing. Reload the page to start fresh.', 6000);
      return false;
    }
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
    obs.recovery('reload', true, reason);
    obs.flush('reload', { force: true });
    setTimeout(() => location.reload(), 1200);
    return true;
  }
  heal.reloadOnce = reloadOnce;

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
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();   // ask the browser to give it back
    if (obs.glLost) return;
    lostAt = performance.now();
    obs.markCtxLost();
    const err = new Error('WebGL context lost'); err.stack = '    at contextlost (webgl:0:0)';
    obs.error('webgl', err, 'ctxlost');
    if (S.mode === 'live' || S.mode === 'countdown') pause(true);
    toast('Graphics reset by the browser: restoring…', 4000);
    // A real GPU reset comes back by itself; nudge it after 2 s, give up (reload) after 10 s.
    restoreTimer = setTimeout(() => { if (obs.glLost) { try { loseExt?.restoreContext(); } catch { /* not lost through the extension */ } } }, 2000);
    giveUpTimer = setTimeout(() => { if (obs.glLost) reloadOnce('the WebGL context did not come back'); }, 10_000);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(restoreTimer); clearTimeout(giveUpTimer);
    // three re-initialises its GL state on this same event (registered first); rebuild what lived
    // only on the GPU: the baked environments, the composer's targets, the size.
    let ok = true;
    try { stage.restoreGL?.(); } catch (err) { ok = false; obs.error('webgl', err); }
    obs.glLost = false;
    obs.recovery('webgl', ok, `context restored in ${Math.round(performance.now() - lostAt)} ms, renderer rebuilt`);
    toast(ok ? 'Graphics restored' : 'Graphics restored, with errors', 1800);
  });

  // --- Lazy chunks ---------------------------------------------------------------------------------
  // A chunk that 404s after a deploy: the page is stale. On the title (nothing to lose), reload once.
  obs.on('lazy', () => { if (S.mode === 'title') reloadOnce('a lazy chunk failed to load (stale page after a deploy?)'); });

  // --- The frame loop's guard ----------------------------------------------------------------------
  function physicsTrap(err) {
    obs.fail('physics', err, 'trap');
    try { toTitle(); } catch (e2) { obs.error('frame', e2, 'frame'); }
    if (obs.breaker('physics').state === 'open') {
      toast('The physics engine tripped twice: reloading it', 3000);
      if (!reloadOnce('physics trapped twice')) obs.recovery('physics', false, 'run stopped; reload refused');
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
