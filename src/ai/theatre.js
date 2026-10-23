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
import monoBoldUrl from '@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2?url';

const STAGES = ['telemetry', 'text', 'compute', 'app'];
// Each morph needs time to read; the call itself usually finishes inside these.
// TEXT holds long enough after its 700 ms arrival for the figures to be read (~1.7 s settled).
const MIN_MS = { telemetry: 1700, text: 2400, compute: 1500 };
// How alive the field is per stage. Text stages hold still (no drifting, place-trading or scouts)
// so the particle letters stay crisp; the circuit and the die breathe.
const AUTONOMY = { telemetry: 0.3, text: 0, compute: 0.3, app: 0 };
// While the field spells something, its points burn brighter (same aurora hue, lifted toward
// white) and far points fade toward a light fog instead of the dark one, so letters read as light.
const SPELL = { preset: 'aurora', point: [176, 255, 228], accent: [176, 255, 228], glow: [150, 245, 210], fog: [120, 180, 170] };
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

let textSeq = 0;
// Particle text. The words stack one per line, so each glyph gets several times the particles
// and the height to read (one 17-character line was ~17 px a letter of scattered dots on a 390 px
// phone, ~28 px on a laptop). Most particles go to the outlines (edges) so the letters read crisp,
// and the shape is flat (depth 0) so nothing fogs toward the background colour. On a wide stage
// the stack is scaled down to stay between the caption and the cards.
function textShape(text, narrow) {
  const name = `cg:text:${++textSeq}`;
  try {
    register(name, fromText(text.split(' ').join('\n'), { font: '700 160px "Geist Mono", ui-monospace, monospace', edges: 0.72, depth: 0, scale: narrow ? 0.86 : 0.66 }));
    return name;
  } catch (err) {
    console.warn('theatre text shape', err);
    return 'cg:compute';
  }
}

// Visuals must never block the judges' words: any failure in the field is logged and skipped.
const safe = (fn) => { try { fn(); } catch (err) { console.warn('theatre visual', err); } };

// --- DOM ------------------------------------------------------------------------------------------
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtUsd = (u) => (u == null ? '—' : u < 0.0001 ? `$${u.toFixed(6)}` : `$${u.toFixed(4)}`);

function buildDom(root, stages = STAGES) {
  root.innerHTML = '';
  const canvas = el('canvas', 'th-canvas');
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
  loadMonoBold();
  const narrow = () => root.clientWidth < 560;
  if (!reduced) safe(() => { field = create(dom.canvas, {
    container: root.querySelector('.th-canvas').parentElement, shapes: ['cg:circuit', 'cg:compute'], initial: 'cg:circuit',
    cycle: 0, palette: 'aurora', blank: true, interactive: false, stars: 60, autonomy: 0.3, depth: 3.0, intro: 0,
    count: (w) => (w < 700 ? 2600 : 3600), radius: (w, h) => Math.min(w * 0.42, h * 0.36),
  }); });
  const timeline = [];               // recorded events, for "Replay the call"
  const t0 = performance.now();
  let stage = null, stageAt = t0, finished = false, skipResolve = null;
  const meta = { provider: ai.provider, model: ai.model, events: timeline };
  const done = new Promise((resolve) => { skipResolve = resolve; });

  const setStage = (s) => {
    stage = s; stageAt = performance.now();
    root.dataset.stage = s;
    safe(() => field?.set({ autonomy: AUTONOMY[s], palette: PALETTE[s] }));
    for (const k of STAGES) dom.railItems[k].className = k === s ? 'on' : STAGES.indexOf(k) < STAGES.indexOf(s) ? 'done' : '';
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dwell = (s) => wait(Math.max(0, (MIN_MS[s] || 0) - (performance.now() - stageAt)));
  let tokenCount = 0, lastSignal = 0, outText = '', reasonText = '';
  // Tokens are queued as they arrive and played through the COMPUTE stage at their recorded
  // pace (a fast edge model can answer before the show reaches COMPUTE). The counters always
  // show the call's real timings.
  const queue = [];
  let drained = null;
  const drain = () => {
    drained ??= (async () => {
      await computing;
      let prevAt = null;
      for (;;) {
        const item = queue.shift();
        if (!item) {
          if (callOver) return;
          await wait(30);
          continue;
        }
        const [kind, text, at] = item;
        if (prevAt != null) await wait(Math.min(45, Math.max(12, at - prevAt)));
        prevAt = at;
        if (kind === 'reasoning') { reasonText = (reasonText + text).slice(-220); dom.reason.textContent = reasonText; }
        else {
          if (!tokenCount && meta.ttft != null) dom.stat('ttft', fmtMs(meta.ttft));
          outText += text; dom.out.textContent = outText.slice(-360);
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
        const f = card.facts;
        caption('Your telemetry becomes text: the facts the model reads.');
        if (field) safe(() => {
          const name = textShape(f.course === 'wall' ? `${f.height}M ${f.invertedS}S ${f.sink}M/S` : f.course === 'show' ? `${f.height}M ${f.rollDeg}° ${f.sink}M/S` : `${f.rollDeg}° ${f.apex}M ${f.sink}M/S`, narrow());
          if (name !== 'cg:compute') field.add([name]);
          field.setShape(name, { pin: 1e9, arrive: { from: [-1, 0, 0], ms: 700 } });
        });
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
      dom.stat('cost', d.costUsd != null ? fmtUsd(d.costUsd) : 'Billed by provider');
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
    setStage('app');
    caption('The words land in the app.');
    if (field) safe(() => {
      const name = textShape((card.verdict || 'JUDGED').toUpperCase(), narrow());
      if (name !== 'cg:compute') field.add([name]);
      field.setShape(name, { pin: 1e9, arrive: { from: [0, 0, 0], ms: 800 } });
    });
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
    root.classList.add('out');
    setTimeout(() => { safe(() => field?.destroy()); root.hidden = true; root.classList.remove('on', 'out'); }, 650);
    skipResolve({ words: meta.words, meta });
  }
  abort?.addEventListener('abort', () => {
    if (finished) return;
    finished = true;
    clearInterval(pulse);
    clearTimeout(deadline);
    safe(() => field?.destroy());
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
  loadMonoBold();
  const narrow = () => root.clientWidth < 560;
  if (!reduced) safe(() => { field = create(dom.canvas, {
    container: root.querySelector('.th-canvas').parentElement, shapes: ['cg:circuit', 'cg:compute'], initial: 'cg:circuit',
    cycle: 0, palette: 'aurora', blank: true, interactive: false, stars: 60, autonomy: 0.3, depth: 3.0, intro: 0,
    count: (w) => (w < 700 ? 2400 : 3200), radius: (w, h) => Math.min(w * 0.42, h * 0.34),
  }); });
  const t0 = performance.now();
  const meta = { provider: ai.provider, model: ai.model, kind: 'quest' };
  let stage = null, stageAt = t0, finished = false, resolve;
  const done = new Promise((r) => { resolve = r; });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setStage = (s) => {
    stage = s; stageAt = performance.now(); root.dataset.stage = s;
    safe(() => field?.set({ autonomy: s === 'compute' ? 0.3 : s === 'prompt' ? 0.3 : 0, palette: s === 'check' || s === 'quest' ? SPELL : 'aurora' }));
    for (const k of Q_STAGES) dom.railItems[k].className = k === s ? 'on' : Q_STAGES.indexOf(k) < Q_STAGES.indexOf(s) ? 'done' : '';
  };
  const dwell = (s) => wait(reduced ? 0 : Math.max(0, (Q_MIN[s] || 0) - (performance.now() - stageAt)));
  const caption = (t) => { dom.caption.textContent = t; };
  const spell = (text) => { if (field) safe(() => { const n = textShape(text, narrow()); if (n !== 'cg:compute') field.add([n]); field.setShape(n, { pin: 1e9, arrive: { from: [-1, 0, 0], ms: 650 } }); }); };
  let out = '', tokens = 0, lastSignal = 0, result = null, failure = null, computing = null;
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
      out += d.t; tokens++; dom.out.textContent = out.slice(-360); dom.stat('out', String(tokens));
      const now = performance.now();
      if (field && now - lastSignal > 33) { safe(() => field.signal(undefined, 14, 2)); lastSignal = now; }
    },
    done: (d) => {
      Object.assign(meta, d, { ok: !!d.quest });
      result = d;
      dom.stat('in', String(d.inTokens ?? '—')); dom.stat('out', String(d.outTokens ?? tokens));
      dom.stat('ttft', fmtMs(d.ttftMs)); dom.stat('rate', d.tokensPerSec ? `${d.tokensPerSec} tok/s` : '—');
      dom.stat('neurons', d.neurons != null ? String(d.neurons) : '—');
      dom.stat('cost', d.costUsd != null ? fmtUsd(d.costUsd) : d.provider === 'edge' ? '—' : 'Billed by provider');
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
    root.classList.add('out');
    setTimeout(() => { safe(() => field?.destroy()); root.hidden = true; root.classList.remove('on', 'out', 'th-quest'); }, reduced ? 0 : 600);
    resolve({ quest: result?.quest || null, errors: result?.errors || null, raw: result?.raw || out, meta: { ...meta, error: failure?.message || null } });
  }
  dom.skip.addEventListener('click', () => { if (result || failure) finish(); else { caption('Finishing the call…'); } });
  abort?.addEventListener('abort', () => { if (!finished) { finished = true; clearInterval(pulse); clearTimeout(deadline); safe(() => field?.destroy()); root.hidden = true; root.classList.remove('on', 'out', 'th-quest'); resolve({ quest: null, aborted: true, meta }); } }, { once: true });
  return done;
}
