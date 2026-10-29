// The judges' theatre: every AI call made visible. An aurora-field particle field (lazy chunk)
// morphs with the real call as it happens:
//
//   TELEMETRY  a circuit board: signals run from the run's sensors to the die
//   TEXT       the telemetry becomes text: the facts the model is about to read
//   COMPUTE    a compute die: one signal per streamed token (reasoning and words)
//   APP        the verdict, then the words land in the judges' cards
//
// Around it: the stage rail, the model card (who, where, who pays), live counters (tokens in and
// out, time to first token, tokens/s, neurons, cost) and the raw stream as it arrives.
import { create, register, fromText } from 'aurora-field';
import { streamPanel, streamQuest } from './stream.js';
import { shortModel, PROVIDER_INFO } from './config.js';
import { one, k } from '../units.js';
import monoBoldUrl from '@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2?url';

const STAGES = ['telemetry', 'text', 'compute', 'app'];
// Each morph needs time to read; the call itself usually finishes inside these. TEXT is a
// sequence of the run's figures (FIG_MS each: a 450 ms morph, then ~1 s settled to read):
// FIG_MIN of them always, more while the call is still thinking (up to FIG_MAX), then the call's
// own numbers (CALL_MS each) once it has answered. Against the old single 2.4 s frame that adds
// at most 6 × 1.4 − 2.4 + 3 × 1.3 ≈ 9.9 s to a fast call; a slow call fills its wait with figures
// instead of adding time. Skip (once the words are in) still ends the show at once.
const MIN_MS = { telemetry: 1700, text: 0, compute: 1500 };
const FIG_MS = 1400, FIG_MIN = 6, FIG_MAX = 10, CALL_MS = 1300, MORPH_MS = 450;
// How alive the field is per stage. Text stages hold still (no drifting, place-trading or scouts)
// so the particle letters stay crisp; the circuit and the die breathe.
const AUTONOMY = { telemetry: 0.3, text: 0, compute: 0.3, app: 0 };
// While the field spells something, its points burn brighter (same aurora hue, lifted toward
// white) and far points fade toward a light fog instead of the dark one, so letters read as light.
// Near white with the aurora's green-cyan tint, so the figures burn rather than glimmer.
const SPELL = { preset: 'aurora', point: [222, 255, 242], accent: [222, 255, 242], glow: [160, 250, 218], fog: [200, 240, 226] };
const PALETTE = { telemetry: 'aurora', text: SPELL, compute: 'aurora', app: SPELL };

// The particle letters are rasterised from a real bold face (a synthesised bold of the 400 cut is
// thin and breaks up into noise). Loaded once with the lazy chunk; until it lands the fallback
// monospace is used, so nothing ever waits on it.
let monoBold = null;
function loadMonoBold() {
  if (monoBold || typeof FontFace === 'undefined' || !document.fonts) return monoBold;
  monoBold = new FontFace('Geist Mono', `url(${monoBoldUrl}) format('woff2')`, { weight: '700' })
    .load().then((f) => { document.fonts.add(f); }).catch(() => {});
  return monoBold;
}

// --- Shapes -------------------------------------------------------------------------------------
let registered = false;
function registerShapes() {
  if (registered) return;
  registered = true;

  // A circuit board: sensor pads on the left route into a die in the middle, three output pads
  // on the right (the judges). Manhattan traces with 45° chamfers, vias, a pinned die outline.
  register('cg:circuit', (n, rnd) => {
    const lines = [];
    const chip = 0.2;
    const left = 7, right = 3;
    for (let i = 0; i < left; i++) {
      const y0 = -0.62 + (i / (left - 1)) * 1.24, yPin = -chip * 0.8 + (i / (left - 1)) * chip * 1.6;
      const xBend = -0.78 + rnd() * 0.3, dy = yPin - y0, xEnd = xBend + Math.abs(dy);
      lines.push({ pts: [[-1.05, y0], [xBend, y0], [Math.min(-chip - 0.04, xEnd), yPin], [-chip, yPin]], tone: 0.25, pad: true });
    }
    for (let i = 0; i < right; i++) {
      const y1 = -0.45 + i * 0.45, yPin = -chip * 0.6 + i * chip * 0.6;
      const xBend = 0.45 + rnd() * 0.2, dy = y1 - yPin;
      lines.push({ pts: [[chip, yPin], [xBend - Math.abs(dy), yPin], [xBend, y1], [1.05, y1]], tone: 0.9, pad: true });
    }
    // Decorative ground traces.
    for (let i = 0; i < 8; i++) {
      const x = -0.9 + rnd() * 1.8, y = (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.08), len = 0.2 + rnd() * 0.45;
      lines.push({ pts: [[x, y], [x + len, y]], tone: 0.12 });
    }
    // Die outline with pins.
    const c = chip;
    lines.push({ pts: [[-c, -c], [c, -c], [c, c], [-c, c], [-c, -c]], tone: 1, die: true });
    lines.push({ pts: [[-c * 0.55, -c * 0.55], [c * 0.55, -c * 0.55], [c * 0.55, c * 0.55], [-c * 0.55, c * 0.55], [-c * 0.55, -c * 0.55]], tone: 0.7, die: true });

    const segLen = (l) => l.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - l.pts[i][0], p[1] - l.pts[i][1]), 0);
    const total = lines.reduce((a, l) => a + segLen(l), 0);
    const points = [], tone = [], pairs = [], bright = [];
    for (const l of lines) {
      const k = Math.max(2, Math.round((segLen(l) / total) * n));
      const start = points.length;
      const L = segLen(l);
      for (let j = 0; j < k && points.length < n; j++) {
        let d = (j / (k - 1)) * L;
        let s = 0;
        while (s < l.pts.length - 2 && d > Math.hypot(l.pts[s + 1][0] - l.pts[s][0], l.pts[s + 1][1] - l.pts[s][1])) {
          d -= Math.hypot(l.pts[s + 1][0] - l.pts[s][0], l.pts[s + 1][1] - l.pts[s][1]); s++;
        }
        const a = l.pts[s], b = l.pts[s + 1];
        const sl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const t = Math.min(1, d / sl);
        points.push([a[0] + (b[0] - a[0]) * t, (a[1] + (b[1] - a[1]) * t) * 0.9, (rnd() - 0.5) * 0.02]);
        tone.push(l.tone);
        if (j > 0) pairs.push([points.length - 2, points.length - 1]);
      }
      if (l.pad) bright.push(start, points.length - 1);
    }
    while (points.length < n) { const i = Math.floor(rnd() * points.length); points.push([...points[i]]); tone.push(tone[i]); }
    return { points, tone, pairs, bright, kick: 0.15, edges: true };
  });

  // The compute die: a lattice of cells, densest at the core, wired to its neighbours so the
  // field's signals race across it.
  register('cg:compute', (n, rnd) => {
    const side = Math.max(6, Math.floor(Math.sqrt(n * 0.82)));
    const points = [], tone = [], pairs = [];
    const idx = (i, j) => i * side + j;
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
      const x = (i / (side - 1) - 0.5) * 1.0, y = (j / (side - 1) - 0.5) * 1.0;
      const r = Math.hypot(x, y);
      points.push([x + (rnd() - 0.5) * 0.004, y * 0.92, Math.sin(r * 14) * 0.02]);
      tone.push(Math.max(0, 1 - r * 1.6));
      if (i > 0 && rnd() < 0.35) pairs.push([idx(i - 1, j), idx(i, j)]);
      if (j > 0 && rnd() < 0.35) pairs.push([idx(i, j - 1), idx(i, j)]);
    }
    // Pins round the edge.
    for (let k = 0; points.length < n; k++) {
      const side4 = k % 4, t = ((k >> 2) % 24) / 23 - 0.5;
      const o = 0.62 + ((k >> 2) % 2) * 0.02;
      points.push(side4 === 0 ? [t, -o * 0.92, 0] : side4 === 1 ? [o, t * 0.92, 0] : side4 === 2 ? [t, o * 0.92, 0] : [-o, t * 0.92, 0]);
      tone.push(0.5);
    }
    return { points, tone, pairs, kick: 0.25, edges: true };
  });
}

// Particle text, fitted to the free stage. Two short lines a figure (label over value), so each
// glyph gets the particles and the height to read. Most particles go to the outlines (edges) so
// letters read crisp. The glyphs sit on a flat plane pulled toward the viewer (TEXT_Z): the field
// sizes, fogs and fades points by depth, so a plane at the centre (z 0) drew 2 px dots at ~43 %
// alpha; at TEXT_Z they draw ~3.2 px at ~80 % with a white core. The plane is fitted (in screen px)
// into the box between the caption and the cards, measured when the figure is registered.
// aurora-field has no unregister: names come from a fixed ring of slots, re-registered on reuse
// (which clears the library's cache for that name) and stubbed when a show ends, so a run's
// rasters never pile up. A field never sees a slot twice (it is rebuilt every show).
const TEXT_Z = -0.7, FIELD_DEPTH = 3.0, SLOTS = 32;
let slotSeq = 0;
const STUB = (n) => { const points = []; for (let i = 0; i < n; i++) points.push([0, 0, 0]); return { points }; };
function textShape(text, fit, used) {
  const name = `cg:text:${slotSeq++ % SLOTS}`;
  try {
    // fromText sets every line flush left; in a monospace face leading spaces centre them.
    const lines = text.split('\n'), wide = Math.max(...lines.map((l) => l.length));
    const centred = lines.map((l) => ' '.repeat(Math.floor((wide - l.length) / 2)) + l).join('\n');
    const build = fromText(centred, { font: '700 160px "Geist Mono", ui-monospace, monospace', edges: 0.78, depth: 0, scale: 1 });
    const box = fit?.();
    register(name, (n, rnd) => {
      const s = build(n, rnd), P = s.points;
      if (!box) { for (const p of P) { p[0] *= 0.7; p[1] *= 0.7; p[2] = TEXT_Z; } return s; }
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const px = box.R * FIELD_DEPTH / (FIELD_DEPTH + TEXT_Z);   // screen px per shape unit on the plane
      const k = Math.min(box.w / Math.max(1e-6, x1 - x0), box.h / Math.max(1e-6, y1 - y0)) / px;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, ox = box.dx / px, oy = box.dy / px;
      for (const p of P) { p[0] = (p[0] - mx) * k + ox; p[1] = (p[1] - my) * k + oy; p[2] = TEXT_Z; }
      return s;
    });
    used?.add(name);
    return name;
  } catch (err) {
    console.warn('theatre text shape', err);
    return 'cg:compute';
  }
}
const releaseShapes = (used) => { for (const n of used) safe(() => register(n, STUB)); used.clear(); };

// The free box for particle text, in px relative to the stage's centre: below the caption, above
// the cards, inset from the sides. `geo` is the field's last stage size and radius.
function freeBox(root, geo) {
  if (!geo.R) return null;
  const r = root.getBoundingClientRect(), H = r.height, W = r.width;
  const cap = root.querySelector('.th-caption')?.getBoundingClientRect();
  let top = cap && cap.height ? cap.bottom - r.top + 14 : H * 0.2, bottom = H - 16;
  for (const sel of ['.th-card', '.th-stats']) {
    const b = root.querySelector(sel)?.getBoundingClientRect();
    if (b && b.height && getComputedStyle(root.querySelector(sel)).display !== 'none') bottom = Math.min(bottom, b.top - r.top - 14);
  }
  // A layout with no room between them (a short sideways screen): use the middle of the stage.
  if (bottom - top < Math.min(120, H * 0.3)) { top = H * 0.22; bottom = H * 0.78; }
  // Big where there's room, but clear of the edges and never a wall of dots on a wide screen.
  const w = Math.min(W - 40, W * 0.84, 680), h = Math.min(bottom - top, w * 0.56, 340);
  const dy = (top + bottom) / 2 - H / 2;
  // Where the figure sits on screen (tests measure its contrast there).
  root.dataset.figBox = [r.left + W / 2 - w / 2, r.top + H / 2 + dy - h / 2, w, h].map(Math.round).join(',');
  return { R: geo.R, w, h, dx: 0, dy };
}

// The run's facts as the particle figures spell them: label over value, in the player's units
// (src/units.js, as the HUD shows them). `pri` picks which make the short show; they play in
// flight order. Only facts this run really has.
const up = (s) => s.toUpperCase();
const lenOf = (m) => up(one('len', m, m * k('len') < 10 ? 1 : 0));
function figuresOf(card, t) {
  const f = card.facts || {}, out = [];
  const add = (pri, label, value) => { if (value != null && value !== '') out.push({ pri, text: `${label}\n${value}` }); };
  const fin = (v) => Number.isFinite(v);
  const wall = f.course === 'wall' || f.course === 'show';
  const airS = t && t.airStartTick >= 0 && t.touchTick > t.airStartTick ? (t.touchTick - t.airStartTick) / 240 : null;
  if (fin(f.launchKmh) && f.launchKmh > 0) add(5, 'LIP', up(one('speed', f.launchKmh / 3.6)));
  if (wall && fin(f.height) && f.height > 0) add(10, 'WALL', lenOf(f.height));
  if (wall && fin(f.invertedS) && f.invertedS > 0) add(9, 'INVERTED', `${f.invertedS.toFixed(1)} S`);
  if (f.jumped && fin(f.apex)) add(2, 'APEX', lenOf(f.apex));
  if (!wall && f.jumped && fin(f.apexOverRoof)) add(9, 'OVER ROOF', lenOf(f.apexOverRoof));
  if (airS != null) add(7, 'AIR', `${airS.toFixed(1)} S`);
  if (fin(f.rollDeg) && f.rollDeg > 0) add(3, 'ROLL', `${f.rollDeg}°`);
  if (fin(f.maxG) && f.maxG > 0) add(6, 'PEAK', `${f.maxG.toFixed(1)} G`);
  if (fin(f.clearance) && (f.crossedRow ?? true) && !f.contact) add(4.5, 'CLEAR', lenOf(f.clearance));
  if (f.jumped && fin(f.sink)) add(4, 'SINK', up(one('rate', f.sink, 1)));
  if (f.jumped && !f.crashed && fin(f.wheelSpreadMs)) add(14, 'SYNC', `${f.wheelSpreadMs} MS`);
  if (f.jumped && fin(f.padMiss)) add(13, 'MISS', lenOf(f.padMiss));
  if (fin(f.airPct)) add(11, 'N2 LEFT', `${f.airPct}%`);
  if (fin(f.integrity)) add(f.integrity < 100 ? 3.5 : 12, 'HULL', `${Math.round(f.integrity)}%`);
  if (fin(card.total)) add(1, 'SCORE', card.total.toFixed(1));
  return out;
}
// The call's own numbers, once it has answered.
function callFigures(d) {
  const out = [];
  if (Number.isFinite(d.outTokens)) out.push(`OUT\n${d.outTokens} TOK`);
  if (d.tokensPerSec) out.push(`SPEED\n${d.tokensPerSec} TOK/S`);
  if (Number.isFinite(d.ttftMs)) out.push(`TTFT\n${d.ttftMs < 1000 ? `${Math.round(d.ttftMs)} MS` : `${(d.ttftMs / 1000).toFixed(1)} S`}`);
  return out;
}

// Visuals must never block the judges' words: any failure in the field is logged and skipped.
const safe = (fn) => { try { fn(); } catch (err) { console.warn('theatre visual', err); } };

// A show's field, ended for good (0064). aurora-field draws a still frame on set() / setShape() whenever
// its loop isn't running, and after destroy() that frame used the deleted programs and buffers: a step of
// the show that resumed after a Skip, a restart or the fade (setStage('compute') once the figures ended)
// logged a burst of WebGL INVALID_* errors and dropped the frame. So a show's `field` is set to null
// before it is destroyed, and every call on it goes through `field?.` or `if (field)`. One canvas (one
// WebGL context) serves every show: a canvas per show kept its context alive until GC, and twenty shows
// reached the browser's limit, where the oldest context (the game's) is the one dropped. The last show's
// field is ended before the next one is made on it, so two fields never share the context.
let showCanvas = null, endLive = null;
// `kill` nulls the show's field and destroys it; `current()` says the root is still this show's.
function ownCanvas(kill) {
  endLive?.();
  const end = () => { if (endLive === end) endLive = null; kill(); };
  endLive = end;
  return { end, current: () => endLive === end };
}

// --- DOM ------------------------------------------------------------------------------------------
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtUsd = (u) => (u == null ? '—' : u < 0.0001 ? `$${u.toFixed(6)}` : `$${u.toFixed(4)}`);

function buildDom(root, stages = STAGES) {
  root.innerHTML = '';
  // A context the browser took away between shows is never given back (no field is listening to ask for
  // it), so a lost one costs the canvas: the next show starts on a fresh one.
  if (showCanvas?.getContext('webgl')?.isContextLost()) showCanvas = null;
  const canvas = showCanvas ??= el('canvas', 'th-canvas');
  const rail = el('ol', 'th-rail');
  const railItems = {};
  for (const [i, s] of stages.entries()) {
    const li = el('li', '', `<span class="n">0${i + 1}</span><span class="l">${s}</span><span class="d"></span>`);
    rail.appendChild(li); railItems[s] = li;
  }
  const card = el('div', 'th-card', `
    <div class="th-eyebrow">Inside the panel</div>
    <div class="th-model"><b data-k="model">—</b><span data-k="vendor"></span></div>
    <dl class="th-meta">
      <div><dt>Runs on</dt><dd data-k="where">—</dd></div>
      <div><dt>Billed to</dt><dd data-k="billed">—</dd></div>
    </dl>`);
  const stats = el('dl', 'th-stats', ['in', 'out', 'ttft', 'rate', 'neurons', 'cost'].map((k) =>
    `<div><dt>${{ in: 'Tokens in', out: 'Tokens out', ttft: 'First token', rate: 'Speed', neurons: 'Neurons', cost: 'Cost' }[k]}</dt><dd data-s="${k}">—</dd></div>`).join(''));
  const ticker = el('div', 'th-ticker', '<div class="th-reason" data-k="reason"></div><div class="th-out" data-k="out"></div>');
  const caption = el('div', 'th-caption', '');
  const skip = el('button', 'th-skip', 'Skip');
  skip.type = 'button';
  root.append(canvas, rail, card, stats, ticker, caption, skip);
  const q = (sel) => root.querySelector(sel);
  return {
    canvas, railItems, skip, caption,
    set: (k, v) => { const n = q(`[data-k="${k}"]`); if (n) n.textContent = v; },
    stat: (k, v) => { const n = q(`[data-s="${k}"]`); if (n) n.textContent = v; },
    out: q('[data-k="out"]'), reason: q('[data-k="reason"]'),
  };
}

// --- The show ---------------------------------------------------------------------------------------
// Runs one judging call through the theatre. Resolves with { words, meta } when the show is over
// (or skipped). `fallbackWords(card)` supplies local lines if the call fails. Aborting `abort`
// (an AbortSignal: a restart, the title) tears it down at once and resolves with { aborted: true }.
// `deadlineMs` is what is left of the judges' 35 s (invariant 5½) once the caller has spent some of
// it (loading this chunk). When the show ends, however it ends, the call's stream is cancelled.
export function runTheatre(root, { log, t, assist, ai, card, course, fallbackWords, reduced = false, replay = null, abort = null, deadlineMs = 35_000 }) {
  registerShapes();
  root.classList.remove('th-quest');
  const dom = buildDom(root);
  // Full screen on a phone: Retry and Home stay one tap away while the show plays (src/main.js
  // handles [data-again] / [data-home] / [data-rookie-go] wherever they are). Rookie mode (0076) is
  // there too, shown only while the results offer it: src/main.js's syncRookie sets .th-rookie on the root.
  root.append(el('div', 'th-quick', '<button type="button" class="quick-btn primary" data-again>Retry</button><button type="button" class="quick-btn" data-home>Home</button>'
    + '<button type="button" class="quick-btn th-rookie-btn" data-rookie-go>Rookie mode<span>easier car · auto-land</span></button>'));
  root.hidden = false;
  root.classList.remove('out');
  requestAnimationFrame(() => root.classList.add('on'));

  let field = null;
  const own = ownCanvas(() => { const f = field; field = null; if (f) safe(() => f.destroy()); });
  loadMonoBold();
  const geo = { R: 0 }, used = new Set();
  const fit = () => freeBox(root, geo);
  if (!reduced) safe(() => { field = create(dom.canvas, {
    container: root.querySelector('.th-canvas').parentElement, shapes: ['cg:circuit', 'cg:compute'], initial: 'cg:circuit',
    cycle: 0, palette: 'aurora', blank: true, interactive: false, stars: 60, autonomy: 0.3, depth: FIELD_DEPTH, intro: 0,
    count: (w) => (w < 700 ? 3000 : 4200), radius: (w, h) => (geo.R = Math.min(w * 0.42, h * 0.36)),
  }); });
  // Facing shapes (the text) follow a fixed pose: square to the viewer, no sway, so figures hold still.
  safe(() => field?.setPose({ yaw: 0, pitch: 0.06, roll: 0 }));
  // Spell one figure: registered (and compiled in idle time) ahead where it can be.
  let ahead = null;
  const shapeFor = (text) => (ahead?.text === text ? ahead.name : textShape(text, fit, used));
  const prepare = (text) => { if (!field || !text) return; safe(() => { const name = textShape(text, fit, used); if (name === 'cg:compute') return; ahead = { text, name }; field.add([name]); field.prepare([name]); }); };
  const spell = (text, ms = MORPH_MS) => {
    root.dataset.fig = text.replace(/\n/g, ' ');
    if (!field) return;
    safe(() => {
      const name = shapeFor(text); ahead = null;
      if (name !== 'cg:compute') field.add([name]);
      field.setShape(name, { pin: 1e9, arrive: { from: [-0.4, 0, 0], ms } });
    });
  };
  const timeline = [];               // recorded events, for "Replay the call"
  const t0 = performance.now();
  let stage = null, stageAt = t0, finished = false, skipResolve = null;
  const meta = { provider: ai.provider, model: ai.model, events: timeline };
  const done = new Promise((resolve) => { skipResolve = resolve; });

  const setStage = (s) => {
    stage = s; stageAt = performance.now();
    if (!own.current()) return;   // a newer show has the root
    root.dataset.stage = s;
    delete root.dataset.fig; delete root.dataset.spell;
    safe(() => field?.set({ autonomy: AUTONOMY[s], palette: PALETTE[s] }));
    for (const k of STAGES) dom.railItems[k].className = k === s ? 'on' : STAGES.indexOf(k) < STAGES.indexOf(s) ? 'done' : '';
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dwell = (s) => wait(Math.max(0, (MIN_MS[s] || 0) - (performance.now() - stageAt)));
  let tokenCount = 0, lastSignal = 0, outText = '', reasonText = '';
  // Tokens are queued as they arrive and played through the COMPUTE stage at their recorded
  // pace (a fast edge model can answer before the show reaches COMPUTE), but never faster than a
  // reading pace (STREAM_MS) unless the backlog would take longer than STREAM_BUDGET to play.
  // The counters always show the call's real timings.
  const STREAM_MS = 34, STREAM_MAX = 80, STREAM_BUDGET = 5000;
  const queue = [];
  let drained = null;
  const drain = () => {
    drained ??= (async () => {
      await computing;
      let prevAt = null;
      const from = performance.now();
      for (;;) {
        const item = queue.shift();
        if (!item) {
          if (callOver) return;
          await wait(30);
          continue;
        }
        const [kind, text, at] = item;
        if (prevAt != null) {
          const left = STREAM_BUDGET - (performance.now() - from);
          await wait(Math.max(10, Math.min(Math.min(STREAM_MAX, Math.max(STREAM_MS, at - prevAt)), left / (queue.length + 1))));
        }
        prevAt = at;
        if (kind === 'reasoning') { reasonText = (reasonText + text).slice(-220); dom.reason.textContent = reasonText; }
        else {
          if (!tokenCount && meta.ttft != null) dom.stat('ttft', fmtMs(meta.ttft));
          // The whole text stays in the box (it shows its last lines): trimming a few characters a
          // token reflowed every line on every token. Trim rarely, at a line break.
          outText += text;
          if (outText.length > 1400) { const cut = outText.indexOf('\n', outText.length - 900); outText = outText.slice(cut > 0 ? cut + 1 : -900); }
          dom.out.textContent = outText;
        }
        tokenCount++; dom.stat('out', String(tokenCount)); signal();
      }
    })();
    return drained;
  };
  let callOver = false;
  const signal = () => {
    const now = performance.now();
    if (field && now - lastSignal > 33) { safe(() => field.signal(undefined, 14, 2)); lastSignal = now; }
  };
  const caption = (t) => { dom.caption.textContent = t; };

  setStage('telemetry');
  caption('The server re-simulates your run from its inputs…');
  safe(() => field?.setShape('cg:circuit', { pin: 1e9 }));
  const pulse = setInterval(() => safe(() => field?.signal(undefined, 30, 3)), 180);
  // Hard deadline: whatever happens to the network or the visuals, the words land.
  const deadline = setTimeout(() => { if (!finished) { if (!words) { words = fallbackWords(card); meta.error = meta.error || 'The judges took too long.'; } finish(); } }, Math.max(0, Math.min(35_000, deadlineMs)));
  // The call's own cancel: a restart or the title (abort), the deadline, Skip, the end of the show.
  const call = new AbortController();
  if (abort) { if (abort.aborted) call.abort(); else abort.addEventListener('abort', () => call.abort(), { once: true }); }

  let showText = null;          // promise: TEXT stage done
  let computing = null;          // promise: COMPUTE stage entered (one per show)
  let words = null, failure = null;

  const startCompute = () => {
    computing ??= (async () => {
      await showText;
      await dwell('text');
      setStage('compute');
      caption(`${shortModel(meta.model)} is writing the judges' remarks…`);
      safe(() => field?.setShape('cg:compute', { pin: 1e9, arrive: { from: [-0.6, 0, 0], ms: 700 } }));
    })();
    drain();
    return computing;
  };

  const handlers = {
    verify: (d) => {
      timeline.push(['verify', performance.now() - t0, d]);
      meta.verify = d;
      caption(`Verified: ${d.ticks.toLocaleString()} physics ticks replayed in ${fmtMs(d.ms)}. Score ${d.card.total.toFixed(1)}.`);
    },
    prompt: (d) => {
      timeline.push(['prompt', performance.now() - t0, d]);
      Object.assign(meta, { provider: d.provider, model: d.model, where: d.where, system: d.system, user: d.user });
      dom.set('model', shortModel(d.model));
      dom.set('vendor', `${d.providerLabel} · ${d.vendor}`);
      dom.set('where', d.where);
      dom.set('billed', d.provider === 'edge' ? 'COLD GAS · free allowance' : `Your ${d.providerLabel} key`);
      dom.stat('in', `~${d.inTokensEst}`);
      showText = (async () => {
        await dwell('telemetry').catch(() => {});
        setStage('text');
        caption('Your telemetry becomes text: the facts the model reads.');
        // The most telling figures make the short show; they play in flight order. Past FIG_MIN the
        // rest only fill time the call is still taking (no token yet, no answer).
        const all = figuresOf(card, t), keep = new Set(all.slice().sort((a, b) => a.pri - b.pri).slice(0, FIG_MIN));
        const figs = [...all.filter((x) => keep.has(x)), ...all.filter((x) => !keep.has(x))].slice(0, FIG_MAX);
        const order = figs.slice(0, FIG_MIN).sort((a, b) => all.indexOf(a) - all.indexOf(b)).concat(figs.slice(FIG_MIN));
        // No field (reduced motion, or it failed): nothing to spell, the old short beat.
        if (!field) { await wait(reduced ? 0 : 2400); return; }
        for (let i = 0; i < order.length && !finished; i++) {
          if (i >= FIG_MIN && (queue.length || callOver || words || failure)) break;
          spell(order[i].text, i ? MORPH_MS : 700);
          prepare(order[i + 1]?.text);
          await wait(i ? FIG_MS : FIG_MS + 250);
        }
      })();
    },
    reasoning: (d) => {
      timeline.push(['reasoning', performance.now() - t0, d]);
      startCompute();
      queue.push(['reasoning', d.t, performance.now()]);
    },
    token: (d) => {
      timeline.push(['token', performance.now() - t0, d]);
      startCompute();
      if (meta.ttft == null) meta.ttft = performance.now() - t0;
      queue.push(['token', d.t, performance.now()]);
    },
    note: (d) => { timeline.push(['note', performance.now() - t0, d]); meta.model = d.model; dom.set('model', shortModel(d.model)); },
    done: (d) => {
      timeline.push(['done', performance.now() - t0, d]);
      Object.assign(meta, d, { ok: true });
      words = d.words;
      showFinal = () => {
      dom.stat('in', String(d.inTokens)); dom.stat('out', String(d.outTokens));
      dom.stat('ttft', fmtMs(d.ttftMs)); dom.stat('rate', d.tokensPerSec ? `${d.tokensPerSec} tok/s` : '—');
      dom.stat('neurons', d.neurons != null ? String(d.neurons) : '—');
      dom.stat('cost', d.costUsd != null ? fmtUsd(d.costUsd) : 'By provider');
      };
    },
    error: (d) => {
      timeline.push(['error', performance.now() - t0, d]);
      failure = d;
      meta.error = d.message;
    },
  };

  let showFinal = null;
  const source = replay ? replayEvents(replay, handlers, call.signal) : streamPanel({ log, t, assist, ai, course }, handlers, { signal: call.signal });

  (async () => {
    try { await source; } catch (err) { if (finished) return; handlers.error({ message: 'The judges are offline.', fallback: true }); console.warn(err); }
    if (finished) return;
    if (!showText) handlers.prompt({ provider: ai.provider, providerLabel: PROVIDER_INFO[ai.provider]?.label || '', vendor: PROVIDER_INFO[ai.provider]?.vendor || '', model: ai.model, where: '—', inTokensEst: 0 });
    await startCompute().catch((err) => console.warn('theatre', err));
    callOver = true;
    await drain();
    showFinal?.();
    if (!words) {
      words = fallbackWords(card);
      caption(`${failure?.message || 'No answer.'} The panel speaks from the game's own lines.`);
      dom.set('billed', 'Nobody: local lines');
      await wait(900);
    }
    await dwell('compute');
    // The call's own numbers, spelled once known (the stream steps aside). Skipped when the
    // deadline is close: the verdict must still have its moment.
    const calls = meta.ok && field && performance.now() - t0 < deadlineMs - 9000 ? callFigures(meta) : [];
    if (calls.length) {
      root.dataset.spell = '';
      caption('The call, by its own numbers.');
      safe(() => field?.set({ autonomy: 0, palette: SPELL }));
      prepare(calls[0]);
      for (let i = 0; i < calls.length && !finished; i++) { spell(calls[i]); prepare(calls[i + 1]); await wait(CALL_MS); }
      if (finished) return;
    }
    setStage('app');
    caption('The words land in the app.');
    spell((card.verdict || 'JUDGED').toUpperCase().split(' ').join('\n'), 800);
    await wait(reduced ? 0 : 1900);
    finish();
  })();

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(pulse);
    clearTimeout(deadline);
    call.abort();   // the deadline or Skip ended the show: nothing more is read from the stream
    meta.words = words || fallbackWords(card);
    if (own.current()) root.classList.add('out');
    setTimeout(() => { const mine = own.current(); own.end(); releaseShapes(used); if (mine) { root.hidden = true; root.classList.remove('on', 'out'); } }, 650);
    skipResolve({ words: meta.words, meta });
  }
  abort?.addEventListener('abort', () => {
    if (finished) return;
    finished = true;
    clearInterval(pulse);
    clearTimeout(deadline);
    own.end();
    releaseShapes(used);
    root.hidden = true;
    root.classList.remove('on', 'out');
    skipResolve({ aborted: true, words: null, meta });
  }, { once: true });
  dom.skip.addEventListener('click', () => {
    // Skipping only hurries the show; the words still come from the call if it has answered.
    if (!words && !failure) { caption('Finishing the call…'); return; }
    finish();
  });
  return done;
}

// Replays a recorded call with its original timing (until `signal` cancels it).
async function replayEvents(timeline, handlers, signal = null) {
  const start = performance.now();
  for (const [ev, at, data] of timeline) {
    if (signal?.aborted) return;
    const delay = at - (performance.now() - start);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    handlers[ev]?.(data);
  }
}

// --- The quest designer: the same theatre, for a side quest (src/build/ai-quest.js) -----------------
//   PROMPT   the circuit: the wish, the catalogue, the bounds and the budget become a prompt
//   COMPUTE  the die: one signal per streamed token of JSON
//   CHECK    the schema gate's verdict in particle text (pieces placed, or why it was rejected)
//   QUEST    the quest's name; then it is laid out in the world
// Shorter than a judging (it's a side quest), but every number is the call's own. Resolves with
// { quest (validated by the server; the caller validates again) | null, meta }.
const Q_STAGES = ['prompt', 'compute', 'check', 'quest'];
const Q_MIN = { prompt: 1100, compute: 900, check: 1300 };
export function runQuestTheatre(root, { ai, wish, arena, seed, reduced = false, abort = null }) {
  registerShapes();
  root.classList.add('th-quest');
  const dom = buildDom(root, Q_STAGES);
  root.hidden = false;
  root.classList.remove('out');
  requestAnimationFrame(() => root.classList.add('on'));
  let field = null;
  const own = ownCanvas(() => { const f = field; field = null; if (f) safe(() => f.destroy()); });
  loadMonoBold();
  const geo = { R: 0 }, used = new Set();
  const fit = () => freeBox(root, geo);
  if (!reduced) safe(() => { field = create(dom.canvas, {
    container: root.querySelector('.th-canvas').parentElement, shapes: ['cg:circuit', 'cg:compute'], initial: 'cg:circuit',
    cycle: 0, palette: 'aurora', blank: true, interactive: false, stars: 60, autonomy: 0.3, depth: FIELD_DEPTH, intro: 0,
    count: (w) => (w < 700 ? 2400 : 3200), radius: (w, h) => (geo.R = Math.min(w * 0.42, h * 0.34)),
  }); });
  safe(() => field?.setPose({ yaw: 0, pitch: 0.06, roll: 0 }));
  const t0 = performance.now();
  const meta = { provider: ai.provider, model: ai.model, kind: 'quest' };
  let stage = null, stageAt = t0, finished = false, resolve;
  const done = new Promise((r) => { resolve = r; });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setStage = (s) => {
    stage = s; stageAt = performance.now(); if (!own.current()) return; root.dataset.stage = s;
    safe(() => field?.set({ autonomy: s === 'compute' ? 0.3 : s === 'prompt' ? 0.3 : 0, palette: s === 'check' || s === 'quest' ? SPELL : 'aurora' }));
    for (const k of Q_STAGES) dom.railItems[k].className = k === s ? 'on' : Q_STAGES.indexOf(k) < Q_STAGES.indexOf(s) ? 'done' : '';
  };
  const dwell = (s) => wait(reduced ? 0 : Math.max(0, (Q_MIN[s] || 0) - (performance.now() - stageAt)));
  const caption = (t) => { dom.caption.textContent = t; };
  const spell = (text) => { if (field) safe(() => { const n = textShape(text.split(' ').join('\n'), fit, used); if (n !== 'cg:compute') field.add([n]); field.setShape(n, { pin: 1e9, arrive: { from: [-1, 0, 0], ms: 650 } }); }); };
  let out = '', shown = '', tokens = 0, lastSignal = 0, result = null, failure = null, computing = null;
  setStage('prompt');
  caption(wish ? `Your wish becomes a prompt: “${wish.slice(0, 80)}” + the catalogue, the bounds, the budget.` : 'A prompt: the catalogue, the bounds, the budget. The model designs; the schema decides.');
  safe(() => field?.setShape('cg:circuit', { pin: 1e9 }));
  const pulse = setInterval(() => safe(() => field?.signal(undefined, 26, 3)), 200);
  const deadline = setTimeout(() => { if (!result && !failure) { failure = { message: 'The model took too long.' }; abortCall.abort(); } }, 35_000);
  const abortCall = new AbortController();
  abort?.addEventListener('abort', () => abortCall.abort(), { once: true });
  const startCompute = () => (computing ??= (async () => {
    await dwell('prompt');
    setStage('compute');
    caption(`${shortModel(meta.model)} is designing a quest as JSON…`);
    safe(() => field?.setShape('cg:compute', { pin: 1e9, arrive: { from: [-0.6, 0, 0], ms: 600 } }));
  })());
  const handlers = {
    prompt: (d) => {
      Object.assign(meta, { provider: d.provider, model: d.model, where: d.where, system: d.system, user: d.user });
      dom.set('model', shortModel(d.model)); dom.set('vendor', `${d.providerLabel} · ${d.vendor}`); dom.set('where', d.where);
      dom.set('billed', d.provider === 'edge' ? 'COLD GAS · free allowance' : `Your ${d.providerLabel} key`);
      dom.stat('in', `~${d.inTokensEst}`);
    },
    reasoning: (d) => { startCompute(); dom.reason.textContent = (dom.reason.textContent + d.t).slice(-200); },
    token: (d) => {
      startCompute();
      if (meta.ttft == null) { meta.ttft = performance.now() - t0; dom.stat('ttft', fmtMs(meta.ttft)); }
      out += d.t; tokens++; shown += d.t; if (shown.length > 1400) shown = shown.slice(-900); dom.out.textContent = shown; dom.stat('out', String(tokens));
      const now = performance.now();
      if (field && now - lastSignal > 33) { safe(() => field.signal(undefined, 14, 2)); lastSignal = now; }
    },
    done: (d) => {
      Object.assign(meta, d, { ok: !!d.quest });
      result = d;
      dom.stat('in', String(d.inTokens ?? '—')); dom.stat('out', String(d.outTokens ?? tokens));
      dom.stat('ttft', fmtMs(d.ttftMs)); dom.stat('rate', d.tokensPerSec ? `${d.tokensPerSec} tok/s` : '—');
      dom.stat('neurons', d.neurons != null ? String(d.neurons) : '—');
      dom.stat('cost', d.costUsd != null ? fmtUsd(d.costUsd) : d.provider === 'edge' ? '—' : 'By provider');
    },
    error: (d) => { failure = d; meta.error = d.message; },
  };
  (async () => {
    try { await streamQuest({ ai, wish, arena, seed }, handlers, { signal: abortCall.signal }); }
    catch (err) { if (!failure) failure = { message: 'The quest designer is offline.' }; console.warn(err); }
    if (finished) return;
    await startCompute();
    await dwell('compute');
    setStage('check');
    const q = result?.quest;
    if (q) {
      caption(`Schema: passed. ${q.pieces.length} pieces, ${q.pickups.length} power-ups, ${q.objectives.length} objective${q.objectives.length > 1 ? 's' : ''}, inside the bounds and the budget.`);
      spell(`${q.pieces.length} PIECES OK`);
    } else {
      const why = result?.errors?.[0] || failure?.message || 'No answer.';
      caption(`${result ? 'Schema: rejected' : 'No quest'} (${why}). The local generator lays one out instead.`);
      spell(result ? 'REJECTED' : 'OFFLINE');
      if (!result) dom.set('billed', 'Nobody: local generator');
    }
    await dwell('check');
    setStage('quest');
    caption(q ? `“${q.title}”. Laying it out…` : 'Laying out a quest from the local generator…');
    if (q) spell(q.title.toUpperCase().slice(0, 22));
    await wait(reduced ? 0 : 1300);
    finish();
  })();
  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(pulse); clearTimeout(deadline);
    if (own.current()) root.classList.add('out');
    setTimeout(() => { const mine = own.current(); own.end(); releaseShapes(used); if (mine) { root.hidden = true; root.classList.remove('on', 'out', 'th-quest'); } }, reduced ? 0 : 600);
    resolve({ quest: result?.quest || null, errors: result?.errors || null, raw: result?.raw || out, meta: { ...meta, error: failure?.message || null } });
  }
  dom.skip.addEventListener('click', () => { if (result || failure) finish(); else { caption('Finishing the call…'); } });
  abort?.addEventListener('abort', () => { if (!finished) { finished = true; clearInterval(pulse); clearTimeout(deadline); own.end(); releaseShapes(used); root.hidden = true; root.classList.remove('on', 'out', 'th-quest'); resolve({ quest: null, aborted: true, meta }); } }, { once: true });
  return done;
}
