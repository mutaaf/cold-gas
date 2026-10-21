// Free Drive's map, drawn on canvas at the screen's pixel density: the minimap in the HUD corner
// (north-up or heading-up, the car's arrow with a speed trail, the best run's ghost, the elevation
// profile with you on it) and, on a tap or M, the expanded map: the whole route with wheel / pinch
// zoom, drag to pan, the distance to go, and a tap on the road for its distance, elevation and
// grade there. Escape, ×, a tap outside or another tap on the minimap closes it.
//
// Budget: the minimap redraws at most 10 times a second and only when the car has moved a sample
// or turned a couple of degrees; the route is cached on an offscreen canvas for the north-up view.
// The expanded map redraws on interaction, and at most 10 times a second while the car moves.
import { fmtRoad, fmtLen, k as uk, u as uu } from '../units.js';

const INK = 'rgba(245,246,248,1)', INK2 = 'rgba(245,246,248,0.72)', INK3 = 'rgba(245,246,248,0.42)', HAIR = 'rgba(245,246,248,0.16)';
const TRAIL = 140;                 // positions in the speed trail (≈20 s at 7 Hz)
const MODE_KEY = 'coldgas.map.up';

const dprOf = () => Math.min(3, globalThis.devicePixelRatio || 1);
function fit(c) {
  const d = dprOf(), w = c.clientWidth || c.width, h = c.clientHeight || c.height;
  const W = Math.max(1, Math.round(w * d)), H = Math.max(1, Math.round(h * d));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w, h };
}
function arrow(g, x, y, rot, s = 1) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.beginPath(); g.arc(0, 0, 5.5, 0, Math.PI * 2); g.fillStyle = 'rgba(245,246,248,0.2)'; g.fill();
  g.lineWidth = 1.2; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.moveTo(0, -10); g.lineTo(4, -2.5); g.lineTo(-4, -2.5); g.closePath(); g.fillStyle = INK; g.fill();
  g.restore();
}

export function createMinimap(host, road, { endless = false, name = '', onToggle = () => {} } = {}) {
  let headingUp = false;
  try { headingUp = localStorage.getItem(MODE_KEY) === 'heading'; } catch { /* north-up */ }
  host.innerHTML = `
    <div class="fd-mapbox" role="button" tabindex="0" data-h-map aria-haspopup="dialog" aria-label="Map: open the full map (M)"><canvas class="fd-minic" data-h-minic></canvas>
      <span class="fd-maptag" data-h-maptag>${headingUp ? 'HDG' : 'N'}</span></div>
    <canvas class="fd-profc" data-h-profc aria-hidden="true"></canvas>`;
  const box = host.querySelector('[data-h-map]'), mini = host.querySelector('[data-h-minic]'), prof = host.querySelector('[data-h-profc]'), tag = host.querySelector('[data-h-maptag]');
  const sp = road.meta.spacing;
  const st = { i: 0, h: 0, x: road.x[0], z: road.z[0], speed: 0, time: null, drawnAt: 0, drawnI: -1, drawnH: 9, profI: -1, best: null, ghostI: -1, drawnG: -1 };
  const trail = new Float32Array(TRAIL * 3); let tn = 0, tLast = 0;
  let routeCache = null, routeKey = '', profCache = null, profKey = '';
  const bounds = () => {
    if (!endless && road.bounds) return road.bounds;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < road.n; i += 4) { const x = road.x[i], z = road.z[i]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    return { minX, maxX, minZ, maxZ };
  };
  const strideFor = (scale) => Math.max(1, Math.floor(1.4 / (sp * scale)));

  // Whole route, north up (route roads): a cached layer, rebuilt on a resize or a DPR change.
  function routeLayer(w, h) {
    const key = `${w}x${h}@${dprOf()}`;
    if (routeCache && routeKey === key) return routeCache;
    const b = road.bounds, span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ), s = (Math.min(w, h) - 14) / span;
    const ox = (w - (b.maxX - b.minX) * s) / 2, oz = (h - (b.maxZ - b.minZ) * s) / 2;
    const c = document.createElement('canvas'); c.width = Math.round(w * dprOf()); c.height = Math.round(h * dprOf());
    const g = c.getContext('2d'); g.setTransform(dprOf(), 0, 0, dprOf(), 0, 0);
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = INK3; g.lineWidth = 1.3;
    g.beginPath();
    const stride = strideFor(s);
    for (let i = 0; i < road.n; i += stride) { const X = ox + (road.x[i] - b.minX) * s, Y = oz + (road.z[i] - b.minZ) * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.lineTo(ox + (road.x[road.n - 1] - b.minX) * s, oz + (road.z[road.n - 1] - b.minZ) * s);
    g.stroke();
    routeCache = { c, s, ox, oz, b }; routeKey = key;
    return routeCache;
  }
  function drawMini() {
    const { g, w, h } = fit(mini);
    g.clearRect(0, 0, w, h);
    const local = endless || headingUp;
    if (!local) {
      const L = routeLayer(w, h), P = (x, z) => [L.ox + (x - L.b.minX) * L.s, L.oz + (z - L.b.minZ) * L.s];
      g.drawImage(L.c, 0, 0, w, h);
      // Done so far, the trail, the ends, the ghost, the car.
      g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = 1.7; g.beginPath();
      const stride = strideFor(L.s);
      for (let i = 0; i <= st.i; i += stride) { const [X, Y] = P(road.x[i], road.z[i]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
      const [ax, ay] = P(road.x[0], road.z[0]), [bx, by] = P(road.x[road.n - 1], road.z[road.n - 1]);
      g.fillStyle = INK2; g.beginPath(); g.arc(ax, ay, 2.5, 0, 7); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(bx, by, 2.8, 0, 7); g.fill();
      drawTrail(g, P);
      if (st.ghostI >= 0) ghost(g, ...P(road.x[st.ghostI], road.z[st.ghostI]));
      const [cx, cy] = P(st.x, st.z);
      arrow(g, cx, cy, st.h);
      return;
    }
    // Local: centred on the car; heading-up turns the world so the car points up.
    const R = endless ? 1500 : 900, s = (Math.min(w, h) / 2 - 6) / R, cosH = Math.cos(st.h), sinH = Math.sin(st.h);
    const P = (x, z) => {
      const dx = (x - st.x) * s, dz = (z - st.z) * s;
      return headingUp ? [w / 2 + dx * cosH + dz * sinH, h / 2 - dx * sinH + dz * cosH] : [w / 2 + dx, h / 2 + dz];
    };
    const reach = Math.ceil((R * 2.2) / sp), a = Math.max(0, st.i - reach), b = Math.min(road.n - 1, st.i + reach), stride = strideFor(s);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = INK3; g.lineWidth = 1.3; g.beginPath();
    for (let i = a; i <= b; i += stride) { const [X, Y] = P(road.x[i], road.z[i]); i === a ? g.moveTo(X, Y) : g.lineTo(X, Y); }
    g.stroke();
    g.strokeStyle = INK; g.lineWidth = 1.8; g.beginPath();
    for (let i = st.i; i <= Math.min(b, st.i + reach / 3); i += stride) { const [X, Y] = P(road.x[i], road.z[i]); i === st.i ? g.moveTo(X, Y) : g.lineTo(X, Y); }
    g.stroke();
    drawTrail(g, P);
    if (st.ghostI >= a && st.ghostI <= b) ghost(g, ...P(road.x[st.ghostI], road.z[st.ghostI]));
    arrow(g, w / 2, h / 2, headingUp ? 0 : st.h);
    // North, when the map turns.
    if (headingUp) { const nx = w / 2 - Math.sin(-st.h) * (w / 2 - 8), ny = h / 2 - Math.cos(-st.h) * (h / 2 - 8); g.fillStyle = INK2; g.font = '500 9px Geist Mono, ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny); }
  }
  // The speed trail: the last ≈20 s, older fainter, faster wider (ink only: colour is state on the HUD).
  function drawTrail(g, P) {
    const n = Math.min(tn, TRAIL);
    if (n < 2) return;
    g.lineCap = 'round';
    let prev = null;
    for (let k = n - 1; k >= 0; k--) {
      const j = ((tn - 1 - k) % TRAIL) * 3, p = P(trail[j], trail[j + 1]);
      if (prev) {
        const age = k / n, v = trail[j + 2];
        g.strokeStyle = `rgba(245,246,248,${(0.15 + 0.65 * (1 - age)).toFixed(2)})`;
        g.lineWidth = 1 + Math.min(3, v / 14);
        g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke();
      }
      prev = p;
    }
  }
  function ghost(g, x, y) {
    g.save(); g.setLineDash([2, 2]); g.strokeStyle = INK2; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.stroke(); g.restore();
  }
  // The elevation profile: the whole route (or 1.5 km either side on the endless road), you on it.
  function drawProf() {
    const { g, w, h } = fit(prof);
    const key = `${w}x${h}@${dprOf()}`;
    const a = endless ? Math.max(0, st.i - Math.round(1500 / sp)) : 0, b = endless ? Math.min(road.n - 1, st.i + Math.round(1500 / sp)) : road.n - 1;
    if (endless || !profCache || profKey !== key) {
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i <= b; i += 4) { lo = Math.min(lo, road.y[i]); hi = Math.max(hi, road.y[i]); }
      const span = Math.max(endless ? 20 : 1, hi - lo);
      const c = profCache?.c || document.createElement('canvas');
      c.width = Math.round(w * dprOf()); c.height = Math.round(h * dprOf());
      const pg = c.getContext('2d'); pg.setTransform(dprOf(), 0, 0, dprOf(), 0, 0); pg.clearRect(0, 0, w, h);
      const X = (i) => ((i - a) / Math.max(1, b - a)) * w, Y = (y) => h - 2 - ((y - lo) / span) * (h - 6);
      pg.beginPath(); pg.moveTo(0, h);
      const stride = Math.max(1, Math.floor((b - a) / (w * 1.5)));
      for (let i = a; i <= b; i += stride) pg.lineTo(X(i), Y(road.y[i]));
      pg.lineTo(w, Y(road.y[b])); pg.lineTo(w, h); pg.closePath();
      pg.fillStyle = 'rgba(245,246,248,0.12)'; pg.fill();
      pg.strokeStyle = 'rgba(245,246,248,0.5)'; pg.lineWidth = 1; pg.stroke();
      profCache = { c, a, b }; profKey = key;
    }
    g.clearRect(0, 0, w, h);
    g.drawImage(profCache.c, 0, 0, w, h);
    const X = (i) => ((i - profCache.a) / Math.max(1, profCache.b - profCache.a)) * w;
    if (st.ghostI >= 0) { g.strokeStyle = INK2; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(X(st.ghostI), 0); g.lineTo(X(st.ghostI), h); g.stroke(); g.setLineDash([]); }
    g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(st.i), 0); g.lineTo(X(st.i), h); g.stroke();
  }

  const toggleMode = () => {
    headingUp = !headingUp;
    try { localStorage.setItem(MODE_KEY, headingUp ? 'heading' : 'north'); } catch { /* not kept */ }
    tag.textContent = headingUp ? 'HDG' : 'N';
    st.drawnAt = 0; drawMini();
  };
  tag.addEventListener('click', (e) => { e.stopPropagation(); toggleMode(); });
  tag.title = 'North-up or heading-up';
  box.addEventListener('click', (e) => { onToggle(); if (e.detail > 0) box.blur(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onToggle(); } });

  return {
    // Every frame; draws only when it's due.
    update(i, heading, speed, time, x, z) {
      st.i = i; st.h = heading; st.speed = speed; st.time = time; st.x = x; st.z = z;
      const now = performance.now();
      if (now - tLast > 140) { const j = (tn % TRAIL) * 3; trail[j] = x; trail[j + 1] = z; trail[j + 2] = speed; tn++; tLast = now; }
      // The best run's ghost: where it was at this time (its pace, a time per 1 % of the route).
      if (st.best && time != null) {
        const p = st.best; let q = 0;
        while (q < 100 && p[q + 1] <= time) q++;
        const f = q >= 100 ? 1 : (time - p[q]) / Math.max(1e-3, p[q + 1] - p[q]);
        st.ghostI = Math.min(road.n - 1, Math.round(((q + Math.max(0, Math.min(1, f))) / 100) * (road.n - 1)));
      } else st.ghostI = -1;
      if (now - st.drawnAt < 100) return;
      const turned = Math.abs(heading - st.drawnH) > 0.035;
      if (i === st.drawnI && !turned && st.ghostI === st.drawnG) return;
      st.drawnAt = now; st.drawnI = i; st.drawnH = heading; st.drawnG = st.ghostI;
      drawMini();
      if (i !== st.profI) { drawProf(); st.profI = i; }
    },
    setBest(pace) { st.best = Array.isArray(pace) && pace.length === 101 ? pace : null; },
    redraw() { routeCache = null; profCache = null; st.drawnAt = 0; drawMini(); drawProf(); },
    toggleMode, state: st, name,
    bounds,
  };
}

// The expanded map: a big canvas over the stage (not a pause), with the route, its elevation, and
// the numbers at any point you tap.
export function createMapOverlay(root, road, mini, { endless = false, name = '', onClose = () => {} } = {}) {
  const el = document.createElement('section');
  el.className = 'fd-xmap';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Map of ${name}`);
  el.innerHTML = `
    <div class="xm-panel">
      <header class="xm-head">
        <div class="xm-title"><p class="eyebrow">Map · ${endless ? 'the road so far' : 'whole route'}</p><h3>${name.replace(/[<>&]/g, '')}</h3></div>
        <dl class="xm-stats"><div><dt data-xm-togo-l>${endless ? 'Driven' : 'To go'}</dt><dd data-xm-togo data-units>—</dd></div><div><dt>Elevation</dt><dd data-xm-ele data-units>—</dd></div></dl>
        <div class="xm-btns"><button type="button" class="chip" data-xm-fit title="Fit the whole route">Fit</button><button type="button" class="chip" data-xm-follow aria-pressed="false" title="Follow the car">Follow</button>
          <button type="button" class="xm-x" data-xm-close aria-label="Close the map (Esc)">×</button></div>
      </header>
      <div class="xm-stage"><canvas class="xm-map" data-xm-map></canvas>
        <div class="xm-tip" data-xm-tip hidden></div>
        <p class="xm-hint">Scroll or pinch to zoom · drag to pan · tap the road · <kbd>M</kbd> or <kbd>Esc</kbd> to close</p></div>
      <canvas class="xm-prof" data-xm-prof aria-label="Elevation profile: tap for the numbers there"></canvas>
    </div>`;
  document.body.appendChild(el);   // above the HUD's stacking context and the touch controls
  const $ = (s) => el.querySelector(s);
  const map = $('[data-xm-map]'), profC = $('[data-xm-prof]'), tip = $('[data-xm-tip]');
  const sp = road.meta.spacing;
  const view = { cx: 0, cz: 0, s: 1, follow: false };
  let pick = -1, open = false, raf = 0, lastDraw = 0, lastI = -1;
  const ptrs = new Map();
  let drag = null;

  function fitAll() {
    const b = mini.bounds(), { w, h } = { w: map.clientWidth, h: map.clientHeight };
    view.cx = (b.minX + b.maxX) / 2; view.cz = (b.minZ + b.maxZ) / 2;
    view.s = Math.min((w - 40) / Math.max(50, b.maxX - b.minX), (h - 40) / Math.max(50, b.maxZ - b.minZ));
  }
  const toScreen = (x, z, w, h) => [w / 2 + (x - view.cx) * view.s, h / 2 + (z - view.cz) * view.s];
  const toWorld = (X, Y, w, h) => [view.cx + (X - w / 2) / view.s, view.cz + (Y - h / 2) / view.s];

  function draw() {
    raf = 0; if (!open) return;
    lastDraw = performance.now();
    const st = mini.state;
    if (view.follow) { view.cx = st.x; view.cz = st.z; }
    const { g, w, h } = fit(map);
    g.clearRect(0, 0, w, h);
    // A 1 mi / 1 km grid, for scale.
    const unit = 1 / uk('dist'), step = unit * (view.s * unit < 40 ? 5 : view.s * unit > 400 ? 0.2 : 1);
    g.strokeStyle = 'rgba(245,246,248,0.05)'; g.lineWidth = 1; g.beginPath();
    const [x0, z0] = toWorld(0, 0, w, h), [x1, z1] = toWorld(w, h, w, h);
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) { const X = toScreen(x, 0, w, h)[0]; g.moveTo(X, 0); g.lineTo(X, h); }
    for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) { const Y = toScreen(0, z, w, h)[1]; g.moveTo(0, Y); g.lineTo(w, Y); }
    g.stroke();
    // The road: shaded by its grade (steeper brighter), driven part in ink.
    const stride = Math.max(1, Math.floor(1.2 / (sp * view.s)));
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.lineWidth = Math.max(2, Math.min(7, 7 * sp * view.s));
    g.strokeStyle = 'rgba(245,246,248,0.3)'; g.beginPath();
    for (let i = 0; i < road.n; i += stride) { const [X, Y] = toScreen(road.x[i], road.z[i], w, h); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke();
    g.strokeStyle = INK; g.lineWidth = Math.max(1.6, g.lineWidth * 0.55); g.beginPath();
    for (let i = 0; i <= st.i; i += stride) { const [X, Y] = toScreen(road.x[i], road.z[i], w, h); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke();
    // Ends, ghost, pick, car.
    const [ax, ay] = toScreen(road.x[0], road.z[0], w, h);
    g.fillStyle = INK2; g.beginPath(); g.arc(ax, ay, 4, 0, 7); g.fill();
    if (!endless) { const [bx, by] = toScreen(road.x[road.n - 1], road.z[road.n - 1], w, h); g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(bx, by, 6, 0, 7); g.stroke(); g.beginPath(); g.arc(bx, by, 2.5, 0, 7); g.fillStyle = INK; g.fill(); }
    if (st.ghostI >= 0) { const [gx, gy] = toScreen(road.x[st.ghostI], road.z[st.ghostI], w, h); g.save(); g.setLineDash([3, 3]); g.strokeStyle = INK2; g.lineWidth = 1.4; g.beginPath(); g.arc(gx, gy, 7, 0, 7); g.stroke(); g.restore(); }
    if (pick >= 0) {
      const [px, py] = toScreen(road.x[pick], road.z[pick], w, h);
      g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.arc(px, py, 9, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(px - 14, py); g.lineTo(px - 5, py); g.moveTo(px + 5, py); g.lineTo(px + 14, py); g.moveTo(px, py - 14); g.lineTo(px, py - 5); g.moveTo(px, py + 5); g.lineTo(px, py + 14); g.stroke();
      tip.style.transform = `translate(${Math.round(Math.min(w - 230, Math.max(8, px + 14)))}px, ${Math.round(Math.min(h - 120, Math.max(8, py - 40)))}px)`;
    }
    const [cx, cy] = toScreen(st.x, st.z, w, h);
    arrow(g, cx, cy, st.h, 1.3);
    // The header's numbers.
    const togo = endless ? st.i * sp : Math.max(0, road.length - st.i * sp);
    setText($('[data-xm-togo]'), fmtRoad(togo));
    setText($('[data-xm-ele]'), fmtLen(road.y[st.i] ?? 0, 0));
    drawProf();
  }
  function drawProf() {
    const { g, w, h } = fit(profC);
    g.clearRect(0, 0, w, h);
    const n = road.n;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i += 4) { lo = Math.min(lo, road.y[i]); hi = Math.max(hi, road.y[i]); }
    const span = Math.max(20, hi - lo), X = (i) => (i / Math.max(1, n - 1)) * w, Y = (y) => h - 14 - ((y - lo) / span) * (h - 26);
    const stride = Math.max(1, Math.floor(n / (w * 1.5)));
    g.beginPath(); g.moveTo(0, h - 12);
    for (let i = 0; i < n; i += stride) g.lineTo(X(i), Y(road.y[i]));
    g.lineTo(w, Y(road.y[n - 1])); g.lineTo(w, h - 12); g.closePath();
    g.fillStyle = 'rgba(245,246,248,0.1)'; g.fill(); g.strokeStyle = 'rgba(245,246,248,0.55)'; g.lineWidth = 1; g.stroke();
    // Driven part brighter.
    g.save(); g.beginPath(); g.rect(0, 0, X(mini.state.i), h); g.clip();
    g.beginPath(); g.moveTo(0, h - 12); for (let i = 0; i <= mini.state.i; i += stride) g.lineTo(X(i), Y(road.y[i])); g.lineTo(X(mini.state.i), h - 12); g.closePath();
    g.fillStyle = 'rgba(245,246,248,0.2)'; g.fill(); g.restore();
    g.font = '400 11px Geist Mono, ui-monospace, monospace'; g.fillStyle = INK2; g.textBaseline = 'bottom';
    g.textAlign = 'left';
    const v = (y, alt) => `${Math.round(y * uk('len', alt)).toLocaleString('en-US')} ${uu('len', alt)}`;
    g.fillText(w > 520 ? `Elevation · top ${v(hi)} (${v(hi, true)}) · low ${v(lo)} (${v(lo, true)})` : `top ${v(hi)} · ${v(hi, true)}   low ${v(lo)} · ${v(lo, true)}`, 6, 13);
    g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(mini.state.i), 0); g.lineTo(X(mini.state.i), h - 12); g.stroke();
    if (pick >= 0) { g.setLineDash([3, 3]); g.strokeStyle = INK2; g.beginPath(); g.moveTo(X(pick), 0); g.lineTo(X(pick), h - 12); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(X(pick), Y(road.y[pick]), 3, 0, 7); g.fillStyle = INK; g.fill(); }
  }
  const setText = (e, t) => { if (e.textContent !== t) e.textContent = t; };
  const schedule = () => { if (open && !raf) raf = requestAnimationFrame(draw); };

  // The numbers at a sample: how far along, how far from you, elevation, grade.
  function choose(i) {
    pick = i;
    if (i < 0) { tip.hidden = true; schedule(); return; }
    const at = i * sp, me = mini.state.i * sp, d = at - me;
    const a = Math.max(0, i - 3), b = Math.min(road.n - 1, i + 3);
    const grade = ((road.y[b] - road.y[a]) / Math.max(1, (b - a) * sp)) * 100;
    tip.innerHTML = `<b>${fmtRoad(at)}</b><span>${endless ? 'from the start' : `from the start · ${fmtRoad(Math.max(0, road.length - at))} to the end`}</span>
      <dl><dt>From you</dt><dd>${Math.abs(d) < 5 ? 'here' : `${fmtRoad(Math.abs(d))} ${d > 0 ? 'ahead' : 'behind'}`}</dd><dt>Elevation</dt><dd>${fmtLen(road.y[i], 0)}</dd><dt>Grade</dt><dd>${grade >= 0 ? '+' : '−'}${Math.abs(grade).toFixed(1)} %</dd></dl>`;
    tip.hidden = false;
    schedule();
  }
  function nearest(X, Y) {
    const w = map.clientWidth, h = map.clientHeight;
    let best = -1, bd = 26 * 26;
    const stride = Math.max(1, Math.floor(0.5 / (sp * view.s)));
    for (let i = 0; i < road.n; i += stride) {
      const [sx, sy] = toScreen(road.x[i], road.z[i], w, h), d = (sx - X) ** 2 + (sy - Y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function zoomAt(X, Y, f) {
    const w = map.clientWidth, h = map.clientHeight, [wx, wz] = toWorld(X, Y, w, h);
    view.s = Math.max(0.002, Math.min(4, view.s * f));
    view.cx = wx - (X - w / 2) / view.s; view.cz = wz - (Y - h / 2) / view.s;
    setFollow(false); schedule();
  }
  const setFollow = (on) => { view.follow = on; $('[data-xm-follow]').setAttribute('aria-pressed', String(on)); };
  map.addEventListener('wheel', (e) => { e.preventDefault(); const r = map.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  map.addEventListener('pointerdown', (e) => {
    map.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (ptrs.size === 1) drag = { moved: 0 };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { moved: 99, pinch: Math.hypot(a.x - b.x, a.y - b.y) }; }
  });
  map.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p || !drag) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 5) { view.cx -= dx / view.s; view.cz -= dy / view.s; setFollow(false); schedule(); }
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = map.getBoundingClientRect();
      if (drag.pinch > 0) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / drag.pinch);
      drag.pinch = d;
    }
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (p && drag && drag.moved <= 5 && ptrs.size === 0) { const r = map.getBoundingClientRect(); choose(nearest(e.clientX - r.left, e.clientY - r.top)); }
    if (!ptrs.size) drag = null;
  };
  map.addEventListener('pointerup', up);
  map.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) drag = null; });
  profC.addEventListener('pointerdown', (e) => { const r = profC.getBoundingClientRect(); choose(Math.round(((e.clientX - r.left) / r.width) * (road.n - 1))); });
  $('[data-xm-fit]').addEventListener('click', (e) => { fitAll(); setFollow(false); schedule(); if (e.detail) e.currentTarget.blur(); });
  $('[data-xm-follow]').addEventListener('click', (e) => { setFollow(!view.follow); if (view.follow) view.s = Math.max(view.s, 0.25); schedule(); if (e.detail) e.currentTarget.blur(); });
  $('[data-xm-close]').addEventListener('click', () => close());
  // Escape closes the map before the drive hears it (it would pause); a tap outside closes it too.
  const onKey = (e) => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  const onDown = (e) => { if (open && !el.querySelector('.xm-panel').contains(e.target) && !e.target.closest?.('[data-h-map]')) close(); };
  addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  const onResize = () => schedule();
  addEventListener('resize', onResize);

  function show() {
    open = true; el.classList.add('on'); el.hidden = false;
    fitAll(); pick = -1; tip.hidden = true;
    mini.state.drawnAt = 0;
    draw();
  }
  function close() {
    if (!open) return;
    open = false; el.classList.remove('on'); el.hidden = true;
    cancelAnimationFrame(raf); raf = 0;
    onClose();
  }
  el.hidden = true;
  return {
    toggle() { if (open) close(); else show(); },
    close, get open() { return open; },
    // Every frame from the HUD: redraw only when the car moved, at most 10 Hz.
    tick() { if (!open) return; const i = mini.state.i; if (i !== lastI && performance.now() - lastDraw > 100) { lastI = i; schedule(); } },
    unitsChanged() { if (open) { if (pick >= 0) choose(pick); schedule(); } },
    dispose() { close(); removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); removeEventListener('resize', onResize); el.remove(); },
  };
}
