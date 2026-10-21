// For nerds → Health: what obs saw this session (src/obs/index.js), drawn once a second from
// obs.snapshot(). Lives with the nerds chunk (lazy); it only reads.
import { EDGES } from './frames.js';

export const HEALTH_CSS = `
.nd-hist { width: 100%; height: 46px; display: block; margin-top: 6px; }
.nd-errs { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.nd-errs li { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: baseline; padding: 4px 6px; border: 1px solid rgba(255, 184, 79, 0.18); border-radius: 6px; }
.nd-errs li b { color: #ffb84f; font-weight: 400; }
.nd-errs li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(235, 245, 242, 0.8); }
.nd-errs li i { font-style: normal; color: rgba(235, 245, 242, 0.45); }
.nd-brk { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.nd-brk span { padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(92, 255, 200, 0.3); color: #5cffc8; font-size: 10px; }
.nd-brk span.open { border-color: rgba(255, 90, 90, 0.5); color: #ff8a8a; } .nd-brk span.half-open { border-color: rgba(255, 184, 79, 0.5); color: #ffb84f; }
`;

export const HEALTH_SECTION = `
  <section class="nd-sec" data-sec="health"><h3>Health <em data-k="h.build"></em></h3>
    <dl class="nd-kv">
      <dt>Errors this session</dt><dd data-k="h.errs">—</dd>
      <dt>Frame p50 · p95 · p99</dt><dd data-k="h.pct">—</dd>
      <dt>Hitches · low-fps windows · ticks dropped</dt><dd data-k="h.hitch">—</dd>
      <dt>Graphics tier · resolution</dt><dd data-k="h.tier">—</dd>
      <dt>Last recovery</dt><dd data-k="h.rec">—</dd>
    </dl>
    <p class="nd-note" data-k="h.why"></p>
    <canvas class="nd-hist" data-c="hist"></canvas>
    <div class="nd-brk" data-k="h.brk"></div>
    <ul class="nd-errs" data-k="h.list"></ul>
    <p class="nd-note">Every error gets a signature (message + top frame + build) and is counted, not repeated. Frames go into a histogram by interval; the tier was chosen from this device's past sessions. Batches go to the server on page hide; nothing personal leaves.</p>
  </section>`;

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };

export function renderHealth(K, C, h, set) {
  if (!h || !K['h.errs']) return;
  set(K['h.build'], `build ${h.build} · ${h.deviceClass}`);
  set(K['h.errs'], h.errCount ? `${h.errCount} · ${h.errors.length} signature${h.errors.length === 1 ? '' : 's'}` : 'none', h.errCount ? 'hot' : 'ok');
  const f = h.frames;
  set(K['h.pct'], f.frames ? `${f.p50} · ${f.p95} · ${f.p99} ms` : '—', f.p95 > 33.4 ? 'hot' : '');
  set(K['h.hitch'], `${f.hitches} · ${f.lowFpsWindows} · ${f.droppedTicks}`, f.hitches > 5 ? 'hot' : '');
  set(K['h.tier'], `${h.tier} · ${Math.round(h.scale * 100)} %${h.glLost ? ' · GPU LOST' : ''}`, h.glLost ? 'hot' : '');
  const r = h.lastRecovery;
  set(K['h.rec'], r ? `${r.kind} ${r.ok ? '✓' : '✗'} · ${ago(r.at)}` : 'none needed', r && !r.ok ? 'hot' : '');
  set(K['h.why'], `Tier: ${h.tierReason}.${r ? ` Last recovery: ${r.detail}.` : ''}`);
  const brk = h.breakers.map((b) => `<span class="${b.state}" title="${esc(b.lastError)}">${esc(b.name)} · ${b.state}${b.retryIn ? ` · retry ${Math.ceil(b.retryIn / 1000)} s` : ''}</span>`).join('') || '<span>no breakers tripped</span>';
  if (K['h.brk'].innerHTML !== brk) K['h.brk'].innerHTML = brk;
  const list = h.errors.slice(0, 6).map((e) => `<li><b>${e.n}×</b><span title="${esc(e.fr)}">${esc(e.mod)} · ${esc(e.msg)}</span><i>${esc(e.sig.slice(0, 6))}</i></li>`).join('');
  if (K['h.list'].innerHTML !== list) K['h.list'].innerHTML = list;
  drawHist(C.hist, h.hist);
}

function drawHist(c, hist) {
  if (!c || !c.clientWidth) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const max = Math.max(1, ...hist), n = hist.length, bw = w / n;
  g.font = '8px ui-monospace, monospace';
  for (let i = 0; i < n; i++) {
    const v = hist[i] ? Math.max(0.04, Math.log1p(hist[i]) / Math.log1p(max)) : 0;
    const edge = i < EDGES.length ? EDGES[i] : Infinity;
    g.fillStyle = edge <= 17.5 ? '#5cffc8' : edge <= 33.4 ? '#ffb84f' : '#ff7a7a';
    g.fillRect(i * bw + 1, (h - 10) * (1 - v), bw - 2, (h - 10) * v);
    if (i % 2 === 0) { g.fillStyle = 'rgba(235,245,242,0.45)'; g.fillText(i < EDGES.length ? `${Math.round(EDGES[i])}` : '∞', i * bw + 2, h - 1); }
  }
}
