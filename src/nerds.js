// For nerds: everything the game computes, live. A lazy chunk, opened with ` (backquote) or the
// { } button. It only reads: the sim's state, the engine's counters, the renderer's counters and
// the last judging's receipt, so opening it can't change a run (determinism holds; the server
// would replay the same bits). While it is open it counts the engine's work by wrapping Rapier's
// World.step and castRayAndGetNormal; closing it puts them back.
//
//   openNerds(root, ctx)   ctx() → { mode, car, run, renderer, course, tier, simMs, simTicks, meta, driveStats() }
//   closeNerds()
import { REVISION } from 'three';
import { RAPIER, physicsMemoryBytes, physicsReady } from './sim/engine.js';
import { SIM_VERSION } from './sim/run.js';
import { SPEC, NOZZLE_SPEC } from './sim/spec.js';

const G = 9.81;
const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'];
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const big = (v) => (!Number.isFinite(v) ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString('en-US'));

// --- Engine counters (installed only while the panel is open) ------------------------------------
const cnt = { steps: 0, stepMs: 0, rays: 0, rayMs: 0 };
let patched = null;
function patch() {
  if (patched || !physicsReady() || !RAPIER?.World) return;
  const P = RAPIER.World.prototype, step = P.step, ray = P.castRayAndGetNormal;
  P.step = function (...a) { const t = performance.now(); const r = step.apply(this, a); cnt.stepMs += performance.now() - t; cnt.steps++; return r; };
  P.castRayAndGetNormal = function (...a) { const t = performance.now(); const r = ray.apply(this, a); cnt.rayMs += performance.now() - t; cnt.rays++; return r; };
  patched = { P, step, ray };
}
function unpatch() {
  if (!patched) return;
  patched.P.step = patched.step; patched.P.castRayAndGetNormal = patched.ray;
  patched = null;
}

// The run's state, folded to 32 bits (FNV-1a over the doubles' bytes): the same inputs give the
// same fingerprint on every machine, which is what lets the server trust a replay.
const hbuf = new Float64Array(13), hbytes = new Uint8Array(hbuf.buffer);
function fingerprint(c) {
  hbuf[0] = c.pos.x; hbuf[1] = c.pos.y; hbuf[2] = c.pos.z; hbuf[3] = c.vel.x; hbuf[4] = c.vel.y; hbuf[5] = c.vel.z;
  hbuf[6] = c.quat.x; hbuf[7] = c.quat.y; hbuf[8] = c.quat.z; hbuf[9] = c.quat.w; hbuf[10] = c.angVel.x; hbuf[11] = c.angVel.y; hbuf[12] = c.angVel.z;
  let h = 0x811c9dc5;
  for (let i = 0; i < hbytes.length; i++) { h ^= hbytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Body-frame axes of a quaternion (the car's +z is forward, +x its left).
function axes(q) {
  const { x, y, z, w } = q;
  return {
    fx: 2 * (x * z + w * y), fy: 2 * (y * z - w * x), fz: 1 - 2 * (x * x + y * y),
    lx: 1 - 2 * (y * y + z * z), ly: 2 * (x * y + w * z), lz: 2 * (x * z - w * y),
  };
}

// --- The panel ----------------------------------------------------------------------------------------
const CSS = `
.nerds { position: fixed; z-index: 9; left: calc(16px + var(--safe-l, 0px)); top: calc(64px + var(--safe-t, 0px)); bottom: 16px; width: 404px;
  display: flex; flex-direction: column; border: 1px solid rgba(92, 255, 200, 0.22); border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, rgba(4, 8, 12, 0.92), rgba(3, 5, 9, 0.9)); backdrop-filter: blur(16px) saturate(1.2);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  font: 400 11px/1.35 var(--mono, ui-monospace, monospace); color: rgba(235, 245, 242, 0.92); animation: nerds-in 0.45s cubic-bezier(.2,.8,.2,1) both; }
@keyframes nerds-in { from { opacity: 0; transform: translateX(-18px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
.nerds::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.06;
  background: repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px); mix-blend-mode: overlay; }
.nd-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); }
.nd-head h2 { margin: 0; font: 600 11px/1 var(--mono, monospace); letter-spacing: 0.28em; text-transform: uppercase; color: #5cffc8; }
.nd-head .nd-live { width: 7px; height: 7px; border-radius: 50%; background: #5cffc8; box-shadow: 0 0 10px #5cffc8; animation: nd-blink 1.2s steps(2) infinite; }
@keyframes nd-blink { 50% { opacity: 0.25; } }
.nd-head .nd-sub { color: rgba(235, 245, 242, 0.55); letter-spacing: 0.06em; margin-left: auto; }
.nd-head button { width: 26px; height: 26px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.16); background: none; color: inherit; font: 400 14px/1 var(--text, sans-serif); cursor: pointer; }
.nd-load { padding: 10px 14px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); background: rgba(92, 255, 200, 0.035); }
.nd-load .t { color: rgba(235, 245, 242, 0.55); letter-spacing: 0.18em; text-transform: uppercase; font-size: 9.5px; margin-bottom: 7px; }
.nd-load .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 10px; }
.nd-load b { display: block; font: 300 19px/1.05 var(--text, sans-serif); letter-spacing: -0.01em; color: #fff; font-variant-numeric: tabular-nums; }
.nd-load span { color: rgba(235, 245, 242, 0.55); font-size: 9.5px; letter-spacing: 0.04em; }
.nd-body { overflow-y: auto; padding: 4px 14px 14px; scrollbar-width: thin; }
.nd-sec { padding: 11px 0 9px; border-bottom: 1px dashed rgba(255, 255, 255, 0.08); }
.nd-sec h3 { margin: 0 0 7px; display: flex; justify-content: space-between; font: 600 9.5px/1 var(--mono, monospace); letter-spacing: 0.24em; text-transform: uppercase; color: #4fb3ff; }
.nd-sec h3 em { font-style: normal; color: rgba(235, 245, 242, 0.45); letter-spacing: 0.06em; text-transform: none; font-weight: 400; }
.nd-kv { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; }
.nd-kv dt { color: rgba(235, 245, 242, 0.6); }
.nd-kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; color: #fff; }
.nd-kv dd.hot { color: #ffb84f; } .nd-kv dd.ok { color: #5cffc8; }
.nd-note { margin: 6px 0 0; color: rgba(235, 245, 242, 0.45); font-size: 10px; line-height: 1.45; }
.nd-wheels { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nd-wheel { display: grid; grid-template-columns: 58px 1fr; gap: 6px; align-items: center; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; }
.nd-wheel canvas { width: 58px; height: 58px; }
.nd-wheel .n { color: #b07bff; font-weight: 600; letter-spacing: 0.1em; }
.nd-wheel .v { color: rgba(235, 245, 242, 0.75); font-size: 10px; white-space: pre; }
.nd-row { display: flex; gap: 10px; align-items: center; }
.nd-row canvas { flex: none; }
.nd-valves { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; align-items: end; height: 54px; margin-top: 6px; }
.nd-valves i { display: block; height: 100%; border-radius: 3px; background: rgba(255, 255, 255, 0.06); position: relative; overflow: hidden; }
.nd-valves i::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--v, 0) * 100%); background: linear-gradient(0deg, #4fb3ff, #5cffc8); box-shadow: 0 0 10px rgba(92, 255, 200, 0.6); }
.nd-vl { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; margin-top: 3px; color: rgba(235, 245, 242, 0.45); font-size: 8px; text-align: center; letter-spacing: 0; }
.nd-spark { width: 100%; height: 38px; display: block; margin-top: 6px; }
@media (max-width: 720px) {
  .nerds { left: 0; right: 0; width: auto; top: auto; bottom: 0; height: 58dvh; border-radius: 16px 16px 0 0; border-bottom: 0; animation-name: nerds-up; }
  @keyframes nerds-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
  .nd-wheels { grid-template-columns: 1fr 1fr; }
}
@media (prefers-reduced-motion: reduce) { .nerds, .nd-head .nd-live { animation: none; } }
`;

const SECTIONS = `
<div class="nd-load"><div class="t">This second, on this device</div><div class="grid">
  <div><b data-k="L.ticks">—</b><span>physics ticks</span></div>
  <div><b data-k="L.rays">—</b><span>ray casts</span></div>
  <div><b data-k="L.tyre">—</b><span>tyre force solves</span></div>
  <div><b data-k="L.valves">—</b><span>valve updates</span></div>
  <div><b data-k="L.tris">—</b><span>triangles drawn</span></div>
  <div><b data-k="L.frames">—</b><span>frames</span></div>
</div></div>
<div class="nd-body">
  <section class="nd-sec"><h3>Clock <em data-k="mode"></em></h3>
    <dl class="nd-kv">
      <dt>Fixed step</dt><dd>240 Hz · 4.167 ms</dd>
      <dt>Sim time / frame</dt><dd data-k="simMs">—</dd>
      <dt>Frame time p50 · p99</dt><dd data-k="frame">—</dd>
      <dt>Sim tick</dt><dd data-k="tick">—</dd>
    </dl>
    <canvas class="nd-spark" data-c="spark"></canvas>
    <p class="nd-note">Frame time (white) and the sim's share of it (green). The physics never runs on the frame rate: it catches up in fixed 4.167 ms ticks, so every machine computes the same run.</p>
  </section>
  <section class="nd-sec"><h3>Rigid-body engine <em data-k="eng.ver"></em></h3>
    <dl class="nd-kv">
      <dt>Engine step</dt><dd data-k="eng.step">—</dd>
      <dt>Ray casts / tick · cost</dt><dd data-k="eng.rays">—</dd>
      <dt>Bodies · colliders</dt><dd data-k="eng.bodies">—</dd>
      <dt>Parked vehicles awake</dt><dd data-k="eng.awake">—</dd>
      <dt>Hull contacts</dt><dd data-k="eng.touch">—</dd>
      <dt>Curl collision gate</dt><dd data-k="eng.gate">—</dd>
      <dt>WASM memory</dt><dd data-k="eng.mem">—</dd>
    </dl>
    <p class="nd-note">Rapier (Apache-2.0), its cross-platform deterministic WASM build: bit-identical in Chrome, Safari, Firefox, Node and the Cloudflare Worker that verifies the board.</p>
  </section>
  <section class="nd-sec"><h3>Tyres · friction circles <em>Pacejka, relaxation length</em></h3>
    <div class="nd-wheels" data-k="wheels"></div>
    <p class="nd-note">Each dot is that tyre's slip angle (→) and slip ratio (↑) against its peak (the ring). Past the ring the tyre slides.</p>
  </section>
  <section class="nd-sec"><h3>Chassis <em data-k="ch.mass"></em></h3>
    <div class="nd-row"><canvas data-c="gg" width="116" height="116" style="width:116px;height:116px"></canvas>
      <dl class="nd-kv" style="flex:1">
        <dt>Speed</dt><dd data-k="ch.speed">—</dd>
        <dt>Lateral · long. g</dt><dd data-k="ch.g">—</dd>
        <dt>Yaw rate</dt><dd data-k="ch.yaw">—</dd>
        <dt>Steer (road wheels)</dt><dd data-k="ch.steer">—</dd>
        <dt>Traction control</dt><dd data-k="ch.tc">—</dd>
        <dt>Damage</dt><dd data-k="ch.dmg">—</dd>
      </dl></div>
    <p class="nd-note">G-G diagram: the last 1.5 s of acceleration in the car's own frame. A good driver traces the edge of the circle.</p>
  </section>
  <section class="nd-sec"><h3>Cold gas &amp; fan <em>N₂ blowdown · 10 valves</em></h3>
    <dl class="nd-kv">
      <dt>Nitrogen</dt><dd data-k="gas.kg">—</dd>
      <dt>Thrust now</dt><dd data-k="gas.thrust">—</dd>
      <dt>Fan suction · demand</dt><dd data-k="gas.fan">—</dd>
      <dt>Floor gap</dt><dd data-k="gas.gap">—</dd>
    </dl>
    <div class="nd-valves" data-k="valves"></div>
    <div class="nd-vl" data-k="vlabels"></div>
  </section>
  <section class="nd-sec"><h3>Determinism <em data-k="det.v"></em></h3>
    <dl class="nd-kv">
      <dt>State fingerprint</dt><dd data-k="det.hash" class="ok">—</dd>
      <dt>Input log</dt><dd data-k="det.log">—</dd>
      <dt>Math</dt><dd>fdlibm in JS · no Math.sin</dd>
    </dl>
    <p class="nd-note">Your run is only its inputs. The board replays them on the server through this same code and gets this same fingerprint, bit for bit; the score is the server's, never the browser's.</p>
  </section>
  <section class="nd-sec" data-sec="world" hidden><h3>World streaming <em data-k="w.name"></em></h3>
    <dl class="nd-kv" data-k="w.kv"></dl>
  </section>
  <section class="nd-sec"><h3>Renderer <em data-k="r.ver"></em></h3>
    <dl class="nd-kv">
      <dt>Draw calls · triangles</dt><dd data-k="r.calls">—</dd>
      <dt>Geometries · textures · shaders</dt><dd data-k="r.mem">—</dd>
      <dt>Resolution</dt><dd data-k="r.res">—</dd>
      <dt>GPU</dt><dd data-k="r.gpu">—</dd>
    </dl>
  </section>
  <section class="nd-sec"><h3>The judges' last call</h3>
    <dl class="nd-kv" data-k="ai"></dl>
  </section>
</div>`;

let state = null;

export function openNerds(root, ctx) {
  if (state) return;
  if (!document.getElementById('nerds-css')) {
    const st = document.createElement('style'); st.id = 'nerds-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  root.innerHTML = `<div class="nd-head"><i class="nd-live"></i><h2>For nerds</h2><span class="nd-sub">live · <kbd>\`</kbd></span><button type="button" data-nerds-close aria-label="Close">×</button></div>${SECTIONS}`;
  root.hidden = false;
  root.className = 'nerds';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'For nerds: live engineering readout');
  const K = {};
  root.querySelectorAll('[data-k]').forEach((el) => { K[el.dataset.k] = el; });
  const C = {};
  root.querySelectorAll('[data-c]').forEach((el) => { C[el.dataset.c] = el; });
  K.valves.innerHTML = NOZZLE_SPEC.map(() => '<i></i>').join('');
  K.vlabels.innerHTML = NOZZLE_SPEC.map((n) => `<span>${n.id.replace('down-', 'D').replace('rear-', 'R').replace('yaw-', 'Y').toUpperCase()}</span>`).join('');
  K.wheels.innerHTML = WHEEL_NAMES.map((n) => `<div class="nd-wheel"><canvas width="116" height="116"></canvas><div><div class="n">${n}</div><div class="v"></div></div></div>`).join('');
  const wheelEls = [...K.wheels.children].map((el) => ({ c: el.querySelector('canvas'), v: el.querySelector('.v'), trail: [] }));
  root.querySelector('[data-nerds-close]').addEventListener('click', () => closeNerds());
  K['eng.ver'].textContent = 'Rapier 0.21 · deterministic';
  K['r.ver'].textContent = `three.js r${REVISION} · WebGL2`;
  K['det.v'].textContent = `SIM_VERSION ${SIM_VERSION}`;

  state = { root, ctx, K, C, wheelEls, raf: 0, n: 0, last: performance.now(), frames: [], simShare: [], gg: [],
    win: { t0: performance.now(), frames: 0, ticks: 0, tyre: 0, tris: 0, steps: 0, stepMs: 0, rays: 0, rayMs: 0 },
    prevTick: null, prevVel: null, nextText: 0, nextSlow: 0, rates: null, gpu: null, logBytes: null, renderer: null };
  patch();
  state.raf = requestAnimationFrame(loop);
}

export function closeNerds() {
  if (!state) return;
  cancelAnimationFrame(state.raf);
  if (state.renderer) state.renderer.info.autoReset = true;
  unpatch();
  state.root.hidden = true;
  state.root.innerHTML = '';
  state = null;
}
export const nerdsOpen = () => !!state;

function loop(now) {
  const s = state;
  if (!s) return;
  s.raf = requestAnimationFrame(loop);
  patch();
  const dtMs = now - s.last;
  s.last = now;
  const x = s.ctx();
  const car = x.car, w = s.win;

  // Renderer: count every pass of the frame (bloom, SMAA…) until we read it once a frame.
  const r = x.renderer;
  if (r && s.renderer !== r) { s.renderer = r; r.info.autoReset = false; r.info.reset(); }
  const tris = r ? r.info.render.triangles : 0, calls = r ? r.info.render.calls : 0;
  if (r) r.info.reset();

  // Per-frame accumulators.
  w.frames++; w.tris += tris;
  // (The first frames after opening carry the chunk's own load hitch: not the game's.)
  if (++s.n > 20) { s.frames.push(dtMs); if (s.frames.length > 180) s.frames.shift(); }
  s.simShare.push(x.simMs || 0); if (s.simShare.length > 180) s.simShare.shift();
  let dTicks = 0;
  if (car) {
    if (s.prevTick != null && car.tick >= s.prevTick) dTicks = car.tick - s.prevTick;
    let inContact = 0;
    for (const wh of car.wheels) if (wh.contact) inContact++;
    w.ticks += dTicks; w.tyre += dTicks * inContact;
    // G-G, from the change in velocity over the ticks this frame (sim time, not frame time).
    if (s.prevVel && dTicks > 0) {
      const dt = dTicks / 240, ax = (car.vel.x - s.prevVel.x) / dt, ay = (car.vel.y - s.prevVel.y) / dt + G, az = (car.vel.z - s.prevVel.z) / dt;
      const a = axes(car.quat);
      s.gg.push([-(ax * a.lx + ay * a.ly + az * a.lz) / G, (ax * a.fx + ay * a.fy + az * a.fz) / G]);
      if (s.gg.length > 90) s.gg.shift();
    }
    s.prevVel = { x: car.vel.x, y: car.vel.y, z: car.vel.z };
    s.prevTick = car.tick;
  } else { s.prevTick = null; s.prevVel = null; }

  // Once a second: the rates.
  if (now - w.t0 >= 1000) {
    const k = 1000 / (now - w.t0);
    s.rates = {
      fps: w.frames * k, ticks: w.ticks * k, tyre: w.tyre * k, tris: w.tris * k, valves: w.ticks * k * NOZZLE_SPEC.length,
      steps: (cnt.steps - w.steps) * k, stepMs: cnt.steps > w.steps ? (cnt.stepMs - w.stepMs) / (cnt.steps - w.steps) : 0,
      rays: (cnt.rays - w.rays) * k, rayUs: cnt.rays > w.rays ? ((cnt.rayMs - w.rayMs) / (cnt.rays - w.rays)) * 1000 : 0,
    };
    Object.assign(w, { t0: now, frames: 0, ticks: 0, tyre: 0, tris: 0, steps: cnt.steps, stepMs: cnt.stepMs, rays: cnt.rays, rayMs: cnt.rayMs });
  }

  drawSpark(s);
  if (car) { drawGG(s); for (let i = 0; i < 4; i++) drawWheel(s.wheelEls[i], car.wheels[i]); }
  if (now >= s.nextText) { s.nextText = now + 100; text(s, x, calls, tris); }
  if (now >= s.nextSlow) { s.nextSlow = now + 1000; slow(s, x); }
}

const set = (el, v, cls) => { if (!el) return; if (el.textContent !== v) el.textContent = v; if (cls !== undefined) el.className = cls; };

function text(s, x, calls, tris) {
  const { K } = s, R = s.rates, car = x.car;
  set(K.mode, ({ title: 'title', countdown: 'countdown', live: 'flying', results: 'results · replay', replay: 'replay', drive: 'free drive' })[x.mode] || x.mode);
  if (R) {
    set(K['L.ticks'], big(R.ticks)); set(K['L.rays'], big(R.rays)); set(K['L.tyre'], big(R.tyre));
    set(K['L.valves'], big(R.valves)); set(K['L.tris'], big(R.tris)); set(K['L.frames'], big(R.fps));
    set(K['eng.step'], R.steps ? `${fmt(R.stepMs * 1000)} µs × ${big(R.steps)}/s` : 'idle');
    set(K['eng.rays'], R.steps ? `${fmt(R.rays / Math.max(1, R.steps), 1)} · ${fmt(R.rayUs, 2)} µs` : '—');
  }
  const fs = s.frames.slice().sort((a, b) => a - b), p = (q) => fs[Math.min(fs.length - 1, Math.floor(q * fs.length))] || 0;
  set(K.frame, `${fmt(p(0.5), 1)} · ${fmt(p(0.99), 1)} ms`, p(0.99) > 33 ? 'hot' : '');
  set(K.simMs, x.simMs != null ? `${fmt(x.simMs, 2)} ms · ${x.simTicks ?? '—'} ticks` : '—');
  set(K.tick, car ? `${car.tick.toLocaleString('en-US')} · ${fmt(car.tick / 240, 2)} s` : '—');
  set(K['r.calls'], `${calls} · ${big(tris)}`);
  if (s.renderer) {
    const i = s.renderer.info, c = s.renderer.domElement;
    set(K['r.mem'], `${i.memory.geometries} · ${i.memory.textures} · ${i.programs?.length ?? '—'}`);
    set(K['r.res'], `${c.width}×${c.height} @${fmt(s.renderer.getPixelRatio(), 2)}×`);
  }

  const w = car?.world;
  if (w && !w.freed && w.rw) {
    set(K['eng.bodies'], `${w.rw.bodies.len()} · ${w.rw.colliders.len()}`);
    set(K['eng.awake'], `${w.bodies.filter((b) => !b.asleep).length} of ${w.bodies.length}`);
    set(K['eng.touch'], w.carTouching > 0 ? `${w.carTouching} collider${w.carTouching > 1 ? 's' : ''}` : 'none', w.carTouching > 0 ? 'hot' : '');
    set(K['eng.gate'], w.curl ? (w.curlOn ? 'open: hull vs curl' : 'closed: provably clear') : 'no curl here');
  } else for (const k of ['eng.bodies', 'eng.awake', 'eng.touch', 'eng.gate']) set(K[k], car ? 'run over · engine freed' : '—');
  set(K['eng.mem'], `${fmt(physicsMemoryBytes() / 1048576, 1)} MB`);

  if (car) {
    const sp = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
    const last = s.gg[s.gg.length - 1] || [0, 0];
    const yaw = car.angVel.y;   // world frame: rotation about vertical
    set(K['ch.speed'], `${fmt(sp * 3.6)} km/h · ${fmt(sp, 1)} m/s`);
    set(K['ch.g'], `${fmt(last[0], 2)} · ${fmt(last[1], 2)} g`);
    set(K['ch.yaw'], `${fmt(yaw * 57.2958, 1)} °/s`);
    set(K['ch.steer'], `${fmt(-car.steer * 57.2958, 1)}°`);
    set(K['ch.tc'], car.tcActive ? 'limiting torque' : 'idle', car.tcActive ? 'hot' : '');
    const dmg = x.run?.damage?.total;
    set(K['ch.dmg'], dmg != null ? `${fmt(dmg)} %` : '—', dmg >= 25 ? 'hot' : '');
    set(K['ch.mass'], `${fmt(SPEC.dryMass)} kg dry + ${fmt(car.air)} kg N₂`);
    for (let i = 0; i < 4; i++) {
      const wh = car.wheels[i];
      set(s.wheelEls[i].v, wh.contact
        ? `Fz ${fmt(wh.load / 1000, 2)} kN\nκ  ${fmt(wh.slip * 100, 1)} %\nα  ${fmt(wh.slipAngle * 57.2958, 1)}°\nsag ${fmt(wh.compression * 1000)} mm\nω  ${fmt(wh.omega * 9.549)} rpm`
        : `in the air\n\n\nω  ${fmt(wh.omega * 9.549)} rpm`);
    }
    const thrust = car.throttles ? NOZZLE_SPEC.reduce((t, n, i) => t + (car.throttles[i] || 0) * n.max, 0) : 0;
    set(K['gas.kg'], `${fmt(car.air, 1)} kg`);
    set(K['gas.thrust'], `${fmt(thrust / 1000, 1)} kN · ${fmt(thrust / G)} kgf`, thrust > 0 ? 'ok' : '');
    set(K['gas.fan'], `${fmt((car.fanForce || 0) / G)} kgf · ${fmt((car.fanDemand || 0) * 100)} %`);
    set(K['gas.gap'], Number.isFinite(car.floorGap) ? `${fmt(car.floorGap * 1000)} mm` : 'open sky');
    const vs = s.K.valves.children;
    for (let i = 0; i < vs.length; i++) vs[i].style.setProperty('--v', String(Math.max(0, Math.min(1, car.throttles?.[i] || 0)).toFixed(3)));
    set(K['det.hash'], `${fingerprint(car)} @ ${car.tick}`);
  }
}

// Once a second: the costlier readings (the log's size, the world's streaming, the GPU string, the receipt).
function slow(s, x) {
  const { K } = s;
  const log = x.run?.inputLog;
  if (log) set(K['det.log'], `${log.length.toLocaleString('en-US')} entries · ${fmt(JSON.stringify(log).length / 1024, 1)} kB`);
  else set(K['det.log'], x.mode === 'drive' ? 'Free Drive: not scored' : '—');
  if (!s.gpu && s.renderer) {
    try {
      const gl = s.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      s.gpu = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/^ANGLE \((.*)\)$/, '$1').replace(/^.*Renderer: /, '').replace(/, Unspecified Version$/, '').slice(0, 48);
    } catch { s.gpu = 'unknown'; }
    set(K['r.gpu'], s.gpu);
  }
  const ds = x.driveStats?.();
  const sec = s.root.querySelector('[data-sec="world"]');
  if (ds && (ds.tiles || ds.chunks != null)) {
    sec.hidden = false;
    set(K['w.name'], ds.seed != null ? `endless · seed ${ds.seed}` : ds.road || '');
    const rows = [
      ['Terrain tiles (by LOD)', ds.tiles?.join(' · ')], ['Road chunks · queue', `${ds.chunks ?? '—'} · ${ds.queue ?? 0}`],
      ['Vegetation instances', ds.veg ? Object.values(ds.veg).reduce((a, b) => a + b, 0).toLocaleString('en-US') : '—'],
      ['Worker tile build avg · p95', ds.worker ? `${ds.worker.avgMs} · ${ds.worker.p95Ms} ms` : '—'],
      ['World uploads p50 · p95', ds.main ? `${ds.main.p50Ms} · ${ds.main.p95Ms} ms` : '—'],
      ['GPU · cache', `${ds.gpuMB ?? '—'} MB · ${ds.cacheMB ?? '—'} MB`],
    ];
    K['w.kv'].innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');
  } else sec.hidden = true;
  const m = x.meta;
  const rows = m ? [
    ['Model', `${m.model || '—'}`], ['Where', m.colo ? `Cloudflare ${m.colo}` : m.provider || '—'],
    ['Server scoring', m.verify ? `${m.verify.ms} ms · ${m.verify.replayed === false ? 'from telemetry' : 'replayed'}` : '—'],
    ['First token · total', `${m.ttftMs ?? '—'} · ${m.totalMs ?? '—'} ms`], ['Tokens in · out', `${m.inTokens ?? '—'} · ${m.outTokens ?? '—'}`],
    ['Speed', m.tokensPerSec ? `${m.tokensPerSec} tok/s` : '—'], ['Cost', m.costUsd != null ? `$${m.costUsd.toFixed(6)}` : m.neurons ? `${m.neurons} neurons` : '—'],
  ] : [['—', 'finish a run to see the call']];
  K.ai.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/[<>&]/g, '')}</dd>`).join('');
}

// --- Canvases ------------------------------------------------------------------------------------------
function ctx2d(c, w, h) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.round((w || c.clientWidth) * dpr), H = Math.round((h || c.clientHeight) * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function drawSpark(s) {
  const c = s.C.spark, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  const g = ctx2d(c, w, h);
  g.clearRect(0, 0, w, h);
  const max = 40, n = s.frames.length, dx = w / 180;
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); for (const ms of [16.7, 33.3]) { const y = h - (ms / max) * h; g.moveTo(0, y); g.lineTo(w, y); } g.stroke();
  const line = (arr, color) => { g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath(); arr.forEach((v, i) => { const X = (180 - n + i) * dx, Y = h - Math.min(1, v / max) * h; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); };
  line(s.frames, 'rgba(255,255,255,0.85)');
  line(s.simShare, '#5cffc8');
}

function drawGG(s) {
  const c = s.C.gg, g = ctx2d(c, 116, 116), R = 52, cx = 58, cy = 58;
  g.clearRect(0, 0, 116, 116);
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  for (const r of [0.5, 1, 1.5]) { g.beginPath(); g.arc(cx, cy, (r / 1.5) * R, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  g.fillStyle = 'rgba(235,245,242,0.4)'; g.font = '8px ui-monospace, monospace'; g.fillText('1 g', cx + (1 / 1.5) * R * 0.72, cy - (1 / 1.5) * R * 0.72);
  const n = s.gg.length;
  s.gg.forEach(([lat, lon], i) => {
    const X = cx + Math.max(-1.6, Math.min(1.6, lat)) / 1.5 * R, Y = cy - Math.max(-1.6, Math.min(1.6, lon)) / 1.5 * R;
    g.fillStyle = `rgba(92,255,200,${(0.08 + 0.92 * (i / n)).toFixed(2)})`;
    g.beginPath(); g.arc(X, Y, i === n - 1 ? 3.2 : 1.4, 0, Math.PI * 2); g.fill();
  });
}

const PEAK_SLIP = 0.10, PEAK_ALPHA = 8.4 / 57.2958;   // where the tyre curves peak (src/sim/vehicle.js: κ ≈ 0.10, α ≈ 8.4°)
function drawWheel(el, wh) {
  const g = ctx2d(el.c, 58, 58), R = 22, cx = 29, cy = 29;
  g.clearRect(0, 0, 58, 58);
  g.strokeStyle = 'rgba(176,123,255,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(cx - R - 4, cy); g.lineTo(cx + R + 4, cy); g.moveTo(cx, cy - R - 4); g.lineTo(cx, cy + R + 4); g.stroke();
  const x = wh.contact ? wh.slipAngle / PEAK_ALPHA : 0, y = wh.contact ? wh.slip / PEAK_SLIP : 0;
  const X = cx + Math.max(-1.25, Math.min(1.25, x)) * R, Y = cy - Math.max(-1.25, Math.min(1.25, y)) * R;
  el.trail.push([X, Y]); if (el.trail.length > 24) el.trail.shift();
  el.trail.forEach(([tx, ty], i) => { g.fillStyle = `rgba(92,255,200,${(i / el.trail.length * 0.35).toFixed(2)})`; g.fillRect(tx - 1, ty - 1, 2, 2); });
  const over = Math.hypot(x, y) > 1;
  g.fillStyle = !wh.contact ? 'rgba(255,255,255,0.25)' : over ? '#ffb84f' : '#5cffc8';
  g.shadowColor = g.fillStyle; g.shadowBlur = 8;
  g.beginPath(); g.arc(X, Y, 3.5, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
}
