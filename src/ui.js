// DOM: the HUD (updated in place, no layout thrash), the results sheet, the board.
import { NOZZLES } from './sim/vehicle.js';
import { CATEGORIES } from './sim/judge.js';
import { chime, tick } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);

export function createUI() {
  const ui = {
    screens: Object.fromEntries([...document.querySelectorAll('[data-screen]')].map((el) => [el.dataset.screen, el])),
    speed: $('[data-speed]'), phase: $('[data-phase]'), air: $('[data-air]'), airBar: $('[data-air-bar]'),
    roll: $('[data-roll]'), alt: $('[data-alt]'), sink: $('[data-sink]'), rollArc: $('[data-roll-arc]'), glyph: $('[data-car-glyph]'),
    cue: $('[data-cue]'), count: $('[data-count]'), touch: $('[data-touch]'),
  };

  // Nozzle diagram: top-down, mapped from body x/z.
  const nzGroup = $('[data-nz]');
  ui.nz = NOZZLES.map((n) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(60 + n.pos.x * 34));
    c.setAttribute('cy', String(100 - n.pos.z * 38));
    c.setAttribute('r', n.group === 'lift' ? '9' : '6');
    c.setAttribute('class', 'nz');
    nzGroup.appendChild(c);
    return c;
  });
  const ticks = $('[data-ticks]');
  for (let a = 0; a < 360; a += 90) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const r = (a * Math.PI) / 180;
    l.setAttribute('x1', String(60 + Math.cos(r) * 44)); l.setAttribute('y1', String(60 + Math.sin(r) * 44));
    l.setAttribute('x2', String(60 + Math.cos(r) * 50)); l.setAttribute('y2', String(60 + Math.sin(r) * 50));
    ticks.appendChild(l);
  }

  ui.show = (name, on = true) => { if (ui.screens[name]) ui.screens[name].hidden = !on; };
  ui.only = (...names) => { for (const k of Object.keys(ui.screens)) ui.screens[k].hidden = !names.includes(k); };

  let cueTimer = 0;
  ui.cue_ = (html, ms = 2600) => {
    ui.cue.innerHTML = html;
    ui.cue.classList.add('on');
    clearTimeout(cueTimer);
    if (ms) cueTimer = setTimeout(() => ui.cue.classList.remove('on'), ms);
  };
  ui.clearCue = () => { ui.cue.classList.remove('on'); };

  ui.countdown = (n) => { ui.count.innerHTML = n ? `<span>${n}</span>` : ''; if (n) tick(); };

  // Last-written values, so the DOM is only touched on change.
  const last = { speed: -1, air: -1, roll: -9999, alt: -1, sink: -1, phase: '' };
  ui.hud = ({ speed, air, rollDeg, alt, sink, phase, throttles, rollAngle }) => {
    const sp = Math.round(speed * 3.6);
    if (sp !== last.speed) { ui.speed.textContent = String(sp); last.speed = sp; }
    const a = Math.round(air);
    if (a !== last.air) { ui.air.textContent = String(a); ui.airBar.style.transform = `scaleX(${a / 100})`; last.air = a; }
    const r = Math.round(rollDeg);
    if (r !== last.roll) {
      ui.roll.textContent = `${r}°`;
      ui.rollArc.style.strokeDasharray = `${Math.min(360, r)} 360`;
      ui.rollArc.classList.toggle('done', r >= 330);
      last.roll = r;
    }
    ui.glyph.setAttribute('transform', `rotate(${(rollAngle * 180) / Math.PI + 90} 60 60)`);
    const al = Math.round(alt * 10);
    if (al !== last.alt) { ui.alt.textContent = (al / 10).toFixed(1); last.alt = al; }
    const sk = Math.round(sink * 10);
    if (sk !== last.sink) { ui.sink.textContent = (Math.max(0, sk) / 10).toFixed(1); last.sink = sk; }
    if (phase !== last.phase) { ui.phase.textContent = phase; last.phase = phase; }
    for (let i = 0; i < ui.nz.length; i++) {
      const p = throttles[i];
      ui.nz[i].style.fill = p > 0.02 ? `rgba(191,230,255,${0.25 + p * 0.75})` : '';
    }
  };

  // --- Results ---------------------------------------------------------------------------
  ui.results = (card) => {
    $('[data-r-verdict]').textContent = card.verdict;
    $('[data-r-headline]').textContent = 'The panel';
    const total = $('[data-r-total]');
    const t0 = performance.now();
    const roll = (now) => {
      const k = Math.min(1, (now - t0) / 1400);
      total.textContent = (card.total * (1 - (1 - k) ** 3)).toFixed(1);
      if (k < 1) requestAnimationFrame(roll);
    };
    requestAnimationFrame(roll);
    const list = $('[data-r-judges]');
    list.innerHTML = '';
    card.judges.forEach((j, i) => {
      const li = document.createElement('li');
      li.style.animationDelay = `${0.35 + i * 0.25}s`;
      li.dataset.judge = j.id;
      li.innerHTML = `<span class="who"></span><span class="role"></span><span class="score"></span><p class="quote typing"></p>`;
      li.querySelector('.who').textContent = j.name;
      li.querySelector('.role').textContent = j.title;
      li.querySelector('.score').textContent = j.score.toFixed(1);
      list.appendChild(li);
      setTimeout(() => chime(i), 450 + i * 250);
    });
    const cats = $('[data-r-cats]');
    cats.innerHTML = '';
    for (const c of CATEGORIES) {
      const v = card.categories[c.id] ?? 0;
      const el = document.createElement('div');
      el.className = 'cat';
      el.innerHTML = `<div class="lbl"><span></span><b></b></div><div class="bar"><span></span></div>`;
      el.querySelector('.lbl span').textContent = c.label;
      el.querySelector('.lbl b').textContent = v.toFixed(1);
      cats.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector('.bar span').style.transform = `scaleX(${v / 10})`; }));
    }
    const f = card.facts;
    const facts = [
      [`${f.launchKmh} km/h at the lip`], [`${f.apex} m apex`], [`${f.rollDeg}° roll`],
      [f.contact ? 'contact' : `${f.clearance} m clearance`, f.contact], [`${f.sink} m/s touchdown`, f.sink > 4],
      [`${f.tiltDeg}° tilt`, f.tiltDeg > 15], [`${f.wheelSpreadMs} ms wheel sync`, f.wheelSpreadMs > 250], [`${f.padMiss} m from the mark`], [`${f.airPct}% air left`],
    ];
    if (f.bottomOut) facts.push(['bottomed out', true]);
    if (f.flipped) facts.push(['rolled over', true]);
    const ul = $('[data-r-facts]');
    ul.innerHTML = '';
    for (const [txt, bad] of facts) { const li = document.createElement('li'); li.textContent = txt; if (bad) li.className = 'bad'; ul.appendChild(li); }
    $('[data-r-submit-msg]').textContent = '';
    $('[data-receipt]').hidden = true;
  };

  // Type the words into each judge's quote.
  ui.words = (words) => {
    if (!words) return;
    if (words.headline) $('[data-r-headline]').textContent = words.headline;
    for (const id of ['engineer', 'coordinator', 'designer']) {
      const q = document.querySelector(`[data-judge="${id}"] .quote`);
      if (!q) continue;
      const text = words[id] || '';
      let i = 0;
      q.textContent = '';
      q.classList.add('typing');
      const delay = { engineer: 0, coordinator: 500, designer: 1000 }[id];
      setTimeout(function type() {
        q.textContent = text.slice(0, ++i);
        if (i < text.length) setTimeout(type, 14);
        else q.classList.remove('typing');
      }, delay);
    }
  };

  // The AI receipt: what ran, where, how fast, what it cost, and the call itself on request.
  ui.receipt = (meta, { onReplay, onChange } = {}) => {
    const r = $('[data-receipt]');
    const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const model = String(meta.model || '').replace(/^@cf\/[^/]+\//, '');
    const parts = meta.ok
      ? [`${meta.inTokens} → ${meta.outTokens} tokens`, meta.totalMs != null ? `${(meta.totalMs / 1000).toFixed(2)} s` : null,
        meta.neurons != null ? `${meta.neurons} neurons` : null, meta.costUsd != null ? `$${meta.costUsd.toFixed(6)}` : 'billed by provider'].filter(Boolean)
      : [meta.error || 'offline', 'local lines'];
    r.innerHTML = `
      <div class="rc-head"><span class="rc-dot${meta.ok ? '' : ' off'}"></span><b>${meta.ok ? 'Judged by' : 'AI unavailable'}</b> <code>${esc(model)}</code> <span class="rc-where">${esc(meta.where || '')}</span></div>
      <div class="rc-stats">${parts.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
      <div class="rc-actions"><button type="button" class="btn link" data-rc-replay>Replay the call</button><button type="button" class="btn link" data-rc-change>Change AI</button></div>
      ${meta.user ? `<details class="rc-inspect"><summary>Inspect the call</summary>
        <h4>System</h4><pre>${esc(meta.system)}</pre><h4>Prompt</h4><pre>${esc(meta.user)}</pre>
        ${meta.raw ? `<h4>Response</h4><pre>${esc(meta.raw)}</pre>` : ''}</details>` : ''}`;
    r.hidden = false;
    r.querySelector('[data-rc-replay]').onclick = onReplay;
    r.querySelector('[data-rc-change]').onclick = onChange;
  };

  ui.board = (rows) => {
    const ol = $('[data-board-rows]');
    ol.innerHTML = '';
    if (!rows) { ol.innerHTML = '<li class="empty">The board is offline right now.</li>'; return; }
    if (!rows.length) { ol.innerHTML = '<li class="empty">No jumps yet today. Be the first.</li>'; return; }
    for (const r of rows) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="ini"></span><span class="v"></span><span class="t"></span>';
      li.querySelector('.ini').textContent = r.initials;
      li.querySelector('.v').textContent = `${r.verdict} · ${r.facts.rollDeg}° · ${r.facts.sink} m/s`;
      li.querySelector('.t').textContent = Number(r.total).toFixed(1);
      ol.appendChild(li);
    }
  };

  return ui;
}
