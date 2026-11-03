// DOM: the HUD (updated in place, no layout thrash), the results sheet, the board.
import { NOZZLES } from './sim/vehicle.js';
import { categoriesFor, TIERS, WRECK_PCT } from './sim/judge.js';
import { NOZZLE_UI } from './valves.js';
import { chime, tick } from './audio.js';
import { speedK, lenK, rateK, massK, kgfK, pressK, k as uk, u as uu, onUnits, localize, unitText } from './units.js';
import { ZONES, hitCost } from './sim/damage.js';
import { HIT, SCRAPE, WHEEL, PART } from './sim/impacts.js';
import { initHudMode } from './hud-mode.js';
import { countSlot } from './count-slot.js';

const $ = (sel, root = document) => root.querySelector(sel);

// The phase timeline: one flight, in order. The Show and the Wall share the Wall's sequence (the
// Wall has no row: its carry is the fall off the lip); the Lineup lifts off flat ground and rolls.
export const PHASES = {
  show: [['runup', 'Run-up'], ['climb', 'Climb'], ['hang', 'Hang'], ['release', 'Release'], ['carry', 'Carry'], ['brake', 'Brake'], ['touchdown', 'Touchdown']],
  wall: [['runup', 'Run-up'], ['climb', 'Climb'], ['hang', 'Hang'], ['release', 'Release'], ['carry', 'Carry'], ['brake', 'Brake'], ['touchdown', 'Touchdown']],
  lineup: [['runup', 'Run-up'], ['liftoff', 'Lift-off'], ['roll', 'Roll'], ['brake', 'Brake'], ['touchdown', 'Touchdown']],
};
// The timeline's last step on a run that ended in a crash (0072): the end the sim called, or what
// the judge saw, never TOUCHDOWN over a car on its roof. '' for a clean end (it stays TOUCHDOWN).
export function crashStep(card) {
  const f = card?.facts;
  if (!f?.crashed) return '';
  if (f.endReason === 'flipped' || f.flipped) return 'Flipped';
  if (f.endReason === 'contact' || f.contact) return 'Contact';
  if (f.damagePct >= WRECK_PCT) return 'Wrecked';
  if (f.fellOff) return 'Fell off';
  return 'Crash';
}
// Tenths of a second → "T+00:12.4" (minus sign in the countdown).
export function missionClock(tenths) {
  const neg = tenths < 0, t = Math.abs(tenths), m = Math.floor(t / 600), s = (t % 600) / 10;
  return `${neg ? '−' : '+'}${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export function createUI() {
  initHudMode();   // compact or full HUD on this device (src/hud-mode.js), before the HUD first shows
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

  // The cue line. Callers may ask every frame (src/main.js cues()): the DOM is written only when the
  // message changes; the same message just pushes its hide deadline out. A new message waits until
  // the one on screen has held for its minimum (400 ms, longer for "Go"), so two conditions on a
  // threshold can't flap the line; only the latest waiting message is kept. Deadlines are checked
  // from the frame loop (ui.tickCue), not timers. `ms` 0 holds the message until it's replaced.
  const CUE_HOLD = 400;
  const cue = { html: '', on: false, at: 0, hold: 0, until: 0, next: null, nextMs: 0, nextHold: 0 };
  const showCue = (html, ms, hold, now) => {
    ui.cue.innerHTML = localize(html, { html: true });
    if (!cue.on) { ui.cue.classList.add('on'); cue.on = true; }
    cue.html = html; cue.at = now; cue.hold = hold; cue.until = ms ? now + ms : Infinity;
  };
  ui.cue_ = (html, ms = 2600, { hold = CUE_HOLD } = {}) => {
    const now = performance.now();
    if (cue.on && html === cue.html) {
      cue.next = null;   // asked again for what's showing: whatever was waiting is stale
      cue.until = ms ? Math.max(cue.until, now + ms) : Infinity;
      return;
    }
    if (cue.on && now - cue.at < cue.hold) { cue.next = html; cue.nextMs = ms; cue.nextHold = hold; return; }
    cue.next = null;
    showCue(html, ms, hold, now);
  };
  ui.tickCue = (now = performance.now()) => {
    if (!cue.on) return;
    if (cue.next !== null && now - cue.at >= cue.hold) { const h = cue.next; cue.next = null; showCue(h, cue.nextMs, cue.nextHold, now); return; }
    if (now >= cue.until && now - cue.at >= cue.hold) { ui.cue.classList.remove('on'); cue.on = false; cue.html = ''; }
  };
  ui.clearCue = () => {
    cue.next = null; cue.html = '';
    if (cue.on) { ui.cue.classList.remove('on'); cue.on = false; }
  };
  // A unit swap re-renders the next ask of the same message in the new units.
  onUnits(() => { if (cue.on) cue.html = ''; });

  // The numeral stands in the free band of the screen (0070, src/count-slot.js): measured once as a countdown
  // starts and held for its ticks. By then the HUD, the top bar and the touch controls are placed, and a cue the
  // countdown carries (a tip, the reference's name, a tier change) is up: startRun sets them before the first tick.
  // Everything the HUD audit holds the numeral clear of (scripts/hud-audit.mjs BOXES); a cue only while it shows.
  const COUNT_CLEAR = '.top .brand, .top-actions, [data-screen="hud"] [data-hud-box], [data-hud-toggle], [data-drill-bar], [data-stick], [data-stick-hint], .buttons, .tbtn, [data-onethumb], [data-nozzle-pad] svg, [data-cue].on';
  const placeCount = (span) => {
    const st = ui.count.style;
    st.removeProperty('--count-top'); st.removeProperty('--count-bot'); st.removeProperty('--count-scale');
    const vw = innerWidth, vh = innerHeight, boxes = [];
    for (const el of document.querySelectorAll(COUNT_CLEAR)) {
      const r = el.getBoundingClientRect();
      if (el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      boxes.push({ x: r.left, r: r.right, y: r.top, b: r.bottom });
    }
    const s = countSlot(vh, boxes, span.offsetWidth, span.offsetHeight, vw);
    if (s.top) st.setProperty('--count-top', `${s.top}px`);
    if (s.bottom) st.setProperty('--count-bot', `${s.bottom}px`);
    if (s.scale < 1) st.setProperty('--count-scale', String(s.scale));
  };
  // Placed on a countdown's first beat, or when the beat changes kind (a digit to READY: a retry from inside a
  // countdown), and again if the screen changes shape under it (a turn, a fold, a resized window).
  ui.countdown = (n) => {
    const prev = ui.count.firstElementChild, word = typeof n === 'string';
    ui.count.innerHTML = n ? `<span${word ? ' class="word"' : ''}>${n}</span>` : '';
    if (!n) return;
    if (!prev || prev.classList.contains('word') !== word) placeCount(ui.count.firstElementChild);
    tick();
  };
  addEventListener('resize', () => { const span = ui.count.firstElementChild; if (span) placeCount(span); });

  // The flight's phases, as the timeline shows them (src/main.js decides which one you're in).
  const rollLbl = $('.adi-roll .h-lbl');
  let rolledMode = false;
  ui.timelineFor = (course) => {
    const list = PHASES[course] || PHASES.show;
    // The Lineup is scored on whole turns (judge.js), so its readout is the roll so far, labelled as
    // such; the Wall and the Show read the bank right now (ticket 0022).
    rolledMode = course === 'lineup';
    rollLbl.textContent = rolledMode ? 'Rolled' : 'Roll';
    if (ui.timeline.dataset.course === course) return;
    ui.timeline.dataset.course = course;
    ui.timeline.innerHTML = list.map(([id, label], i) => `<li data-ph="${id}"><i aria-hidden="true"></i><span><em>${String(i + 1).padStart(2, '0')}</em> ${label}</span></li>`).join('');
    ui.phaseEls = [...ui.timeline.children];
    ui.phaseLabels = Object.fromEntries(list);
    last.phaseKey = '';
  };

  // Last-written values, so the DOM is only touched on change. Numbers glide to their targets (a
  // first-order lag of ≈90 ms: readable, never late) and are written only when the shown digits
  // change; tabular figures keep every digit in its place.
  const LAST0 = { speed: -1, speedBig: -1, air: -1, roll: -9999, bank: -1, alt: -1, sink: -1, g: -1, gState: null, fan: -1, phaseKey: '', crash: '', airborne: null, clock: -99999, pitch: -999, n2: null, kg: -1, bar: -1, gas: '' };
  const last = { ...LAST0 };
  const tw = { speed: 0, alt: 0, sink: 0, t: 0 };
  // A flip of the unit system: every unit-bearing readout writes again on the next frame.
  // Every unit-bearing readout carries the other system beside it, smaller (src/units.js): a
  // [data-2] sub-line written on change, like its primary.
  const two = Object.fromEntries([...document.querySelectorAll('[data-screen="hud"] [data-2]')].map((el) => [el.dataset['2'], el]));
  const last2 = {};
  const set2 = (key, q, si, d = 0) => {
    const v = si * uk(q, true), p = 10 ** d, r = Math.round(v * p);
    if (r === last2[key] || !two[key]) return;
    last2[key] = r;
    const big = q === 'press' && v >= 1000;
    two[key].textContent = big ? `${(Math.round(v / 100) / 10).toFixed(1)}k ${uu(q, true)}` : `${(r / p).toFixed(d)} ${uu(q, true)}`;
  };
  ui.set2 = set2;
  onUnits(() => { last.speed = -1; last.alt = -1; last.sink = -1; last.fan = -1; last.kg = -1; last.bar = -1; for (const key in last2) delete last2[key]; });
  // What the instruments remember about this flight, for their tap-to-open readouts
  // (src/instruments.js): numbers only, updated in place, nothing allocated per frame.
  const stats = ui.stats = {
    peakG: 1, peakGAt: 0, peakGPhase: '', g: 1, clock: 0, maxSpeed: 0,
    gasStart: -1, gasKg: 0, gasPrev: -1, gasPrevT: 0, draw: 0, peakDraw: 0, tankBar: 0, gasState: 'reg',
    splits: [], throttles: null, phaseKey: '',
  };
  const resetStats = () => {
    Object.assign(stats, { peakG: 1, peakGAt: 0, peakGPhase: '', g: 1, clock: 0, maxSpeed: 0, gasStart: -1, gasPrev: -1, gasPrevT: 0, draw: 0, peakDraw: 0, phaseKey: '' });
    stats.splits.length = 0;
  };
  const gEl = $('[data-g]'), fanEl = $('[data-fan]'), n2El = $('[data-tank]');
  const hudEl = ui.screens.hud;
  ui.setClock = (sec) => { const cl = Math.round(sec * 10); if (cl !== last.clock) { ui.clock.textContent = missionClock(cl); last.clock = cl; } };
  // A new flight: forget every written value (the next ui.hud writes every cell from scratch, so a
  // retry's countdown shows this run's start, not the last run's end) and the glide.
  ui.resetHud = () => {
    tw.speed = 0; tw.alt = 0; tw.sink = 0; tw.t = 0;
    Object.assign(last, LAST0);
    for (const key in last2) delete last2[key];
    for (const n of ui.nz) n.last = -1;
    // A retry after a crash on the roof must not show the last flight's roll on the start line.
    ui.roll.textContent = '0'; ui.rollArc.style.strokeDasharray = '0 360'; ui.rollArc.classList.remove('done'); last.roll = 0; last.bank = 0;
    resetStats();
  };
  ui.hud = ({ speed, air, gasKg = 0, tankBar = 0, gasState = 'reg', rollDeg, bankDeg = 0, alt, sink, phaseKey = '', crash = '', clock = 0, pitch = 0, throttles, g = 1, fan = 0, airborne = false }) => {
    const now = performance.now(), dt = tw.t ? Math.min(0.1, (now - tw.t) / 1000) : 1;
    tw.t = now;
    const k = 1 - Math.exp(-dt / 0.09);
    tw.speed += (speed - tw.speed) * k; tw.alt += (alt - tw.alt) * k; tw.sink += (sink - tw.sink) * k;
    // The instruments' memory: peak load (after the first half second's window fills), top speed,
    // the gas draw (lb or kg per second of sim time, smoothed over ≈0.3 s) and the throttles.
    stats.g = g; stats.clock = clock; stats.throttles = throttles; stats.gasKg = gasKg; stats.tankBar = tankBar; stats.gasState = gasState;
    if (clock > 0.5 && g > stats.peakG) { stats.peakG = g; stats.peakGAt = clock; stats.peakGPhase = phaseKey; }
    if (speed > stats.maxSpeed) stats.maxSpeed = speed;
    if (stats.gasStart < 0) stats.gasStart = gasKg;
    if (stats.gasPrev >= 0 && clock > stats.gasPrevT + 0.05) {
      const rate = Math.max(0, (stats.gasPrev - gasKg) / (clock - stats.gasPrevT));
      stats.draw += (rate - stats.draw) * Math.min(1, (clock - stats.gasPrevT) / 0.3);
      if (stats.draw > stats.peakDraw) stats.peakDraw = stats.draw;
      stats.gasPrev = gasKg; stats.gasPrevT = clock;
    } else if (stats.gasPrev < 0 || clock < stats.gasPrevT) { stats.gasPrev = gasKg; stats.gasPrevT = clock; }
    if (airborne !== last.airborne) { hudEl.toggleAttribute('data-air', airborne); last.airborne = airborne; }
    const gg = Math.round(g * 10);   // already a 0.5 s window (src/hud-telemetry.js): no glide on top
    if (gg !== last.g) {
      gEl.textContent = (gg / 10).toFixed(1); last.g = gg;
      const st = g > 4.5 ? 'warn' : g > 3 ? 'caution' : '';
      if (st !== last.gState) { gEl.parentElement.dataset.state = st; last.gState = st; }
    }
    const ff = Math.round(fan * kgfK());   // kgf (lbf in US units), as the livestream's DOWNFORCE channel reads it
    if (ff !== last.fan) { fanEl.textContent = String(ff); last.fan = ff; }
    set2('fan', 'kgf', fan);
    const sp = Math.round(tw.speed * speedK());
    if (sp !== last.speed) { ui.speed.textContent = String(sp); ui.speedBig.textContent = String(sp); last.speed = sp; }
    set2('speed', 'speed', tw.speed); set2('speedBig', 'speed', tw.speed);
    // N₂: kg left (the bar under it is the fraction of a fill), tank bar, and the regulator's state.
    const a = Math.round(air);
    if (a !== last.air) {
      ui.airBar.style.transform = `scaleX(${a / 100})`; last.air = a;
      const st = a < 15 ? 'warn' : a < 30 ? 'caution' : '';
      if (st !== last.n2) { n2El.dataset.state = st; last.n2 = st; }
    }
    const kg = Math.round(gasKg * massK());
    if (kg !== last.kg) { ui.air.textContent = String(Math.max(0, kg)); last.kg = kg; }
    set2('kg', 'mass', Math.max(0, gasKg)); set2('bar', 'press', tankBar);
    // Pressure: bar as it is; psi past 1,000 in thousands to a tenth (10.0k), so the cell keeps its width.
    const pv = tankBar * pressK(), br = pv >= 1000 ? 100000 + Math.round(pv / 100) : Math.round(pv);
    if (br !== last.bar) { ui.tankBar.textContent = pv >= 1000 ? `${(Math.round(pv / 100) / 10).toFixed(1)}k` : String(br); last.bar = br; }
    if (gasState !== last.gas) { ui.n2State.textContent = gasState === 'blowdown' ? 'Blowdown' : 'Reg'; n2El.dataset.gas = gasState; last.gas = gasState; }
    // Two roll numbers, one meaning each (ticket 0022): ROLL under the dial is the bank right now, the
    // angle from upright that the ADI draws (0 on the wheels, 90 on a side, 180 on the roof); the arc
    // round the dial is how far the car has rolled in total, filling at 360°. On the Lineup the number
    // is ROLLED, that total (its score counts whole turns).
    const r = Math.round(rollDeg);
    if (r !== last.roll) {
      ui.rollArc.style.strokeDasharray = `${Math.min(360, r)} 360`;
      ui.rollArc.classList.toggle('done', r >= 330);
      last.roll = r;
    }
    const bk = rolledMode ? r : Math.round(bankDeg);
    if (bk !== last.bank) { ui.roll.textContent = String(bk); last.bank = bk; }
    // Altitude to a tenth (whole feet or metres from 100 up, so the cell keeps its width).
    const av = tw.alt * lenK(), al = av >= 99.95 ? 1e6 + Math.round(av) : Math.round(av * 10);
    if (al !== last.alt) { ui.alt.textContent = al >= 1e6 ? String(al - 1e6) : (Math.max(0, al) / 10).toFixed(1); last.alt = al; }
    set2('alt', 'len', Math.max(0, tw.alt), 1); set2('sink', 'rate', Math.max(0, tw.sink), 1);
    const sk = Math.round(tw.sink * rateK() * 10);
    if (sk !== last.sink) { ui.sink.textContent = (Math.max(0, sk) / 10).toFixed(1); last.sink = sk; }
    // Pitch, whole degrees: up the deck 0–180 (unsigned), in the air signed (+ nose up). The bank is the ADI's.
    const pt = Math.round(pitch), pk = pt * 2 + (airborne ? 1 : 0);   // the sign shows only in the air
    if (pk !== last.pitch) { ui.pitch.textContent = airborne && pt > 0 ? `+${pt}` : String(pt); last.pitch = pk; }
    // The mission clock: T− in the countdown, T+ from the green light, in tenths.
    const cl = Math.round(clock * 10);
    if (cl !== last.clock) { ui.clock.textContent = missionClock(cl); last.clock = cl; }
    if ((phaseKey !== last.phaseKey || crash !== last.crash) && ui.phaseEls) {
      const at = ui.phaseEls.findIndex((li) => li.dataset.ph === phaseKey);
      ui.phaseEls.forEach((li, i) => {
        li.dataset.state = at < 0 ? '' : i < at ? 'done' : i === at ? 'now' : '';
        // A crashed end: the step you're on reads as the crash, in signal red (0072).
        const cr = i === at ? crash : '';
        if ((li.dataset.crash || '') === cr) return;
        if (cr) li.dataset.crash = cr; else delete li.dataset.crash;
        li.querySelector('span').lastChild.nodeValue = ` ${cr || ui.phaseLabels[li.dataset.ph]}`;
      });
      hudEl.dataset.phase = phaseKey;
      last.phaseKey = phaseKey; last.crash = crash;
      if (phaseKey && stats.splits[stats.splits.length - 1]?.key !== phaseKey) stats.splits.push({ key: phaseKey, label: ui.phaseLabels?.[phaseKey] || phaseKey, t: clock });
      stats.phaseKey = phaseKey;
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

  // The damage sensor: per-zone shading that eases from scuffed ink through amber (10 %) to red
  // (40 %), the total with its state word, and on every hit a flash where it landed with an arrow
  // the way it came in; the last few hits stay on the car as fading marks. The hits themselves
  // (zone, closing speed, what it cost, the load, when) are kept for the full view
  // (src/damage-view.js). Everything is read from the sim's impact record; nothing is written back.
  const dmgEl = $('[data-dmg]'), dmgPct = $('[data-dmg-pct]'), dmgWord = $('[data-dmg-word]');
  const dmgFx = $('[data-dmg-fx]'), dmgTrail = $('[data-dmg-trail]');
  // The compact line's damage cell (0072): the vehicle panel folds away on a phone, so once the car
  // is hurt the line carries the state word and the % (the HUD's data-damage shows it, in G's place).
  const dmgPct2 = $('[data-dmg-pct2]'), dmgWord2 = $('[data-dmg-word2]');
  const dmgZones = dmgEl ? Object.fromEntries([...dmgEl.querySelectorAll('[data-z]')].map((el) => [el.dataset.z, el])) : {};
  const ZONE_ORDER = ZONES;
  const lastDmg = { total: -1, hit: -1, z: ZONE_ORDER.map(() => -1), seen: 0 };
  const hits = ui.hits = [];          // newest last, at most HIT_KEEP
  const HIT_KEEP = 12;
  const dmgListeners = new Set();
  ui.onDamage = (fn) => { dmgListeners.add(fn); return () => dmgListeners.delete(fn); };
  ui.damageState = { zones: new Float64Array(ZONE_ORDER.length), total: 0 };
  // Where on the 44×80 top view a body-frame point (x left, z forward, m) falls: ≈13 px a metre.
  const svgX = (lx) => Math.max(3, Math.min(41, 22 - lx * 13)), svgY = (lz) => Math.max(4, Math.min(76, 40 - lz * 13));
  // A world vector into the car's frame (q⁻¹·v), into `o`.
  const toBody = (q, x, y, z, o) => {
    const ux = -q.x, uy = -q.y, uz = -q.z, w = q.w;
    const tx = 2 * (uy * z - uz * y), ty = 2 * (uz * x - ux * z), tz = 2 * (ux * y - uy * x);
    o.x = x + w * tx + (uy * tz - uz * ty); o.y = y + w * ty + (uz * tx - ux * tz); o.z = z + w * tz + (ux * ty - uy * tx);
    return o;
  };
  const bp = { x: 0, y: 0, z: 0 }, bn = { x: 0, y: 0, z: 0 };
  const zoneFor = (part, lx) => (part === PART.nose ? 0 : part === PART.tail ? 1 : part === PART.roof ? 4 : part === PART.floor ? 5 : part === PART.wheel ? 6 : lx > 0 ? 2 : 3);
  function recordHits(car) {
    const m = car.impacts;
    if (m.count < lastDmg.seen) lastDmg.seen = 0;
    let fresh = null;
    for (let i = lastDmg.seen; i < m.count; i++) {
      const kind = m.kind[i];
      if (kind !== HIT && kind !== WHEEL && kind !== SCRAPE) continue;
      const cost = hitCost(kind, m.speed[i]);
      if (cost < 0.25) continue;
      toBody(car.quat, m.x[i] - car.pos.x, m.y[i] - car.pos.y, m.z[i] - car.pos.z, bp);
      toBody(car.quat, m.nx[i], m.ny[i], m.nz[i], bn);
      const zone = zoneFor(m.part[i], bp.x);
      const t = stats.clock - (car.tick - m.tick[i]) / 240;
      const prev = hits[hits.length - 1];
      // A slide is many samples: fold it into one entry per zone while it lasts.
      if (kind === SCRAPE && prev && prev.kind === SCRAPE && prev.zone === zone && t - prev.tEnd < 0.5) {
        prev.cost += cost; prev.speed = Math.max(prev.speed, m.speed[i]); prev.tEnd = t; continue;
      }
      const h = { kind, zone, speed: m.speed[i], cost, g: stats.g, t, tEnd: t, sx: svgX(bp.x), sy: svgY(bp.z), fx: -bn.x, fy: -bn.z, id: i };
      hits.push(h); if (hits.length > HIT_KEEP) hits.shift();
      if (kind !== SCRAPE) fresh = h;
    }
    lastDmg.seen = m.count;
    return fresh;
  }
  function flash(h) {
    if (!dmgFx) return;
    // The arrow points along the force on the car (the surface's normal, in plan), ending on the hit.
    const len = Math.hypot(h.fx, h.fy);
    const rot = len > 0.35 ? (Math.atan2(-h.fx, h.fy) * 180) / Math.PI : 0;
    dmgFx.setAttribute('transform', `translate(${h.sx.toFixed(1)} ${h.sy.toFixed(1)})`);
    dmgFx.querySelector('.fx-arrow').setAttribute('transform', `rotate(${rot.toFixed(0)})`);
    dmgFx.classList.toggle('flat', len <= 0.35);
    dmgFx.dataset.sev = h.cost >= 15 ? 'red' : h.cost >= 4 ? 'amber' : '';
    dmgFx.classList.remove('on'); void dmgEl.offsetWidth; dmgFx.classList.add('on');
    if (dmgTrail) {
      const marks = hits.filter((x) => x.kind !== SCRAPE).slice(-5);
      dmgTrail.innerHTML = marks.map((x, i) => `<circle cx="${x.sx.toFixed(1)}" cy="${x.sy.toFixed(1)}" r="1.5" style="opacity:${(0.25 + (0.6 * (i + 1)) / marks.length).toFixed(2)}"/>`).join('');
    }
  }
  ui.damage = (d, car) => {
    if (!dmgEl || !d) return;
    let changed = false;
    for (let k = 0; k < ZONE_ORDER.length; k++) {
      ui.damageState.zones[k] = d.zones[k];
      const v = Math.round(d.zones[k]);
      if (v === lastDmg.z[k]) continue;
      lastDmg.z[k] = v; changed = true;
      const el = dmgZones[ZONE_ORDER[k]];
      el.style.setProperty('--dmg', String(v / 100));
      el.dataset.level = v >= 40 ? 'red' : v >= 10 ? 'amber' : v > 0 ? 'scuff' : '';
    }
    ui.damageState.total = d.total;
    const t = Math.round(d.total);
    if (t !== lastDmg.total) {
      dmgPct.textContent = String(t);
      const st = t >= 60 ? 'wreck' : t >= 25 ? 'warn' : t > 0 ? 'scuffed' : 'ok';
      dmgEl.dataset.state = st;
      dmgWord.textContent = dmgWord2.textContent = { ok: 'Intact', scuffed: 'Scuffed', warn: 'Damaged', wreck: 'Wrecked' }[st];
      dmgPct2.textContent = String(t);
      if (st === 'ok') delete hudEl.dataset.damage; else hudEl.dataset.damage = st;
      lastDmg.total = t; changed = true;
    }
    const fresh = car && car.impacts ? recordHits(car) : null;
    if (d.lastTick !== lastDmg.hit) {
      if (lastDmg.hit >= 0 || d.lastTick >= 0) { dmgEl.classList.remove('hit'); void dmgEl.offsetWidth; dmgEl.classList.add('hit'); }
      lastDmg.hit = d.lastTick; changed = true;
    }
    if (fresh) flash(fresh);
    if (changed || fresh) for (const fn of dmgListeners) fn(fresh);
  };
  ui.damageReset = () => {
    lastDmg.total = -1; lastDmg.hit = -1; lastDmg.z.fill(-1); lastDmg.seen = 0; hits.length = 0;
    ui.damageState.zones.fill(0); ui.damageState.total = 0;
    if (!dmgEl) return;
    dmgEl.classList.remove('hit'); dmgEl.dataset.state = 'ok'; dmgPct.textContent = dmgPct2.textContent = '0'; dmgWord.textContent = dmgWord2.textContent = 'Intact';
    delete hudEl.dataset.damage;
    for (const el of Object.values(dmgZones)) { el.dataset.level = ''; el.style.removeProperty('--dmg'); }
    dmgFx?.classList.remove('on'); if (dmgTrail) dmgTrail.innerHTML = '';
    for (const fn of dmgListeners) fn(null);
  };

  // --- Results ---------------------------------------------------------------------------
  // The run line over the actions: which run this is, and how it stands against your best on this
  // device (`best` is the stored best before this run; null when there's none yet). n = 0: the
  // reference jump, which isn't yours.
  // A crash or a wreck is never celebrated (no "first mark", no "new best"): it gets a neutral tag. Run 1
  // reads its tier plainly (no "Pro pays ×1.08" before the player has landed anything).
  let lastCard = null;
  ui.runline = (n, best, total) => {
    const line = $('[data-runline]'), pb = $('[data-r-pb]');
    line.hidden = !n;
    if (!n) return;
    $('[data-r-attempt]').textContent = `Run ${n}`;
    const f = lastCard?.facts || {};
    const crashed = !!(f.crashed || f.damagePct >= WRECK_PCT);
    const d = best == null ? null : Math.round((total - best) * 10) / 10;
    if (crashed && (best == null || d >= 0)) {
      line.dataset.state = 'neutral';
      pb.textContent = !f.jumped ? 'No jump · not a mark yet' : f.damagePct >= WRECK_PCT ? 'Wrecked · not a mark yet' : 'Crashed · not a mark yet';
    } else {
      line.dataset.state = best == null ? (total > 0 ? 'first' : '') : d > 0 ? 'best' : d === 0 ? 'tie' : 'behind';
      pb.textContent = best == null ? (total > 0 ? 'Your first mark on this event' : '')
        : d > 0 ? `New best · +${d.toFixed(1)}` : d === 0 ? `Equals your best · ${best.toFixed(1)}` : `Best ${best.toFixed(1)} · ${d.toFixed(1)} to beat it`;
    }
    if (n === 1 && lastCard) $('[data-r-tier]').innerHTML = `Flown in <b>${(TIERS[lastCard.tier] || TIERS.assist).label}</b>`;
  };

  // `practice`: { drill, result } for a drill (not scored: no panel, no board).
  ui.results = (card, practice = null) => {
    const sheet = ui.screens.results;
    lastCard = practice ? null : card;
    ui.liveCall(null);
    sheet.toggleAttribute('data-practice', !!practice);
    $('[data-drill-card]').hidden = !practice;
    $('[data-coach]').hidden = true;
    const tier = TIERS[card.tier] || TIERS.assist;
    $('[data-r-tier]').innerHTML = practice ? `Practice · <b>${practice.drill.label}</b> · not scored`
      : `Flown in <b>${tier.label}</b>${tier.factor > 1 ? ` · the panel pays <b>×${tier.factor.toFixed(2)}</b> for raw piloting` : ' · Pro pays ×1.08, Advanced ×1.15'}`;
    if (practice) {
      $('[data-r-verdict]').textContent = practice.result.headline;
      unitText($('[data-r-headline]'), practice.result.pass ? `${practice.drill.goal} · done` : practice.drill.goal);
      const ul = $('[data-drill-stats]');
      ul.innerHTML = '';
      for (const [txt, bad] of practice.result.stats) { const li = document.createElement('li'); unitText(li, txt); if (bad) li.className = 'bad'; ul.appendChild(li); }
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
    for (const [txt, bad] of facts) { const li = document.createElement('li'); unitText(li, txt); if (bad) li.className = 'bad'; ul.appendChild(li); }
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
      unitText(li.querySelector('b'), it.title);
      unitText(li.querySelector('.cd'), it.detail);
      unitText(li.querySelector('.cf'), it.fix);
      ol.appendChild(li);
    }
    box.hidden = !items?.length;
  };

  // Type the words into each judge's quote. A new set (Replay the call, the next run) cancels the
  // typing still in flight, so two typewriters never write into the same quote.
  const typing = {};
  ui.words = (words) => {
    if (!words) return;
    for (const id in typing) { clearTimeout(typing[id]); delete typing[id]; }
    if (words.headline) unitText($('[data-r-headline]'), words.headline);
    for (const id of ['engineer', 'coordinator', 'designer']) {
      const q = document.querySelector(`[data-judge="${id}"] .quote`);
      if (!q) continue;
      // The words arrive in SI (the Worker writes the prompt from the verified card); they read in
      // the player's units, and re-read on a flip once typed.
      const src = words[id] || '', text = localize(src);
      // Streamed in already (ui.liveWords): the final words are the same, so no second typewriter.
      if (q.dataset.live === src && src) { delete q.dataset.live; q.classList.remove('typing'); unitText(q, src); continue; }
      delete q.dataset.live;
      delete q.dataset.uSrc;
      let i = 0;
      q.textContent = '';
      q.classList.add('typing');
      const delay = { engineer: 0, coordinator: 500, designer: 1000 }[id];
      typing[id] = setTimeout(function type() {
        q.textContent = text.slice(0, ++i);
        if (i < text.length) typing[id] = setTimeout(type, 14);
        else { delete typing[id]; q.classList.remove('typing'); unitText(q, src); }
      }, delay);
    }
  };

  // The judges' words as the call streams them (src/ai/theatre.js parses the stream): each quote shows what
  // has arrived so far; ui.words then lands the final set without typing it twice.
  ui.liveWords = (words) => {
    if (!words) return;
    for (const id in typing) { clearTimeout(typing[id]); delete typing[id]; }
    if (words.headline) unitText($('[data-r-headline]'), words.headline);
    for (const id of ['engineer', 'coordinator', 'designer']) {
      const q = document.querySelector(`[data-judge="${id}"] .quote`);
      if (!q || !words[id] || q.dataset.live === words[id]) continue;
      q.dataset.live = words[id];
      q.textContent = localize(words[id]);
      q.classList.add('typing');
    }
  };

  // The panel's call as a strip near the top of the sheet (invariant 5½: every call visible): live, the model,
  // where it runs and the tokens so far, with "Watch the call" while the full theatre is put away; then the
  // call's receipt in one line (the full receipt, with Inspect, is further down). null clears it.
  const strip = $('[data-call]');
  let stripT0 = 0;
  ui.liveCall = (st, { onWatch } = {}) => {
    if (!strip) return;
    if (!st) { strip.hidden = true; strip.innerHTML = ''; delete strip.dataset.phase; stripT0 = 0; return; }
    const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const model = String(st.model || '').replace(/^@cf\/[^/]+\//, '');
    if (!stripT0) stripT0 = performance.now();
    const fresh = strip.dataset.phase !== st.phase || strip.dataset.docked !== String(!!st.docked);
    strip.dataset.phase = st.phase; strip.dataset.docked = String(!!st.docked);
    if (fresh || !strip.firstChild) {
      const live = st.phase !== 'done' && st.phase !== 'error' && st.phase !== 'receipt';
      strip.innerHTML = `<span class="cs-dot${live ? ' live' : st.ok === false || st.phase === 'error' ? ' off' : ''}" aria-hidden="true"></span>`
        + `<span class="cs-text"><b class="cs-what"></b> <code class="cs-model"></code><span class="cs-stats"></span></span>`
        + (live && st.docked ? '<button type="button" class="btn ghost cs-watch" data-call-watch>Watch the call</button>' : '');
      const w = strip.querySelector('[data-call-watch]');
      if (w) w.onclick = onWatch;
    }
    const what = st.phase === 'receipt' ? (st.ok ? 'Judged by' : 'AI unavailable · local lines') : st.phase === 'error' ? 'The panel’s call failed:' : st.phase === 'done' ? 'Judged by' : st.tokens ? 'The panel is writing' : 'The panel is deliberating…';
    strip.querySelector('.cs-what').textContent = what;
    strip.querySelector('.cs-model').textContent = st.phase === 'error' ? (st.error || '') : model;
    const stats = st.phase === 'receipt'
      ? (st.ok ? [`${st.inTokens} → ${st.outTokens} tok`, st.costUsd != null ? `$${st.costUsd.toFixed(6)}` : 'billed by provider'] : [st.error || 'offline'])
      : [st.where || '', st.tokens ? `${st.tokens} tok` : ''];
    strip.querySelector('.cs-stats').innerHTML = stats.filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
    strip.hidden = false;
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
      <div class="rc-actions">${meta.events?.length ? '<button type="button" class="btn link" data-rc-replay>Replay the call</button>' : ''}<button type="button" class="btn link" data-rc-change>${meta.provider === 'edge' ? 'Use your own AI key' : 'Change AI'}</button></div>
      ${meta.user ? `<details class="rc-inspect"><summary>Inspect the call</summary>
        <h4>System</h4><pre>${esc(meta.system)}</pre><h4>Prompt</h4><pre>${esc(meta.user)}</pre>
        ${meta.raw ? `<h4>Response</h4><pre>${esc(meta.raw)}</pre>` : ''}</details>` : ''}`;
    r.hidden = false;
    ui.liveCall({ phase: 'receipt', ok: !!meta.ok, model: meta.ok ? meta.model : '', inTokens: meta.inTokens, outTokens: meta.outTokens, costUsd: meta.costUsd, error: meta.error });
    const rp = r.querySelector('[data-rc-replay]');   // local lines: no call to replay
    if (rp) rp.onclick = onReplay;
    r.querySelector('[data-rc-change]').onclick = onChange;
  };

  ui.board = (rows, empty = '') => {
    const ol = $('[data-board-rows]');
    ol.innerHTML = '';
    if (!rows) { ol.innerHTML = '<li class="empty">The board is offline right now.</li>'; return; }
    if (!rows.length) { ol.innerHTML = `<li class="empty">${empty || 'No jumps yet today. Be the first.'}</li>`; return; }
    for (const r of rows) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="ini"></span><span class="v"></span><span class="t"></span>';
      li.querySelector('.ini').textContent = r.initials;
      unitText(li.querySelector('.v'), `${r.verdict} · ${r.facts.rollDeg}° · ${r.facts.sink} m/s`);
      // The tier it was flown in (the Worker's, from the log): Assist, Pro ×1.08 or Advanced ×1.15.
      if (r.tier) { const tg = document.createElement('b'); tg.className = 'tier-tag'; tg.dataset.tier = r.tier.toLowerCase(); tg.textContent = r.tier; li.querySelector('.v').prepend(tg); }
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
