// Free Drive's DOM: the road picker on the title, and the driving HUD (road, speed, elevation,
// grade, distance, a minimap of the whole route and its elevation profile, the run timer, the
// data credits). Updated in place: text only changes when the rounded value does.
import { OSM_CREDIT } from './manifest.js';

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtTime = (t) => {
  if (!(t >= 0)) return '–:––.–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

// A route's silhouette as an SVG path in a w×h box (the manifest stores it normalised 0–1).
function silhouettePath(r, w, h, pad = 6) {
  const pts = r.silhouette, sx = r.aspectX || 1, sz = r.aspect || 1;
  const k = Math.min((w - 2 * pad) / sx, (h - 2 * pad) / sz);
  const ox = (w - sx * k) / 2, oz = (h - sz * k) / 2;
  let d = '';
  for (let i = 0; i < pts.length; i += 2) d += `${i ? 'L' : 'M'}${(ox + pts[i] * k).toFixed(1)} ${(oz + pts[i + 1] * k).toFixed(1)}`;
  const n = pts.length;
  return { d, start: [ox + pts[0] * k, oz + pts[1] * k], end: [ox + pts[n - 2] * k, oz + pts[n - 1] * k] };
}
function profilePath(r, w, h) {
  const p = r.profile, lo = Math.min(...p), hi = Math.max(...p), span = Math.max(1, hi - lo);
  let d = `M0 ${h}`;
  p.forEach((v, i) => { d += `L${((i / (p.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - lo) / span) * (h - 6)).toFixed(1)}`; });
  return `${d}L${w} ${h}Z`;
}

export function renderPicker(root, roads, { selected, tod, seed = '', onPick, onTod, onDrive, onBack, onSeed = () => {} }) {
  root.innerHTML = `
    <div class="fd-sheet" role="dialog" aria-modal="true" aria-labelledby="fd-title">
      <header class="fd-head">
        <p class="eyebrow">Free Drive · real roads, open data</p>
        <h2 id="fd-title">Pick a road</h2>
        <p class="fd-lede">Famous roads rebuilt from OpenStreetMap and open elevation data. Same car, same physics. No score, no judges: just the road.</p>
      </header>
      <div class="fd-cards" role="radiogroup" aria-label="Road">
        ${roads.map((r) => {
          const s = silhouettePath(r, 132, 96);
          return `<button type="button" class="fd-card" role="radio" aria-checked="${r.id === selected}" data-road="${r.id}">
            <svg class="fd-sil" viewBox="0 0 132 96" aria-hidden="true"><path d="${s.d}" /><circle cx="${s.start[0].toFixed(1)}" cy="${s.start[1].toFixed(1)}" r="2.6" class="a" /><circle cx="${s.end[0].toFixed(1)}" cy="${s.end[1].toFixed(1)}" r="2.6" class="b" /></svg>
            <span class="fd-name">${esc(r.name)}</span>
            <span class="fd-local">${esc(r.local)}</span>
            <span class="fd-country">${esc(r.country)}</span>
            <span class="fd-cstats"><b>${r.lengthKm.toFixed(1)}</b> km · <b>+${fmtInt(r.gain)}</b> m · top <b>${fmtInt(r.maxEle)}</b> m${r.hairpins ? ` · <b>${r.hairpins}</b> hairpins` : ''}</span>
            <svg class="fd-prof" viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true"><path d="${profilePath(r, 160, 28)}" /></svg>
            <span class="fd-blurb">${esc(r.blurb)}</span>
          </button>`;
        }).join('')}
        <div class="fd-endless" role="radio" tabindex="0" aria-checked="${selected === 'endless'}" data-road="endless">
          <svg class="fd-sil" viewBox="0 0 132 96" aria-hidden="true"><path d="M8 88 C 30 70, 18 52, 44 44 S 70 30, 62 18 S 96 6, 124 4" /><path class="far" d="M8 70 L 30 52 L 46 60 L 70 30 L 88 46 L 106 22 L 124 34" /></svg>
          <span class="fd-name">Endless</span>
          <span class="fd-local">A road that never ends, built as you drive</span>
          <span class="fd-country">Procedural · mountain · coast · desert · forest</span>
          <span class="fd-seed"><label>Seed <input type="text" data-fd-seed value="${esc(seed)}" maxlength="24" spellcheck="false" autocomplete="off" aria-label="World seed" /></label><span role="button" tabindex="0" class="fd-reseed" data-fd-reseed title="New seed" aria-label="New seed">↻</span></span>
          <span class="fd-blurb">Same seed, same world, anywhere: share it as a link.</span>
        </div>
      </div>
      <div class="fd-actions">
        <div class="seg fd-tod" role="radiogroup" aria-label="Time of day">
          <button type="button" role="radio" data-tod="day" aria-checked="${tod === 'day'}">Day</button>
          <button type="button" role="radio" data-tod="dusk" aria-checked="${tod === 'dusk'}">Dusk</button>
        </div>
        <button type="button" class="btn primary" data-fd-go>Drive</button>
        <button type="button" class="btn link" data-fd-back>Back</button>
      </div>
      <div class="fd-loading" data-fd-loading hidden><span data-fd-load-label>Loading</span><i><b data-fd-load-bar></b></i></div>
      <p class="fd-credit">Roads ${esc(OSM_CREDIT)} · Terrain: AWS Terrain Tiles (Mapzen/Tilezen) from EU-DEM (Copernicus), USGS 3DEP, SRTM, ETOPO1, © Kartverket</p>
    </div>`;
  const seedIn = root.querySelector('[data-fd-seed]');
  seedIn.addEventListener('click', (e) => { e.stopPropagation(); onPick('endless'); });
  seedIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { onSeed(seedIn.value.trim()); onPick('endless'); onDrive(); } });
  seedIn.addEventListener('input', () => onSeed(seedIn.value.trim()));
  const reseed = root.querySelector('[data-fd-reseed]');
  const newSeed = (e) => { e.stopPropagation(); e.preventDefault(); seedIn.value = randomSeed(); onSeed(seedIn.value); onPick('endless'); };
  reseed.addEventListener('click', newSeed);
  reseed.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') newSeed(e); });
  root.querySelectorAll('[data-road]').forEach((b) => {
    b.addEventListener('click', () => { onPick(b.dataset.road); });
    if (b.tagName === 'DIV') b.addEventListener('keydown', (e) => { if (e.target === b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(b.dataset.road); if (e.key === 'Enter') onDrive(); } });
    b.addEventListener('dblclick', () => { onPick(b.dataset.road); onDrive(); });
  });
  root.querySelectorAll('[data-tod]').forEach((b) => b.addEventListener('click', () => onTod(b.dataset.tod)));
  root.querySelector('[data-fd-go]').addEventListener('click', onDrive);
  root.querySelector('[data-fd-back]').addEventListener('click', onBack);
  // Arrow keys move between cards (a radio group).
  root.querySelector('.fd-cards').addEventListener('keydown', (e) => {
    if (e.target.closest('[data-fd-seed]')) return;
    const ids = [...roads.map((r) => r.id), 'endless'], i = ids.indexOf(root.querySelector('[data-road][aria-checked="true"]')?.dataset.road);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); const n = ids[(i + 1) % ids.length]; onPick(n); root.querySelector(`[data-road="${n}"]`).focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); const n = ids[(i - 1 + ids.length) % ids.length]; onPick(n); root.querySelector(`[data-road="${n}"]`).focus(); }
  });
  return {
    select(id) { root.querySelectorAll('[data-road]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.road === id))); },
    tod(id) { root.querySelectorAll('[data-tod]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tod === id))); },
    loading(on, frac = 0, label = '') {
      const el = root.querySelector('[data-fd-loading]');
      el.hidden = !on;
      root.querySelector('[data-fd-go]').disabled = on;
      if (on) { root.querySelector('[data-fd-load-bar]').style.transform = `scaleX(${frac})`; root.querySelector('[data-fd-load-label]').textContent = label; }
    },
  };
}

// A short, speakable seed: two syllable words and a number.
const SYL = ['ka', 'lo', 'mi', 'ra', 'to', 'ne', 'su', 'vi', 'da', 'ze', 'po', 'lu', 'ma', 'ri', 'so', 'te'];
export function randomSeed() {
  const r = new Uint32Array(2);
  (globalThis.crypto || { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; } }).getRandomValues(r);
  const w = (n) => SYL[n & 15] + SYL[(n >> 4) & 15] + SYL[(n >> 8) & 15];
  return `${w(r[0])}-${w(r[0] >> 12)}-${(r[1] % 900) + 100}`;
}

// The endless road's HUD: the same instruments, with the distance driven, the land you're in, the
// seed (and a link to share it), and a map of the road around you instead of the whole route.
export function createEndlessHud(root, road, info, { onCamera, onTod, onReset, onExit, onFan, onShare }) {
  root.innerHTML = `
    <div class="fd-road">
      <p class="fd-road-name">Endless</p>
      <p class="fd-road-sub"><span data-h-stretch>${esc(info.local || '')}</span> · <button type="button" class="fd-seedchip" data-h-share title="Copy a link to this world">Seed ${esc(info.seedLabel || '')}</button></p>
    </div>
    <div class="fd-ctl">
      <button type="button" class="chip" data-h-cam title="Camera (C)">Chase</button>
      <button type="button" class="chip" data-h-tod title="Time of day (T)">Day</button>
      <button type="button" class="chip" data-h-fan aria-pressed="false" title="Suction fan (X): 46 kN of grip">Fan</button>
      <button type="button" class="chip" data-h-reset title="Back on the road (R)">Reset</button>
      <button type="button" class="chip" data-h-exit title="Leave Free Drive (Esc)">Exit</button>
    </div>
    <div class="fd-timer running" data-h-timer><b data-h-time>0:00.0</b><span>Driving</span></div>
    <div class="fd-speed"><b data-h-speed>0</b><span>km/h</span></div>
    <dl class="fd-stats">
      <div><dt>Elevation</dt><dd><b data-h-ele>0</b> m</dd></div>
      <div><dt>Grade</dt><dd><b data-h-grade>0.0</b> %</dd></div>
      <div><dt>Distance</dt><dd><b data-h-dist>0.0</b> km</dd></div>
    </dl>
    <div class="fd-map" aria-hidden="true">
      <svg viewBox="-75 -75 150 150" class="fd-mini"><path class="route" data-h-route d="" /><path class="ahead" data-h-ahead d="" />
        <g data-h-car><circle r="4" /><path d="M0 -8 L3 -2 L-3 -2Z" /></g></svg>
      <svg viewBox="0 0 150 34" preserveAspectRatio="none" class="fd-profile"><path data-h-prof d="" /><line x1="75" x2="75" y1="0" y2="34" /></svg>
    </div>
    <p class="fd-fine">Endless: generated from its seed as you drive · same seed, same world</p>`;
  const $ = (q) => root.querySelector(q);
  const el = { speed: $('[data-h-speed]'), ele: $('[data-h-ele]'), grade: $('[data-h-grade]'), dist: $('[data-h-dist]'), car: $('[data-h-car]'), route: $('[data-h-route]'), ahead: $('[data-h-ahead]'),
    prof: $('[data-h-prof]'), time: $('[data-h-time]'), stretch: $('[data-h-stretch]'), cam: $('[data-h-cam]'), tod: $('[data-h-tod]'), fan: $('[data-h-fan]'), share: $('[data-h-share]') };
  $('[data-h-cam]').addEventListener('click', onCamera);
  $('[data-h-tod]').addEventListener('click', onTod);
  $('[data-h-reset]').addEventListener('click', onReset);
  $('[data-h-exit]').addEventListener('click', onExit);
  $('[data-h-fan]').addEventListener('click', onFan);
  el.share.addEventListener('click', () => onShare?.(el.share));
  const last = { speed: -1, ele: -1e9, grade: -1e9, dist: -1, mapI: -1e9, time: -1, stretch: '', heading: 1e9 };
  // The map: 1.5 km of road around the car, north up, 150 px ≈ 3 km; redrawn every 30 m.
  const K = 75 / 1500;
  function drawMap(i) {
    const cx = road.x[i], cz = road.z[i];
    let back = '', ahead = '';
    const a = Math.max(0, i - 500), b = Math.min(road.n - 1, i + 500);
    for (let k = a; k <= b; k += 4) {
      const p = `${((road.x[k] - cx) * K).toFixed(1)} ${((road.z[k] - cz) * K).toFixed(1)}`;
      if (k <= i) back += `${back ? 'L' : 'M'}${p}`;
      if (k >= i - 4) ahead += `${ahead ? 'L' : 'M'}${p}`;
    }
    el.route.setAttribute('d', back); el.ahead.setAttribute('d', ahead);
    // Profile: 1.5 km either side.
    let lo = Infinity, hi = -Infinity;
    for (let k = a; k <= b; k += 8) { lo = Math.min(lo, road.y[k]); hi = Math.max(hi, road.y[k]); }
    let d = 'M0 34';
    for (let k = a; k <= b; k += 8) d += `L${(((k - i) / 1000) * 75 + 75).toFixed(1)} ${(31 - ((road.y[k] - lo) / Math.max(20, hi - lo)) * 26).toFixed(1)}`;
    el.prof.setAttribute('d', `${d}L${((((b - i) / 1000) * 75) + 75).toFixed(1)} 34Z`);
  }
  return {
    update({ speed, ele, grade, i, heading, time, biome }) {
      const sp = Math.round(speed * 3.6);
      if (sp !== last.speed) { el.speed.textContent = String(sp); last.speed = sp; }
      const e = Math.round(ele);
      if (e !== last.ele) { el.ele.textContent = fmtInt(e); last.ele = e; }
      const g = Math.round(grade * 1000);
      if (g !== last.grade) { el.grade.textContent = (g / 10).toFixed(1); last.grade = g; }
      const dd = Math.round((i * road.meta.spacing) / 100);
      if (dd !== last.dist) { el.dist.textContent = (dd / 10).toFixed(1); last.dist = dd; }
      if (Math.abs(i - last.mapI) >= 10) { drawMap(i); last.mapI = i; }
      const hd = Math.round((heading * 180) / Math.PI);
      if (hd !== last.heading) { el.car.setAttribute('transform', `rotate(${hd})`); last.heading = hd; }
      if (biome && biome !== last.stretch) { el.stretch.textContent = biome; last.stretch = biome; }
      const tt = time == null ? -1 : Math.round(time * 10);
      if (tt !== last.time) { el.time.textContent = fmtTime(time || 0); last.time = tt; }
    },
    setCam(m) { el.cam.textContent = { chase: 'Chase', bumper: 'Bumper', cinema: 'Cinema' }[m] || m; },
    setTod(t) { el.tod.textContent = t === 'dusk' ? 'Dusk' : 'Day'; },
    setFan(on) { el.fan.setAttribute('aria-pressed', String(on)); },
    finish() {},
  };
}

// The driving HUD. `road` is the built road, `info` its manifest entry.
export function createHud(root, road, info, { onCamera, onTod, onReset, onExit, onFan }) {
  // Minimap: the route drawn from the road's own samples (every 8th), in a 150×150 box.
  const W = 150, step = 8, b = road.bounds, span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ), k = (W - 16) / span;
  const ox = (W - (b.maxX - b.minX) * k) / 2, oz = (W - (b.maxZ - b.minZ) * k) / 2;
  const mx = (x) => ox + (x - b.minX) * k, mz = (z) => oz + (z - b.minZ) * k;
  let route = '';
  for (let i = 0; i < road.n; i += step) route += `${i ? 'L' : 'M'}${mx(road.x[i]).toFixed(1)} ${mz(road.z[i]).toFixed(1)}`;
  route += `L${mx(road.x[road.n - 1]).toFixed(1)} ${mz(road.z[road.n - 1]).toFixed(1)}`;
  const PW = 150, PH = 34;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < road.n; i++) { lo = Math.min(lo, road.y[i]); hi = Math.max(hi, road.y[i]); }
  const py = (y) => PH - 3 - ((y - lo) / Math.max(1, hi - lo)) * (PH - 8);
  let prof = `M0 ${PH}`;
  for (let i = 0; i < road.n; i += step * 2) prof += `L${((i / (road.n - 1)) * PW).toFixed(1)} ${py(road.y[i]).toFixed(1)}`;
  prof += `L${PW} ${py(road.y[road.n - 1]).toFixed(1)}L${PW} ${PH}Z`;
  root.innerHTML = `
    <div class="fd-road">
      <p class="fd-road-name">${esc(info.name)}</p>
      <p class="fd-road-sub"><span data-h-stretch>${esc(info.local)}</span> · ${esc(info.country)}</p>
    </div>
    <div class="fd-ctl">
      <button type="button" class="chip" data-h-cam title="Camera (C)">Chase</button>
      <button type="button" class="chip" data-h-tod title="Time of day (T)">Day</button>
      <button type="button" class="chip" data-h-fan aria-pressed="false" title="Suction fan (X): 46 kN of grip">Fan</button>
      <button type="button" class="chip" data-h-reset title="Back on the road (R)">Reset</button>
      <button type="button" class="chip" data-h-exit title="Leave Free Drive (Esc)">Exit</button>
    </div>
    <div class="fd-timer" data-h-timer><b data-h-time>0:00.0</b><span data-h-best></span></div>
    <div class="fd-speed"><b data-h-speed>0</b><span>km/h</span></div>
    <dl class="fd-stats">
      <div><dt>Elevation</dt><dd><b data-h-ele>0</b> m</dd></div>
      <div><dt>Grade</dt><dd><b data-h-grade>0.0</b> %</dd></div>
      <div><dt>Distance</dt><dd><b data-h-dist>0.0</b> / ${(road.length / 1000).toFixed(1)} km</dd></div>
    </dl>
    <div class="fd-map" aria-hidden="true">
      <svg viewBox="0 0 ${W} ${W}" class="fd-mini"><path class="route" d="${route}" /><path class="done" data-h-done d="" />
        <circle class="a" cx="${mx(road.x[0]).toFixed(1)}" cy="${mz(road.z[0]).toFixed(1)}" r="2.5" /><circle class="b" cx="${mx(road.x[road.n - 1]).toFixed(1)}" cy="${mz(road.z[road.n - 1]).toFixed(1)}" r="2.5" />
        <g data-h-car><circle r="4" /><path d="M0 -8 L3 -2 L-3 -2Z" /></g></svg>
      <svg viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" class="fd-profile"><path d="${prof}" /><line data-h-pline x1="0" x2="0" y1="0" y2="${PH}" /></svg>
    </div>
    <p class="fd-fine">Map data ${esc(info.credit.osm)} · ${esc(info.credit.dem)}</p>`;
  const $ = (s) => root.querySelector(s);
  const el = { speed: $('[data-h-speed]'), ele: $('[data-h-ele]'), grade: $('[data-h-grade]'), dist: $('[data-h-dist]'), car: $('[data-h-car]'), pline: $('[data-h-pline]'),
    time: $('[data-h-time]'), best: $('[data-h-best]'), timer: $('[data-h-timer]'), stretch: $('[data-h-stretch]'), cam: $('[data-h-cam]'), tod: $('[data-h-tod]'), fan: $('[data-h-fan]'), done: $('[data-h-done]') };
  $('[data-h-cam]').addEventListener('click', onCamera);
  $('[data-h-tod]').addEventListener('click', onTod);
  $('[data-h-reset]').addEventListener('click', onReset);
  $('[data-h-exit]').addEventListener('click', onExit);
  $('[data-h-fan]').addEventListener('click', onFan);
  const last = { speed: -1, ele: -1e9, grade: -1e9, dist: -1, mapI: -1, time: -1, stretch: '' };
  const names = road.meta.names || [];
  return {
    update({ speed, ele, grade, i, heading, time, best }) {
      const sp = Math.round(speed * 3.6);
      if (sp !== last.speed) { el.speed.textContent = String(sp); last.speed = sp; }
      const e = Math.round(ele);
      if (e !== last.ele) { el.ele.textContent = fmtInt(e); last.ele = e; }
      const g = Math.round(grade * 1000);
      if (g !== last.grade) { el.grade.textContent = (g / 10).toFixed(1); last.grade = g; }
      const d = Math.round((i * road.meta.spacing) / 100);
      if (d !== last.dist) { el.dist.textContent = (d / 10).toFixed(1); last.dist = d; }
      if (i !== last.mapI) {
        el.car.setAttribute('transform', `translate(${mx(road.x[i]).toFixed(1)} ${mz(road.z[i]).toFixed(1)}) rotate(${((heading * 180) / Math.PI).toFixed(0)})`);
        const px = ((i / (road.n - 1)) * PW).toFixed(1);
        el.pline.setAttribute('x1', px); el.pline.setAttribute('x2', px);
        last.mapI = i;
        // A bridge or a named stretch shows under the road's name.
        let nm = '';
        for (const [s, n] of names) { if (s > i) break; nm = n; }
        const show = /bridge|bru|brua|ponte|tunel|tunnel|viaduct/i.test(nm) ? nm : info.local;
        if (show !== last.stretch) { el.stretch.textContent = show; last.stretch = show; }
      }
      const tt = time == null ? -1 : Math.round(time * 10);
      if (tt !== last.time) { el.time.textContent = time == null ? '0:00.0' : fmtTime(time); last.time = tt; }
      el.timer.classList.toggle('running', time != null);
      const bt = best ? `Best ${fmtTime(best)}` : '';
      if (el.best.textContent !== bt) el.best.textContent = bt;
    },
    setCam(m) { el.cam.textContent = { chase: 'Chase', bumper: 'Bumper', cinema: 'Cinema' }[m] || m; },
    setTod(t) { el.tod.textContent = t === 'dusk' ? 'Dusk' : 'Day'; },
    setFan(on) { el.fan.setAttribute('aria-pressed', String(on)); },
    finish(t, best, isBest) {
      el.timer.classList.add('finished');
      el.best.textContent = isBest ? 'Best time' : `Best ${fmtTime(best)}`;
      void t;
    },
  };
}
