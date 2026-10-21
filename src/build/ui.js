// BUILD · POWER-UPS · QUESTS: the DOM. The driving dock (Build, Quests), the build bar, the
// palette (and the radial menu on a phone), the power-up gauges, the quest tracker and its result
// card, and the quest board with the AI generator. Same voice as the rest: hairlines, glass,
// Michroma for names, mono for numbers, one signal red. Text-only updates; no layout per frame.
import './build.css';
import { PIECES, PIECE_IDS, POWERUPS, POWERUP_IDS, MATERIAL_IDS, BUILD_MATERIALS, BUDGET, PAINTS, PAINT_IDS } from './catalogue.js';
import { builtInQuests, generateQuest } from './quest-gen.js';
import { isUnlocked, saveProgress } from './quests.js';
import { ROADSTER_MATERIALS } from '../render/roadster.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small line icons, 24×24, one stroke.
const ICON = {
  kicker: 'M3 18h18M5 18c6 0 11-3 14-9v9', wedge: 'M3 18h18L20 8z', quarter: 'M4 18h16V6M8 18c6 0 9-4 9-12', halfpipe: 'M2 6c0 7 4 12 10 12s10-5 10-12',
  loop: 'M12 19a7 7 0 1 1 0.01 0M3 19h18', block: 'M5 9h14v9H5zM5 13h14', boost: 'M7 15l5-4 5 4M7 10l5-4 5 4', pad: 'M3 16h18M12 16m-6 0a6 2 0 1 0 12 0a6 2 0 1 0-12 0',
  ring: 'M12 4a7 7 0 1 0 0.01 0', car: 'M4 16h16v-3l-3-3H8l-3 3zM7 16v2M17 16v2', barge: 'M2 14h20l-3 4H5zM6 14v-3h12v3', crate: 'M5 7h14v12H5zM5 7l14 12M19 7L5 19',
  pickup: 'M12 4l5 8-5 8-5-8z', cone: 'M6 19h12M8 19l4-14 4 14M9.5 13h5', barrier: 'M3 18h18M5 18l2-8h10l2 8M7 13h10',
};
// Turn and undo arrows (the font has no ⟲ ⟳ ↶ ↷).
const ARC = { ccw: 'M8 5H4v4M4.5 8.5A8 8 0 1 1 6 17', cw: 'M16 5h4v4M19.5 8.5A8 8 0 1 0 18 17', undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2', redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2' };
const glyph = (k) => `<svg class="bq-g" viewBox="0 0 24 24" aria-hidden="true"><path d="${ARC[k]}"/></svg>`;
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k] || ICON.pickup}"/></svg>`;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function createBuildUI(api, { coarse = false } = {}) {
  const root = document.createElement('section');
  root.className = 'bq';
  root.dataset.buildUi = '';
  root.innerHTML = `
    <div class="bq-dock" data-bq-dock>
      <button type="button" class="chip" data-bq-build title="Build mode (B): ramps, loops, rings, pads">Build <kbd>B</kbd></button>
      <button type="button" class="chip" data-bq-quests title="Side quests (J)">Quests <kbd>J</kbd></button>
      <button type="button" class="chip bq-arcade" data-bq-arcade aria-pressed="false" title="Arcade layer: power-ups on or off. Never in scored events.">Arcade</button>
    </div>
    <div class="bq-power" data-bq-power aria-live="polite"></div>
    <div class="bq-quest" data-bq-quest hidden></div>
    <div class="bq-bar" data-bq-bar hidden>
      <div class="bq-top">
        <p class="bq-title">Build <span data-bq-arena></span></p>
        <p class="bq-budget"><b data-bq-cost>0</b> / ${BUDGET.build}</p>
        <div class="seg bq-mode" role="radiogroup" aria-label="Tool">
          <button type="button" role="radio" data-bq-mode="place" aria-checked="true" title="Place pieces (Tab)">Place</button>
          <button type="button" role="radio" data-bq-mode="edit" aria-checked="false" title="Pick, move, turn and delete pieces (Tab)">Edit</button>
        </div>
        <div class="bq-acts">
          <button type="button" class="chip" data-bq-undo title="Undo (Ctrl+Z)" aria-label="Undo">${glyph('undo')}</button>
          <button type="button" class="chip" data-bq-redo title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${glyph('redo')}</button>
          <button type="button" class="chip" data-bq-saves title="Save, load and share builds">Saves</button>
          <button type="button" class="chip primary" data-bq-done title="Done (B or Esc)">Drive</button>
        </div>
      </div>
      <div class="bq-insp" data-bq-insp>
        <p class="bq-status" data-bq-status aria-live="polite"></p>
        <div class="seg bq-mats" role="radiogroup" aria-label="Material">
          ${MATERIAL_IDS.map((m) => `<button type="button" role="radio" data-bq-mat="${m}" aria-checked="false" title="${BUILD_MATERIALS[m].name}: grip ×${BUILD_MATERIALS[m].grip}"><i style="background:${hex(BUILD_MATERIALS[m].color)}"></i><span>${BUILD_MATERIALS[m].name}</span></button>`).join('')}
        </div>
        <div class="bq-tools">
          <button type="button" class="chip" data-bq-rot="-1" title="Rotate left 15° (Q)" aria-label="Rotate left">${glyph('ccw')}</button>
          <button type="button" class="chip" data-bq-rot="1" title="Rotate right 15° (E)" aria-label="Rotate right">${glyph('cw')}</button>
          <button type="button" class="chip" data-bq-scale="-1" title="Smaller (Z)" aria-label="Smaller">−</button>
          <b class="bq-scale" data-bq-scale-v>1.00×</b>
          <button type="button" class="chip" data-bq-scale="1" title="Bigger (X)" aria-label="Bigger">+</button>
          <button type="button" class="chip danger" data-bq-del title="Delete (Del)" aria-label="Delete">Delete</button>
          <button type="button" class="chip primary bq-placebtn" data-bq-place title="Place it (Enter)">Place</button>
        </div>
      </div>
      <div class="bq-palette" data-bq-palette role="listbox" aria-label="Pieces">
        ${PIECE_IDS.map((id) => `<button type="button" class="bq-piece" role="option" data-bq-piece="${id}" aria-selected="false" title="${esc(PIECES[id].name)} (${PIECES[id].key}): ${esc(PIECES[id].blurb)}">${icon(id)}<span>${esc(PIECES[id].name)}</span><kbd>${PIECES[id].key}</kbd><em data-lock hidden>locked</em></button>`).join('')}
        <span class="bq-sep" aria-hidden="true"></span>
        ${POWERUP_IDS.map((id) => `<button type="button" class="bq-piece pu" role="option" data-bq-piece="pickup:${id}" aria-selected="false" title="${esc(POWERUPS[id].name)}: ${esc(POWERUPS[id].blurb)}" style="--pu:${hex(POWERUPS[id].color)}">${icon('pickup')}<span>${esc(POWERUPS[id].name)}</span></button>`).join('')}
      </div>
      <p class="bq-hint">${coarse ? 'Tap to aim · tap the ghost to place · drag to pan · pinch to zoom · twist to turn' : 'Click to place · drag to orbit · right-drag to pan · wheel to zoom · Q/E turn · Z/X size · M material · Del remove · Tab edit'}</p>
      <button type="button" class="bq-fab" data-bq-fab aria-label="Pieces" aria-expanded="false">+</button>
      <div class="bq-radial" data-bq-radial hidden></div>
    </div>
    <div class="bq-sheet" data-bq-saves-sheet hidden></div>
    <div class="bq-board" data-bq-board hidden></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const ed = () => api.editor;
  $('[data-bq-arena]').textContent = api.host.name ? `· ${api.host.name}` : '';

  // --- Dock -------------------------------------------------------------------------------------
  $('[data-bq-build]').addEventListener('click', () => ed().toggle(true));
  $('[data-bq-quests]').addEventListener('click', () => openBoard());
  $('[data-bq-arcade]').addEventListener('click', () => api.setArcade(!api.arcade));
  const onDriveKey = (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || ed()?.on || !$('[data-bq-board]').hidden) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'KeyB') { e.preventDefault(); ed().toggle(true); }
    else if (e.code === 'KeyJ') { e.preventDefault(); openBoard(); }
  };
  addEventListener('keydown', onDriveKey);

  // --- Build bar ---------------------------------------------------------------------------------
  $$('[data-bq-mode]').forEach((b) => b.addEventListener('click', () => ed().setMode(b.dataset.bqMode)));
  $('[data-bq-undo]').addEventListener('click', () => ed().undo());
  $('[data-bq-redo]').addEventListener('click', () => ed().redo());
  $('[data-bq-done]').addEventListener('click', () => ed().toggle(false));
  $$('[data-bq-mat]').forEach((b) => b.addEventListener('click', () => ed().setMaterial(b.dataset.bqMat)));
  $$('[data-bq-rot]').forEach((b) => b.addEventListener('click', () => ed().rotate(Number(b.dataset.bqRot))));
  $$('[data-bq-scale]').forEach((b) => b.addEventListener('click', () => ed().scaleBy(Number(b.dataset.bqScale))));
  $('[data-bq-del]').addEventListener('click', () => ed().remove());
  $('[data-bq-place]').addEventListener('click', () => ed().place());
  $('[data-bq-saves]').addEventListener('click', () => openSaves());

  // Palette: tap to choose; drag onto the world to drop it there.
  function bindDrag(el, type) {
    let start = null, ghostEl = null;
    el.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!ghostEl && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) {
        ghostEl = document.createElement('div'); ghostEl.className = 'bq-dragging'; ghostEl.innerHTML = icon(type.startsWith('pickup:') ? 'pickup' : type);
        document.body.appendChild(ghostEl);
      }
      if (ghostEl) { ghostEl.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`; }
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dragged = !!ghostEl;
      ghostEl?.remove(); ghostEl = null; start = null;
      if (e.type === 'pointercancel') return;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      if (dragged && over === api.host.canvas) ed().dropAt(type, e.clientX, e.clientY);
      else if (!dragged) { ed().choose(type); closeRadial(); }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ed().choose(type); } });
  }
  $$('[data-bq-piece]').forEach((b) => bindDrag(b, b.dataset.bqPiece));

  // Radial menu (phones): every piece in a ring around the + button.
  const radial = $('[data-bq-radial]'), fab = $('[data-bq-fab]');
  function openRadial() {
    const items = [...PIECE_IDS, ...POWERUP_IDS.map((id) => `pickup:${id}`)];
    // Three rings fanned from straight up round to the left of the + (it sits bottom right):
    // 4, 6 and the rest over a quarter turn, so every item keeps a thumb's width.
    const rings = [[0, 4, 100], [4, 10, 175], [10, items.length, 255]], span = Math.PI / 2;
    const at = (i) => { const [a0, a1, r] = rings.find(([a, b]) => i >= a && i < b); const k = a1 - a0 > 1 ? (i - a0) / (a1 - a0 - 1) : 0.5; return [r, Math.PI / 2 + k * span]; };
    radial.innerHTML = items.map((id, i) => {
      const [ring, a] = at(i);
      const x = Math.cos(a) * ring, y = -Math.sin(a) * ring;
      const pu = id.startsWith('pickup:');
      const name = pu ? POWERUPS[id.slice(7)].name : PIECES[id].name;
      const locked = !pu && !isUnlocked(api.progress, id);
      return `<button type="button" class="bq-ritem${pu ? ' pu' : ''}" data-bq-piece="${id}" style="--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;--d:${i * 14}ms${pu ? `;--pu:${hex(POWERUPS[id.slice(7)].color)}` : ''}" aria-label="${esc(name)}" ${locked ? 'data-locked' : ''}>${icon(pu ? 'pickup' : id)}<span>${esc(name.split(/[ -]/)[0])}</span></button>`;
    }).join('');
    radial.querySelectorAll('[data-bq-piece]').forEach((b) => bindDrag(b, b.dataset.bqPiece));
    radial.hidden = false; fab.setAttribute('aria-expanded', 'true'); fab.classList.add('on');
  }
  function closeRadial() { radial.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.classList.remove('on'); }
  fab.addEventListener('click', () => (radial.hidden ? openRadial() : closeRadial()));

  function editorState(s) {
    $('[data-bq-cost]').textContent = String(s.cost);
    $('[data-bq-cost]').parentElement.classList.toggle('full', s.cost >= BUDGET.build);
    $$('[data-bq-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.bqMode === s.mode)));
    const mat = s.mode === 'edit' && s.sel ? s.sel.material : s.material;
    $$('[data-bq-mat]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.bqMat === mat)));
    $$('.bq-palette [data-bq-piece]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.bqPiece === s.type && s.mode === 'place'));
      const id = b.dataset.bqPiece, locked = PIECES[id] && !isUnlocked(api.progress, id);
      b.toggleAttribute('data-locked', !!locked);
      const l = b.querySelector('[data-lock]'); if (l) l.hidden = !locked;
    });
    const sc = s.mode === 'edit' && s.sel ? s.sel.transform.scale : s.scale;
    $('[data-bq-scale-v]').textContent = `${sc.toFixed(2)}×`;
    $('[data-bq-undo]').disabled = !s.undo; $('[data-bq-redo]').disabled = !s.redo;
    $('[data-bq-del]').disabled = s.mode === 'edit' && !s.sel;
    $('[data-bq-place]').hidden = s.mode !== 'place';
    const name = s.type.startsWith('pickup:') ? POWERUPS[s.type.slice(7)].name : PIECES[s.type].name;
    const status = s.mode === 'edit'
      ? (s.sel ? `${esc(s.sel.pickup ? POWERUPS[s.sel.pickup].name : PIECES[s.sel.type].name)} · drag to move · Q/E turn · Delete` : 'Pick a piece to move, turn, resize or delete it')
      : s.valid.ok ? `<b>${esc(name)}</b> · ${Math.round((s.yaw * 180) / Math.PI) % 360}° · fits` : `<b class="no">${esc(name)}</b> · ${esc(s.valid.why || 'doesn’t fit here')}`;
    $('[data-bq-status]').innerHTML = status;
    root.querySelector('.bq-bar').dataset.mode = s.mode;
  }
  function showBuild(on, s) {
    $('[data-bq-bar]').hidden = !on;
    $('[data-bq-dock]').hidden = on;
    closeRadial();
    if (on) { editorState(s); api.cue(coarse ? 'Build · tap to aim, tap the ghost to place' : 'Build · click to place, drag to orbit, B when you’re done', 2600); }
  }

  // --- Saves ---------------------------------------------------------------------------------------
  const savesEl = $('[data-bq-saves-sheet]');
  function openSaves() {
    const list = api.saves().filter((s) => s.arena === api.host.id);
    savesEl.innerHTML = `
      <div class="sheet bq-saves" role="dialog" aria-modal="true" aria-labelledby="bq-saves-t">
        <div class="bq-row"><h3 id="bq-saves-t">Builds</h3><button type="button" class="btn link" data-x>Close</button></div>
        <form class="bq-row" data-save-form><input data-save-name maxlength="32" placeholder="Name this build" aria-label="Build name" /><button class="btn small" type="submit">Save</button></form>
        <div class="bq-list">${list.length ? list.map((s) => `<div class="bq-item"><b>${esc(s.name)}</b><span>${s.n} pieces · ${new Date(s.at).toLocaleDateString()}</span><button type="button" class="chip" data-load="${s.at}">Load</button><button type="button" class="chip" data-del="${s.at}" aria-label="Delete ${esc(s.name)}">✕</button></div>`).join('') : '<p class="bq-empty">Nothing saved here yet. Your build is kept as you go; name it to keep a copy.</p>'}</div>
        <div class="bq-row bq-share"><button type="button" class="btn ghost" data-share>Copy share link</button><button type="button" class="btn link danger" data-clear>Clear the build</button></div>
        <p class="bq-fine" data-share-out>A link holds the whole build in its # (about 15 characters a piece). Nothing is uploaded.</p>
      </div>`;
    savesEl.hidden = false;
    const close = () => { savesEl.hidden = true; savesEl.innerHTML = ''; };
    savesEl.querySelector('[data-x]').onclick = close;
    savesEl.onclick = (e) => { if (e.target === savesEl) close(); };
    savesEl.querySelector('[data-save-form]').onsubmit = (e) => { e.preventDefault(); api.saveAs(savesEl.querySelector('[data-save-name]').value.trim() || `Build ${new Date().toLocaleTimeString()}`); openSaves(); };
    savesEl.querySelectorAll('[data-load]').forEach((b) => { b.onclick = () => { const s = list.find((x) => String(x.at) === b.dataset.load); if (s) { const n = api.loadCode(s.code); api.cue(`Loaded “${esc(s.name)}” · ${n} pieces`, 1800); ed().toggle(false); ed().toggle(true); } close(); }; });
    savesEl.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { api.deleteSave(Number(b.dataset.del)); openSaves(); }; });
    savesEl.querySelector('[data-share]').onclick = async () => {
      const url = api.shareUrl(), out = savesEl.querySelector('[data-share-out]');
      try { await navigator.clipboard.writeText(url); out.textContent = `Copied: ${url.length} characters. Anyone who opens it drives your build.`; }
      catch { out.innerHTML = `<input readonly value="${esc(url)}" aria-label="Share link" />`; out.querySelector('input').select(); }
      history.replaceState(null, '', url.slice(url.indexOf('?')));
    };
    savesEl.querySelector('[data-clear]').onclick = () => { if (confirm('Clear every piece of this build?')) { api.clearBuild(); close(); ed().toggle(false); ed().toggle(true); } };
  }

  // --- Power-up gauges --------------------------------------------------------------------------
  const powerEl = $('[data-bq-power]');
  const gauges = {};
  function powerups(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let g = gauges[p.id];
      if (!g) {
        g = document.createElement('div'); g.className = 'bq-gauge';
        g.style.setProperty('--pu', hex(POWERUPS[p.id].color));
        g.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15"/><circle class="fg" cx="18" cy="18" r="15" pathLength="100"/></svg><b>${esc(POWERUPS[p.id].name)}</b><span></span>`;
        powerEl.appendChild(g); gauges[p.id] = g; g._last = -1;
      }
      const f = Math.round(p.frac * 100);
      if (f !== g._last) { g.querySelector('.fg').style.strokeDasharray = `${f} 100`; g.querySelector('span').textContent = `${p.left.toFixed(0)} s`; g._last = f; }
    }
    for (const id of Object.keys(gauges)) if (!seen.has(id)) { gauges[id].remove(); delete gauges[id]; }
  }
  function setArcade(on) { $('[data-bq-arcade]').setAttribute('aria-pressed', String(!!on)); root.classList.toggle('arcade', !!on); }

  // --- Quest tracker ------------------------------------------------------------------------------
  const qEl = $('[data-bq-quest]');
  let qLast = '';
  function quest(run) {
    if (!run) { qEl.hidden = true; qEl.innerHTML = ''; qLast = ''; return; }
    const q = run.quest;
    qEl.hidden = false;
    qEl.innerHTML = `<p class="bq-eyebrow">${q.source === 'ai' ? 'AI quest' : 'Side quest'}<span data-q-time></span></p><p class="bq-qtitle">${esc(q.title)}</p><ol data-q-lines></ol>
      <div class="bq-qacts"><button type="button" class="chip" data-q-retry>Retry</button><button type="button" class="chip" data-q-quit>Leave</button></div><div data-q-result></div>`;
    qEl.querySelector('[data-q-retry]').onclick = () => api.retryQuest();
    qEl.querySelector('[data-q-quit]').onclick = () => api.endQuest(false);
    qLast = '';
    questTick(run);
  }
  function questTick(run) {
    const lines = run.lines();
    const sig = lines.map((l) => `${l.ok}${l.val}`).join('|');
    if (sig !== qLast) {
      qLast = sig;
      qEl.querySelector('[data-q-lines]').innerHTML = lines.map((l) => `<li class="${l.ok ? 'ok' : ''}"><i aria-hidden="true"></i><span>${esc(l.label)}</span><b>${l.ok ? 'done' : esc(l.val)}</b></li>`).join('');
    }
    const t = qEl.querySelector('[data-q-time]');
    const left = run.left;
    const txt = left != null ? ` · ${Math.ceil(left)} s` : '';
    if (t.textContent !== txt) { t.textContent = txt; t.classList.toggle('low', left != null && left < 10); }
  }
  function questResult(run, r) {
    const el = qEl.querySelector('[data-q-result]');
    el.innerHTML = `<div class="bq-result ${r.ok ? 'ok' : 'no'}"><b>${r.ok ? 'Quest complete' : 'Out of time'}</b>${r.ok ? `<span>${run.time.toFixed(1)} s${r.line ? ` · ${esc(r.line)}` : ''}</span>` : ''}
      <div class="bq-qacts"><button type="button" class="chip primary" data-r-again>${r.ok ? 'Again' : 'Retry'}</button><button type="button" class="chip" data-r-board>More quests</button><button type="button" class="chip" data-r-done>Done</button></div></div>`;
    el.querySelector('[data-r-again]').onclick = () => api.retryQuest();
    el.querySelector('[data-r-board]').onclick = () => { api.endQuest(false); openBoard(); };
    el.querySelector('[data-r-done]').onclick = () => api.endQuest(false);
    applyPaint();
  }

  // --- The quest board ------------------------------------------------------------------------------
  const board = $('[data-bq-board]');
  const generated = [];
  let genBusy = false;
  function objLine(o, q) {
    switch (o.type) {
      case 'rings': return `${o.count} ring${o.count > 1 ? 's' : ''}`;
      case 'land': return `land on the ${PIECES[q.pieces[o.target].t].name.toLowerCase()}`;
      case 'jump': return `jump ${o.min} m`;
      case 'airtime': return `${o.min} s air`;
      case 'flip': return `${o.count} rotation${o.count > 1 ? 's' : ''}`;
      case 'speed': return `${o.min} km/h`;
      case 'deliver': return `deliver in ${o.within} s`;
      case 'find': return 'find it';
      case 'collect': return `collect ${o.count}`;
      default: return o.type;
    }
  }
  function rewardLine(r) {
    const m = /^(piece|paint|title):(.+)$/.exec(r || '');
    if (!m) return '';
    return m[1] === 'piece' ? `Unlocks ${PIECES[m[2]].name}` : m[1] === 'paint' ? `Paint: ${PAINTS[m[2]].name}` : `Title: ${m[2]}`;
  }
  function card(q, i) {
    const done = api.progress.done[q.id] || 0;
    return `<button type="button" class="bq-card${done ? ' done' : ''}" data-q="${i}">
      <span class="bq-csrc">${q.source === 'ai' ? `AI · ${esc(q.model || '')}` : q.source === 'local' ? 'Generated' : 'Quest'}</span>
      <b>${esc(q.title)}</b><span class="bq-cbrief">${esc(q.brief)}</span>
      <span class="bq-cobj">${q.objectives.map((o) => esc(objLine(o, q))).join(' · ')}${q.timeLimit ? ` · ${q.timeLimit} s` : ''}</span>
      <span class="bq-crew">${esc(rewardLine(q.reward))}${done ? ` <i>✓ ×${done}</i>` : ''}</span></button>`;
  }
  function openBoard() {
    if (ed()?.on) ed().toggle(false);
    const arena = api.host.kind;
    const quests = [...generated, ...builtInQuests(arena)];
    const ai = api.aiLabel?.() || 'AI';
    const p = api.progress;
    board.innerHTML = `
      <div class="bq-bsheet" role="dialog" aria-modal="true" aria-labelledby="bq-board-t">
        <header class="bq-bhead"><div><p class="eyebrow">Side quests · ${esc(api.host.name || '')}</p><h2 id="bq-board-t">Pick a quest, or ask for one</h2></div><button type="button" class="btn link" data-x>Close</button></header>
        <form class="bq-ask" data-ask>
          <label for="bq-wish">Your AI designs a quest and lays it out here, as data checked against the catalogue: no code, never.</label>
          <div class="bq-askrow"><input id="bq-wish" data-wish maxlength="140" placeholder="“a canyon jump over a row of cars, then a ring”" autocomplete="off" />
          <button class="btn primary" type="submit" data-gen>Generate · <span data-ai-label>${esc(ai)}</span></button>
          <button class="btn ghost" type="button" data-surprise title="The offline generator: no AI call">Surprise me</button></div>
        </form>
        <div class="bq-cards">${quests.map((q, i) => card(q, i)).join('')}</div>
        <section class="bq-rewards" aria-label="Rewards">
          <div><p class="eyebrow">Paint</p><div class="bq-paints">${PAINT_IDS.map((id) => `<button type="button" class="bq-swatch" data-paint="${id}" aria-pressed="${p.paint === id}" ${p.paints.includes(id) ? '' : 'disabled'} title="${esc(PAINTS[id].name)}${p.paints.includes(id) ? '' : ' (locked)'}" style="--c:${hex(PAINTS[id].color)}"></button>`).join('')}</div></div>
          <div><p class="eyebrow">Title</p><select data-title aria-label="Title"><option value="">None</option>${p.titles.map((t) => `<option ${t === p.title ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
          <div><p class="eyebrow">Pieces</p><p class="bq-unl">${PIECE_IDS.filter((id) => PIECES[id].locked).map((id) => `<span class="${isUnlocked(p, id) ? 'on' : ''}">${esc(PIECES[id].name)}</span>`).join('')}</p></div>
        </section>
      </div>`;
    board.hidden = false;
    document.body.classList.add('bq-board-open');
    const close = closeBoard;
    board.querySelector('[data-x]').onclick = close;
    board.onclick = (e) => { if (e.target === board) close(); };
    board.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => api.startQuest(quests[Number(b.dataset.q)]); });
    board.querySelector('[data-surprise]').onclick = () => {
      const q = generateQuest(`${Date.now()}`, { arena });
      generated.unshift(q); openBoard();
      api.cue(`Generated offline: ${esc(q.title)}`, 1600);
    };
    board.querySelector('[data-ask]').onsubmit = async (e) => {
      e.preventDefault();
      if (genBusy) return;
      genBusy = true;
      const wish = board.querySelector('[data-wish]').value.trim();
      closeBoard();
      try {
        // The theatre takes the stage for the call; then the quest is laid out and starts.
        const q = await api.generate(wish);
        if (q) { generated.unshift(q); api.startQuest(q); }
      } finally { genBusy = false; }
    };
    board.querySelectorAll('[data-paint]').forEach((b) => { b.onclick = () => { p.paint = b.dataset.paint; saveProgress(p); applyPaint(); board.querySelectorAll('[data-paint]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
    board.querySelector('[data-title]').onchange = (e) => { p.title = e.target.value; saveProgress(p); };
    setTimeout(() => board.querySelector('[data-wish]')?.focus({ preventScroll: true }), 60);
    onBoardKey.on = true;
  }
  function closeBoard() { board.hidden = true; board.innerHTML = ''; document.body.classList.remove('bq-board-open'); onBoardKey.on = false; }
  const onBoardKey = (e) => { if (onBoardKey.on && e.key === 'Escape') { e.stopImmediatePropagation(); closeBoard(); } };
  addEventListener('keydown', onBoardKey, true);

  // Paint (Free Drive and the Sandbox only; put back when the layer goes).
  const paintMat = ROADSTER_MATERIALS.paint;
  const paintWas = paintMat.color.getHex();
  function applyPaint() { const c = PAINTS[api.progress.paint]; if (c && api.progress.paint !== 'silver') paintMat.color.set(c.color); else paintMat.color.setHex(paintWas); }
  applyPaint();

  return {
    showBuild, editorState, setArcade, powerups, quest, questTick, questResult, openBoard, closeBoard,
    get boardOpen() { return !board.hidden; },
    dispose() {
      removeEventListener('keydown', onDriveKey);
      removeEventListener('keydown', onBoardKey, true);
      paintMat.color.setHex(paintWas);
      document.body.classList.remove('bq-board-open', 'building');
      root.remove();
    },
  };
}
