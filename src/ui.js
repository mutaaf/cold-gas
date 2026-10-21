// DOM: the HUD (updated in place, no layout thrash), the results sheet, the board.
import { NOZZLES } from './sim/vehicle.js';
import { categoriesFor, TIERS } from './sim/judge.js';
import { NOZZLE_UI } from './valves.js';
import { chime, tick } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);

// The phase timeline: one flight, in order. The Show and the Wall share the Wall's sequence (the
// Wall has no row: its carry is the fall off the lip); the Lineup lifts off flat ground and rolls.
export const PHASES = {
  show: [['runup', 'Run-up'], ['climb', 'Climb'], ['hang', 'Hang'], ['release', 'Release'], ['carry', 'Carry'], ['brake', 'Brake'], ['touchdown', 'Touchdown']],
  wall: [['runup', 'Run-up'], ['climb', 'Climb'], ['hang', 'Hang'], ['release', 'Release'], ['carry', 'Carry'], ['brake', 'Brake'], ['touchdown', 'Touchdown']],
  lineup: [['runup', 'Run-up'], ['liftoff', 'Lift-off'], ['roll', 'Roll'], ['brake', 'Brake'], ['touchdown', 'Touchdown']],
};
// Tenths of a second → "T+00:12.4" (minus sign in the countdown).
export function missionClock(tenths) {
  const neg = tenths < 0, t = Math.abs(tenths), m = Math.floor(t / 600), s = (t % 600) / 10;
  return `${neg ? '−' : '+'}${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export function createUI() {
  const ui = {
    screens: Object.fromEntries([...document.querySelectorAll('[data-screen]')].map((el) => [el.dataset.screen, el])),
    speed: $('[data-speed]'), speedBig: $('[data-speed-big]'), air: $('[data-air]'), airBar: $('[data-air-bar]'),
    roll: $('[data-roll]'), alt: $('[data-alt]'), sink: $('[data-sink]'), rollArc: $('[data-roll-arc]'),
    pitch: $('[data-pitch]'), tankBar: $('[data-tank-bar]'), n2State: $('[data-n2-state]'), clock: $('[data-clock]'), timeline: $('[data-timeline]'),
    cue: $('[data-cue]'), count: $('[data-count]'), touch: $('[data-touch]'),
  };

  // Nozzle diagram: top-down, nose up, mapped from body x/z (+x is the car's left, drawn on the
  // left). Each nozzle is a dot that fills with its valve and a ring that sweeps to its valve %;
  // in Advanced each also carries its key.
  const NS = 'http://www.w3.org/2000/svg';
  const nzGroup = $('[data-nz]');
  const ringLen = 2 * Math.PI * 11;
  ui.nz = NOZZLES.map((n) => {
    const g = document.createElementNS(NS, 'g');
    const x = 60 - n.pos.x * 34, y = 100 - n.pos.z * 38;
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    g.setAttribute('class', `nzg g-${n.group}`);
    const r = n.group === 'lift' ? 8 : 5;
    // Keys beside each nozzle; the rear row's four sit 9 px apart, so theirs spread out under the tail.
    const kx = n.group === 'rear' ? (x - 60) * 2.2 : n.pos.x > 0 ? -17 : 17, ky = n.group === 'rear' ? 20 : 3.5;
    g.innerHTML = `<circle class="nz" r="${r}"/><circle class="nz-ring" r="11" pathLength="${ringLen.toFixed(1)}" stroke-dasharray="0 ${ringLen.toFixed(1)}" transform="rotate(-90)"/><text class="nz-k" x="${kx.toFixed(1)}" y="${ky}">${NOZZLE_UI[n.id].key}</text>`;
    nzGroup.appendChild(g);
    return { dot: g.querySelector('.nz'), ring: g.querySelector('.nz-ring'), last: -1 };
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

  ui.countdown = (n) => { ui.count.innerHTML = n ? `<span${typeof n === 'string' ? ' class="word"' : ''}>${n}</span>` : ''; if (n) tick(); };

  // The flight's phases, as the timeline shows them (src/main.js decides which one you're in).
  ui.timelineFor = (course) => {
    const list = PHASES[course] || PHASES.show;
    if (ui.timeline.dataset.course === course) return;
    ui.timeline.dataset.course = course;
    ui.timeline.innerHTML = list.map(([id, label], i) => `<li data-ph="${id}"><i aria-hidden="true"></i><span><em>${String(i + 1).padStart(2, '0')}</em> ${label}</span></li>`).join('');
    ui.phaseEls = [...ui.timeline.children];
    last.phaseKey = '';
  };

  // Last-written values, so the DOM is only touched on change. Numbers glide to their targets (a
  // first-order lag of ≈90 ms: readable, never late) and are written only when the shown digits
  // change; tabular figures keep every digit in its place.
  const last = { speed: -1, speedBig: -1, air: -1, roll: -9999, alt: -1, sink: -1, g: -1, gState: '', fan: -1, phaseKey: '', airborne: null, clock: -99999, pitch: -999, n2: '', kg: -1, bar: -1, gas: '' };
  const tw = { speed: 0, alt: 0, sink: 0, t: 0 };
  const gEl = $('[data-g]'), fanEl = $('[data-fan]'), n2El = $('[data-tank]');
  const hudEl = ui.screens.hud;
  ui.setClock = (sec) => { const cl = Math.round(sec * 10); if (cl !== last.clock) { ui.clock.textContent = missionClock(cl); last.clock = cl; } };
  ui.resetHud = () => { tw.speed = 0; tw.alt = 0; tw.sink = 0; tw.t = 0; last.phaseKey = ''; };
  ui.hud = ({ speed, air, gasKg = 0, tankBar = 0, gasState = 'reg', rollDeg, alt, sink, phaseKey = '', clock = 0, pitch = 0, throttles, g = 1, fan = 0, airborne = false }) => {
    const now = performance.now(), dt = tw.t ? Math.min(0.1, (now - tw.t) / 1000) : 1;
    tw.t = now;
    const k = 1 - Math.exp(-dt / 0.09);
    tw.speed += (speed - tw.speed) * k; tw.alt += (alt - tw.alt) * k; tw.sink += (sink - tw.sink) * k;
    if (airborne !== last.airborne) { hudEl.toggleAttribute('data-air', airborne); last.airborne = airborne; }
    const gg = Math.round(g * 10);   // already a 0.5 s window (src/hud-telemetry.js): no glide on top
    if (gg !== last.g) {
      gEl.textContent = (gg / 10).toFixed(1); last.g = gg;
      const st = g > 4.5 ? 'warn' : g > 3 ? 'caution' : '';
      if (st !== last.gState) { gEl.parentElement.dataset.state = st; last.gState = st; }
    }
    const ff = Math.round(fan);   // kgf, as the livestream's DOWNFORCE channel reads it
    if (ff !== last.fan) { fanEl.textContent = String(ff); last.fan = ff; }
    const sp = Math.round(tw.speed * 3.6);
    if (sp !== last.speed) { ui.speed.textContent = String(sp); ui.speedBig.textContent = String(sp); last.speed = sp; }
    // N₂: kg left (the bar under it is the fraction of a fill), tank bar, and the regulator's state.
    const a = Math.round(air);
    if (a !== last.air) {
      ui.airBar.style.transform = `scaleX(${a / 100})`; last.air = a;
      const st = a < 15 ? 'warn' : a < 30 ? 'caution' : '';
      if (st !== last.n2) { n2El.dataset.state = st; last.n2 = st; }
    }
    const kg = Math.round(gasKg);
    if (kg !== last.kg) { ui.air.textContent = String(Math.max(0, kg)); last.kg = kg; }
    const br = Math.round(tankBar);
    if (br !== last.bar) { ui.tankBar.textContent = String(br); last.bar = br; }
    if (gasState !== last.gas) { ui.n2State.textContent = gasState === 'blowdown' ? 'Blowdown' : 'Reg'; n2El.dataset.gas = gasState; last.gas = gasState; }
    const r = Math.round(rollDeg);
    if (r !== last.roll) {
      ui.roll.textContent = String(r);
      ui.rollArc.style.strokeDasharray = `${Math.min(360, r)} 360`;
      ui.rollArc.classList.toggle('done', r >= 330);
      last.roll = r;
    }
    const al = Math.round(tw.alt * 10);
    if (al !== last.alt) { ui.alt.textContent = (Math.max(0, al) / 10).toFixed(1); last.alt = al; }
    const sk = Math.round(tw.sink * 10);
    if (sk !== last.sink) { ui.sink.textContent = (Math.max(0, sk) / 10).toFixed(1); last.sink = sk; }
    // Pitch, whole degrees: up the deck 0–180 (unsigned), in the air signed (+ nose up). The bank is the ADI's.
    const pt = Math.round(pitch), pk = pt * 2 + (airborne ? 1 : 0);   // the sign shows only in the air
    if (pk !== last.pitch) { ui.pitch.textContent = airborne && pt > 0 ? `+${pt}` : String(pt); last.pitch = pk; }
    // The mission clock: T− in the countdown, T+ from the green light, in tenths.
    const cl = Math.round(clock * 10);
    if (cl !== last.clock) { ui.clock.textContent = missionClock(cl); last.clock = cl; }
    if (phaseKey !== last.phaseKey && ui.phaseEls) {
      const at = ui.phaseEls.findIndex((li) => li.dataset.ph === phaseKey);
      ui.phaseEls.forEach((li, i) => { li.dataset.state = at < 0 ? '' : i < at ? 'done' : i === at ? 'now' : ''; });
      hudEl.dataset.phase = phaseKey;
      last.phaseKey = phaseKey;
    }
    for (let i = 0; i < ui.nz.length; i++) {
      const n = ui.nz[i], v = Math.round(throttles[i] * 40);
      if (v === n.last) continue;
      n.last = v;
      const p = v / 40;
      n.dot.style.fill = p > 0.02 ? `rgba(245,246,248,${(0.3 + p * 0.7).toFixed(2)})` : '';
      n.ring.setAttribute('stroke-dasharray', `${(p * ringLen).toFixed(1)} ${ringLen.toFixed(1)}`);
    }
  };

  // The damage sensor: per-zone shading (caution from 10 %, warning from 40 %), the total with its
  // state word, and a flash on every new hit.
  const dmgEl = $('[data-dmg]'), dmgPct = $('[data-dmg-pct]'), dmgWord = $('[data-dmg-word]');
  const dmgZones = dmgEl ? Object.fromEntries([...dmgEl.querySelectorAll('[data-z]')].map((el) => [el.dataset.z, el])) : {};
  const ZONE_ORDER = ['nose', 'tail', 'left', 'right', 'roof', 'floor', 'susp'];
  const lastDmg = { total: -1, hit: -1, z: ZONE_ORDER.map(() => -1) };
  ui.damage = (d) => {
    if (!dmgEl || !d) return;
    for (let k = 0; k < ZONE_ORDER.length; k++) {
      const v = Math.round(d.zones[k]);
      if (v === lastDmg.z[k]) continue;
      lastDmg.z[k] = v;
      const el = dmgZones[ZONE_ORDER[k]];
      el.style.setProperty('--dmg', String(v / 100));
      el.dataset.level = v >= 40 ? 'red' : v >= 10 ? 'amber' : v > 0 ? 'scuff' : '';
    }
    const t = Math.round(d.total);
    if (t !== lastDmg.total) {
      dmgPct.textContent = String(t);
      const st = t >= 60 ? 'wreck' : t >= 25 ? 'warn' : t > 0 ? 'scuffed' : 'ok';
      dmgEl.dataset.state = st;
      dmgWord.textContent = { ok: 'Intact', scuffed: 'Scuffed', warn: 'Damaged', wreck: 'Wrecked' }[st];
      lastDmg.total = t;
    }
    if (d.lastTick !== lastDmg.hit) {
      if (lastDmg.hit >= 0 || d.lastTick >= 0) { dmgEl.classList.remove('hit'); void dmgEl.offsetWidth; dmgEl.classList.add('hit'); }
      lastDmg.hit = d.lastTick;
    }
  };
  ui.damageReset = () => {
    lastDmg.total = -1; lastDmg.hit = -1; lastDmg.z.fill(-1);
    if (!dmgEl) return;
    dmgEl.classList.remove('hit'); dmgEl.dataset.state = 'ok'; dmgPct.textContent = '0'; dmgWord.textContent = 'Intact';
    for (const el of Object.values(dmgZones)) { el.dataset.level = ''; el.style.removeProperty('--dmg'); }
  };

  // --- Results ---------------------------------------------------------------------------
  // The run line over the actions: which run this is, and how it stands against your best on this
  // device (`best` is the stored best before this run; null when there's none yet). n = 0: the
  // reference jump, which isn't yours.
  ui.runline = (n, best, total) => {
    const line = $('[data-runline]'), pb = $('[data-r-pb]');
    line.hidden = !n;
    if (!n) return;
    $('[data-r-attempt]').textContent = `Run ${n}`;
    const d = best == null ? null : Math.round((total - best) * 10) / 10;
    line.dataset.state = best == null ? (total > 0 ? 'first' : '') : d > 0 ? 'best' : d === 0 ? 'tie' : 'behind';
    pb.textContent = best == null ? (total > 0 ? 'Your first mark on this event' : '')
      : d > 0 ? `New best · +${d.toFixed(1)}` : d === 0 ? `Equals your best · ${best.toFixed(1)}` : `Best ${best.toFixed(1)} · ${d.toFixed(1)} to beat it`;
  };

  // `practice`: { drill, result } for a drill (not scored: no panel, no board).
  ui.results = (card, practice = null) => {
    const sheet = ui.screens.results;
    sheet.toggleAttribute('data-practice', !!practice);
    $('[data-drill-card]').hidden = !practice;
    $('[data-coach]').hidden = true;
    const tier = TIERS[card.tier] || TIERS.assist;
    $('[data-r-tier]').innerHTML = practice ? `Practice · <b>${practice.drill.label}</b> · not scored`
      : `Flown in <b>${tier.label}</b>${tier.factor > 1 ? ` · the panel pays <b>×${tier.factor.toFixed(2)}</b> for raw piloting` : ' · Pro pays ×1.08, Advanced ×1.15'}`;
    if (practice) {
      $('[data-r-verdict]').textContent = practice.result.headline;
      $('[data-r-headline]').textContent = practice.result.pass ? `${practice.drill.goal} · done` : practice.drill.goal;
      const ul = $('[data-drill-stats]');
      ul.innerHTML = '';
      for (const [txt, bad] of practice.result.stats) { const li = document.createElement('li'); li.textContent = txt; if (bad) li.className = 'bad'; ul.appendChild(li); }
    }
    $('[data-r-verdict]').textContent = practice ? practice.result.headline : card.verdict;
    if (!practice) $('[data-r-headline]').textContent = 'The panel';
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
    for (const c of categoriesFor(card.course)) {
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
    const facts = f.course === 'show' ? showFacts(f) : f.course === 'wall' ? [
      [`${f.entryKmh} km/h into the curl`], [`${f.height} m up the wall`], [`${f.invertedS} s inverted`], [gPeak(f)],
      ...(f.jumped ? [[`released at ${f.launchHeight} m`], [`${Math.max(f.rollDeg, f.pitchDeg)}° roll-out`], [`${f.sink} m/s touchdown`, f.sink > 4],
        [`${f.tiltDeg}° tilt`, f.tiltDeg > 15], [`${f.wheelSpreadMs} ms wheel sync`, f.wheelSpreadMs > 250], [`${f.padMiss} m from the mark`], [`${f.airPct}% gas left`]] : []),
      ...(f.zeroToSixty ? [[`0–60 in ${f.zeroToSixty.toFixed(2)} s`]] : []),
      ...(f.fellOff ? [['slid off the deck', true]] : []), ...(f.landedOnRamp ? [['came down on the deck', true]] : []),
    ] : [
      [`${f.launchKmh} km/h at the lip`], [`${f.apex} m apex`], [`${f.rollDeg}° roll`],
      [f.contact ? 'contact' : `${f.clearance} m clearance`, f.contact], [`${f.sink} m/s touchdown`, f.sink > 4],
      [`${f.tiltDeg}° tilt`, f.tiltDeg > 15], [`${f.wheelSpreadMs} ms wheel sync`, f.wheelSpreadMs > 250], [`${f.padMiss} m from the mark`], [`${f.airPct}% air left`],
    ];
    if (f.bottomOut) facts.push(['bottomed out', true]);
    if (f.flipped) facts.push(['rolled over', true]);
    if (f.damagePct != null) facts.push([f.damagePct >= 60 ? `wrecked · ${f.damagePct}% damage` : `${f.integrity}% intact`, f.damagePct >= 25]);
    const ul = $('[data-r-facts]');
    ul.innerHTML = '';
    for (const [txt, bad] of facts) { const li = document.createElement('li'); li.textContent = txt; if (bad) li.className = 'bad'; ul.appendChild(li); }
    $('[data-r-submit-msg]').textContent = '';
    $('[data-receipt]').hidden = true;
  };

  // The coach (src/sim/coach.js): the fixes that matter, most costly first.
  ui.coaching = (items) => {
    const box = $('[data-coach]'), ol = $('[data-coach-items]');
    ol.innerHTML = '';
    for (const it of items || []) {
      const li = document.createElement('li');
      li.dataset.fix = it.id;
      li.innerHTML = '<b></b><p class="cd"></p><p class="cf"></p>';
      li.querySelector('b').textContent = it.title;
      li.querySelector('.cd').textContent = it.detail;
      li.querySelector('.cf').textContent = it.fix;
      ol.appendChild(li);
    }
    box.hidden = !items?.length;
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
      <div class="rc-actions"><button type="button" class="btn link" data-rc-replay>Replay the call</button><button type="button" class="btn link" data-rc-change>${meta.provider === 'edge' ? 'Use your own AI key' : 'Change AI'}</button></div>
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

// The g number a player compares with the reveal's 3.3 G: the braking peak (0.5 s averaged, roof
// up, down-jets on), not the release kick or a contact spike. No brake flown: the run's peak load.
const gPeak = (f) => (f.brakeG > 0 ? `${f.brakeG} g braking peak at ${f.brakeH} m` : `${f.maxG} g peak`);

// The Show's results: the climb, the carry over the row, the landing.
function showFacts(f) {
  const out = [[`${f.height} m up the wall`], [`${f.invertedS} s inverted`], [gPeak(f)]];
  if (f.fellOff) out.push(['slid off the deck', true]);
  if (f.landedOnRamp) out.push(['came down on the deck', true]);
  if (!f.jumped) return out;
  out.push([`released at ${f.launchHeight} m`]);
  if (f.contact) out.push(['contact with the row', true]);
  else if (!f.crossedRow) out.push(['short of the row', true]);
  else out.push([`${f.clearance} m over the roofs`]);
  out.push([`${Math.max(f.rollDeg, f.pitchDeg)}° roll-out`], [`${f.sink} m/s touchdown`, f.sink > 4], [`${f.padMiss} m from the mark`], [`${f.airPct}% gas left`]);
  return out;
}
