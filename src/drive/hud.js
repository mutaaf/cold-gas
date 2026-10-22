// Free Drive's DOM: the road picker on the title, and the driving HUD (road, speed, elevation,
// grade, distance, a minimap of the whole route and its elevation profile, the run timer, the
// data credits). Updated in place: text only changes when the rounded value does.
import { OSM_CREDIT } from './manifest.js';
import { createMinimap, createMapOverlay } from './minimap.js';
import { fmtRoad, fmtLen, one, k as uk, u as uu, onUnits, unitText } from '../units.js';
import { hudToggleHtml } from '../hud-mode.js';

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
            <span class="fd-cstats" data-u-src="${r.lengthKm.toFixed(1)} km · +${fmtInt(r.gain)} m · top ${fmtInt(r.maxEle)} m${r.hairpins ? ` · ${r.hairpins} hairpins` : ''}"></span>
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
  root.querySelectorAll('.fd-cstats[data-u-src]').forEach((el) => unitText(el, el.dataset.uSrc));
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


// --- The driving HUD -----------------------------------------------------------------------------
// One HUD for a real road and the endless one. Every instrument answers a tap: speed, elevation and
// distance swap the leading unit system (both are always shown); the timer opens its splits (each
// quarter of the route against your best, or each mile / kilometre on the endless road); the grade
// opens the steepest so far; the map opens the full map (src/drive/minimap.js). Text changes only
// when the rounded value does; canvases redraw only when due. The speed, the stats and the handle
// share .fd-dash: on a phone in the compact HUD (src/hud-mode.js) they are one line.
function driveHud(root, road, info, h, endless) {
  const total = endless ? 0 : road.length;
  root.innerHTML = `
    <div class="fd-road">
      <p class="fd-road-name">${esc(endless ? 'Endless' : info.name)}</p>
      <p class="fd-road-sub">${endless
        ? `<span data-h-stretch>${esc(info.local || '')}</span> · <button type="button" class="fd-seedchip" data-h-share title="Copy a link to this world">Seed ${esc(info.seedLabel || '')}</button>`
        : `<span data-h-stretch>${esc(info.local)}</span> · ${esc(info.country)}`}</p>
    </div>
    <div class="fd-ctl">
      <button type="button" class="chip" data-h-cam title="Camera (C)">Chase</button>
      <button type="button" class="chip" data-h-tod title="Time of day (T)">Day</button>
      <button type="button" class="chip" data-h-fan aria-pressed="false" title="Suction fan (X): 46 kN (10,341 lbf) of grip">Fan</button>
      <button type="button" class="chip" data-h-reset title="Back on the road (R)">Reset</button>
      <button type="button" class="chip" data-h-exit title="Leave Free Drive (Esc)">Exit</button>
    </div>
    <div class="fd-timer h-tap${endless ? ' running' : ''}" data-h-timer role="button" tabindex="0" aria-haspopup="dialog" aria-label="Timer: show the splits"><b data-h-time>0:00.0</b><span data-h-best>${endless ? 'Driving' : ''}</span></div>
    <div class="fd-dash">
    <div class="fd-speed h-tap" data-units role="button" tabindex="0" aria-label="Speed: swap the leading units (U)"><b data-h-speed>0</b><span data-u="speed">mph</span><i class="fd-alt" data-h-speed2>0 km/h</i></div>
    <div class="fd-row">
    <dl class="fd-stats">
      <div class="h-tap" data-units role="button" tabindex="0" aria-label="Elevation: swap the leading units (U)"><dt>Elevation</dt><dd><b data-h-ele>0</b> <span data-u="len">ft</span> <span class="u2" data-h-ele2>0 m</span></dd></div>
      <div class="h-tap" data-h-gradebox role="button" tabindex="0" aria-haspopup="dialog" aria-label="Grade: show the steepest so far"><dt>Grade</dt><dd><b data-h-grade>0.0</b> %</dd></div>
      <div class="h-tap" data-units role="button" tabindex="0" aria-label="Distance: swap the leading units (U)"><dt>Distance</dt><dd><b data-h-dist>0.0</b>${endless ? '' : `<span class="fd-tot"> / <span data-h-total>0</span></span>`} <span data-u="dist">mi</span> <span class="u2" data-h-dist2></span></dd></div>
    </dl>
    ${hudToggleHtml()}
    </div>
    </div>
    <div class="fd-map" data-h-mapwrap></div>
    <p class="fd-fine">${endless ? 'Endless: generated from its seed as you drive · same seed, same world' : `Map data ${esc(info.credit.osm)} · ${esc(info.credit.dem)}`}</p>`;
  const $ = (s) => root.querySelector(s);
  const el = { speed: $('[data-h-speed]'), speed2: $('[data-h-speed2]'), ele: $('[data-h-ele]'), ele2: $('[data-h-ele2]'), grade: $('[data-h-grade]'), dist: $('[data-h-dist]'), dist2: $('[data-h-dist2]'),
    total: $('[data-h-total]'), time: $('[data-h-time]'), best: $('[data-h-best]'), timer: $('[data-h-timer]'), stretch: $('[data-h-stretch]'), cam: $('[data-h-cam]'), tod: $('[data-h-tod]'), fan: $('[data-h-fan]'), share: $('[data-h-share]') };
  $('[data-h-cam]').addEventListener('click', h.onCamera);
  $('[data-h-tod]').addEventListener('click', h.onTod);
  $('[data-h-reset]').addEventListener('click', h.onReset);
  $('[data-h-exit]').addEventListener('click', h.onExit);
  $('[data-h-fan]').addEventListener('click', h.onFan);
  el.share?.addEventListener('click', () => h.onShare?.(el.share));

  // The map and its expanded view.
  const mini = createMinimap($('[data-h-mapwrap]'), road, { endless, name: endless ? 'Endless' : info.name, onToggle: () => xmap.toggle() });
  const xmap = createMapOverlay(root, road, mini, { endless, name: endless ? `Endless · seed ${info.seedLabel || ''}` : info.name });
  if (!endless) {
    try { mini.setBest(JSON.parse(localStorage.getItem(`coldgas_drive_pace_${info.id}`) || 'null')); } catch { /* no pace */ }
  }

  // What the instruments remember: the time at every 100 m, every 1 % of the route (the pace a
  // best run leaves for its ghost), the grade's extremes.
  const sp = road.meta.spacing;
  const rec = { marks: [0], pace: new Array(101).fill(null), up: 0, down: 0, lastTime: null, i: 0, time: null, speed: 0 };
  rec.pace[0] = 0;
  const routeSteep = (() => { if (endless) return null; let up = 0, dn = 0; for (let i = 0; i < road.n; i++) { const g = road.grade[i]; if (g > up) up = g; if (g < dn) dn = g; } return { up, dn }; })();

  // A small popover in the instrument style (src/styles.css .ipop), refreshed while open.
  let pop = null, popFor = null, popTimer = 0;
  const popClose = () => { clearInterval(popTimer); popTimer = 0; pop?.remove(); pop = null; popFor?.removeAttribute('aria-expanded'); popFor = null; };
  function popOpen(anchor, render) {
    if (popFor === anchor) { popClose(); return; }
    popClose();
    pop = document.createElement('div'); pop.className = 'ipop on'; pop.setAttribute('role', 'dialog');
    pop.innerHTML = '<button type="button" class="ip-x" aria-label="Close">×</button><div class="ip-body"></div>';
    pop.querySelector('.ip-x').addEventListener('click', popClose);
    document.body.appendChild(pop); popFor = anchor; anchor.setAttribute('aria-expanded', 'true');
    let last = '';
    const paint = () => {
      const p = render(), html = `<p class="ip-t">${esc(p.title)}</p><div class="ip-big"><b>${esc(p.big)}</b><span class="ip-sub">${esc(p.sub || '')}</span></div>
        <dl class="ip-rows">${p.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${p.note ? `<p class="ip-note">${esc(p.note)}</p>` : ''}`;
      if (html !== last) { pop.querySelector('.ip-body').innerHTML = html; last = html; }
      const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, ht = pop.offsetHeight;
      const y = r.bottom + 10 + ht < innerHeight - 12 ? r.bottom + 10 : Math.max(12, r.top - ht - 10);
      pop.style.transform = `translate(${Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)))}px, ${Math.round(y)}px)`;
    };
    paint(); popTimer = setInterval(paint, 250);
  }
  const signed = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1)} s`;
  function splits() {
    const t = rec.time;
    if (!endless) {
      const best = mini.state.best;
      const rows = [25, 50, 75, 100].map((q) => {
        const at = rec.pace[q];
        return [`${q} % · ${fmtRoad((road.length * q) / 100).split(' · ')[0]}`, at == null ? '—' : `${fmtTime(at)}${best ? ` · ${signed(at - best[q])}` : ''}`];
      });
      return { title: 'Timer · splits', big: t == null ? '0:00.0' : fmtTime(t), sub: best ? `Best ${fmtTime(best[100])} · the ghost on the map is its pace` : 'No best on this road yet: finish one to race its ghost', rows,
        note: 'Each quarter of the road, and the gap to your best run there (− is ahead).' };
    }
    // Endless: each mile (or kilometre) of road, its time.
    const unitM = 1 / uk('dist'), per = Math.max(1, Math.round(unitM / 100)), rows = [];
    for (let k = 1; k * per < rec.marks.length && rows.length < 8; k++) rows.push([`${k} ${uu('dist')}`, `${fmtTime(rec.marks[k * per])} · ${fmtTime(rec.marks[k * per] - rec.marks[(k - 1) * per])}`]);
    const drove = rec.i * sp;
    return { title: 'Timer · splits', big: fmtTime(t || 0), sub: `${fmtRoad(drove)} driven · avg ${t > 1 ? one('speed', drove / t, 0) : '—'}`, rows: rows.length ? rows.slice(-8) : [['—', `a split every ${uu('dist')}`]],
      note: `The time at each ${uu('dist') === 'mi' ? 'mile' : 'kilometre'} of road, and how long that one took.` };
  }
  function grades() {
    return { title: 'Grade · steepest', big: `${(rec.up * 100).toFixed(1)} %`, sub: 'steepest climb so far',
      rows: [['Steepest descent so far', `${(rec.down * 100).toFixed(1)} %`], ...(routeSteep ? [['On this road', `+${(routeSteep.up * 100).toFixed(1)} % · ${(routeSteep.dn * 100).toFixed(1)} %`]] : []),
        ['Elevation now', fmtLen(road.y[rec.i] ?? 0, 0)]],
      note: 'Rise over run along the road, the way you are driving it: 10 % climbs a metre in ten (a foot in ten).' };
  }
  const tap = (sel, fn) => {
    const a = $(sel);
    a.addEventListener('click', (e) => { fn(a); if (e.detail > 0) a.blur(); });
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(a); } });
  };
  tap('[data-h-timer]', (a) => popOpen(a, splits));
  tap('[data-h-gradebox]', (a) => popOpen(a, grades));
  const onKey = (e) => { if (pop && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); popClose(); } };
  const onDown = (e) => { if (pop && !pop.contains(e.target) && !popFor?.contains(e.target)) popClose(); };
  addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);

  const last = { speed: -1, speed2: -1, ele: -1e9, ele2: -1e9, grade: -1e9, dist: -1, dist2: -1, time: -1, stretch: '', mapI: -1 };
  const writeTotal = () => { if (el.total) el.total.textContent = (total * uk('dist')).toFixed(1); };
  writeTotal();
  const offUnits = onUnits(() => { for (const k of ['speed', 'speed2', 'dist', 'dist2']) last[k] = -1; last.ele = -1e9; last.ele2 = -1e9; writeTotal(); mini.redraw(); xmap.unitsChanged(); });
  const names = endless ? [] : road.meta.names || [];
  return {
    update({ speed, ele, grade, i, heading, time, best, biome, x, z }) {
      rec.i = i; rec.time = time; rec.speed = speed;
      const sp1 = Math.round(speed * uk('speed')), sp2 = Math.round(speed * uk('speed', true));
      if (sp1 !== last.speed) { el.speed.textContent = String(sp1); last.speed = sp1; }
      if (sp2 !== last.speed2) { el.speed2.textContent = `${sp2} ${uu('speed', true)}`; last.speed2 = sp2; }
      const e1 = Math.round(ele * uk('len')), e2 = Math.round(ele * uk('len', true));
      if (e1 !== last.ele) { el.ele.textContent = fmtInt(e1); last.ele = e1; }
      if (e2 !== last.ele2) { el.ele2.textContent = `${fmtInt(e2)} ${uu('len', true)}`; last.ele2 = e2; }
      const g = Math.round(grade * 1000);
      if (g !== last.grade) { el.grade.textContent = (g / 10).toFixed(1); last.grade = g; }
      if (grade > rec.up) rec.up = grade; if (grade < rec.down) rec.down = grade;
      const m = i * sp, d1 = Math.round(m * uk('dist') * 10), d2 = Math.round(m * uk('dist', true) * 10);
      if (d1 !== last.dist) { el.dist.textContent = (d1 / 10).toFixed(1); last.dist = d1; }
      if (d2 !== last.dist2) { el.dist2.textContent = `${(d2 / 10).toFixed(1)} ${uu('dist', true)}`; last.dist2 = d2; }
      // Splits and pace: the time at each 100 m, and at each 1 % of a route.
      if (time != null) {
        while (rec.marks.length <= Math.floor(m / 100)) rec.marks.push(time);
        if (!endless) { const q = Math.min(100, Math.floor((i / Math.max(1, road.n - 1)) * 100)); for (let k = 1; k <= q; k++) if (rec.pace[k] == null) rec.pace[k] = time; }
      }
      mini.update(i, heading, speed, time, x ?? road.x[i], z ?? road.z[i]);
      xmap.tick();
      if (i !== last.mapI) {
        last.mapI = i;
        let show = '';
        if (endless) show = biome || '';
        else { let nm = ''; for (const [s, n] of names) { if (s > i) break; nm = n; } show = /bridge|bru|brua|ponte|tunel|tunnel|viaduct/i.test(nm) ? nm : info.local; }
        if (show && show !== last.stretch) { el.stretch.textContent = show; last.stretch = show; }
      }
      const tt = time == null ? -1 : Math.round(time * 10);
      if (tt !== last.time) { el.time.textContent = time == null ? '0:00.0' : fmtTime(time); last.time = tt; }
      if (!endless) {
        el.timer.classList.toggle('running', time != null);
        const bt = best ? `Best ${fmtTime(best)}` : '';
        if (el.best.textContent !== bt) el.best.textContent = bt;
      }
    },
    setCam(mode) { el.cam.textContent = { chase: 'Chase', bumper: 'Bumper', cinema: 'Cinema' }[mode] || mode; },
    setTod(t) { el.tod.textContent = t === 'dusk' ? 'Dusk' : 'Day'; },
    setFan(on) { el.fan.setAttribute('aria-pressed', String(on)); },
    toggleMap() { xmap.toggle(); },
    get mapOpen() { return xmap.open; },
    // The finish: a best run keeps its pace (the ghost on the map next time).
    finish(t, best, isBest) {
      el.timer.classList.add('finished');
      el.best.textContent = isBest ? 'Best time' : `Best ${fmtTime(best)}`;
      if (!endless && isBest) {
        rec.pace[100] = t;
        for (let k = 1; k <= 100; k++) if (rec.pace[k] == null) rec.pace[k] = rec.pace[k - 1];
        try { localStorage.setItem(`coldgas_drive_pace_${info.id}`, JSON.stringify(rec.pace.map((v) => Math.round(v * 100) / 100))); } catch { /* not kept */ }
        mini.setBest(rec.pace.slice());
      }
    },
    dispose() { popClose(); xmap.dispose(); offUnits(); removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); },
  };
}

// The endless road's HUD: the distance driven, the land you're in, the seed (and a link to share
// it), and a map of the road around you instead of the whole route.
export const createEndlessHud = (root, road, info, handlers) => driveHud(root, road, info, handlers, true);
// The driving HUD on a real road. `road` is the built road, `info` its manifest entry.
export const createHud = (root, road, info, handlers) => driveHud(root, road, info, handlers, false);
