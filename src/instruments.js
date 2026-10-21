// The HUD's instruments answer a tap (or Enter when focused): each opens a small readout of what it
// has seen this flight, anchored beside it on glass. Nothing here pauses or steers: the run keeps
// going under it, Escape or a tap anywhere else closes it, and it refreshes five times a second
// only while it's open (src/ui.js keeps the numbers; this only formats them).
//
//   G            the flight's peak load (0.5 s window, as the HUD reads it), when and in which phase
//   N₂           burn time left at the present draw and at the flight's hardest burn, pressure, used
//   clock/phases the splits: when each phase began and how long it lasted
//   attitude     roll and pitch turned so far, time inverted
//   thrusters    each group's valves, the commanded thrust
//   damage map   the full view (src/damage-view.js, loaded on first open)
import { NOZZLE_SPEC } from './sim/spec.js';
import { missionClock } from './ui.js';
import { fmtMass, fmtPressure, fmtForce, fmtSpeed, isMetric, onUnits, k as uk, u as uu, alt as ualt, one, getUnits } from './units.js';

// A flow in both systems: "26.5 lb/s · 12.0 kg/s".
const flow = (kgs) => { const p = getUnits(), q = p === 'us' ? 'metric' : 'us'; return `${one('mass', kgs, 1, p)}/s · ${one('mass', kgs, 1, q)}/s`; };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clockOf = (t) => `T${missionClock(Math.round(t * 10))}`;
const DEG = 180 / Math.PI;

export function createInstruments(ui, { getRun }) {
  const hud = ui.screens.hud;
  if (!hud) return { close() {} };
  let pop = null, open = null, anchor = null, timer = 0, lastHtml = '';
  let dmgView = null, dmgLoading = null;

  const PANELS = {
    g() {
      const s = ui.stats, run = getRun();
      const t = run?.t;
      const rows = [['Now', `${s.g.toFixed(1)} g`], ['At the peak', s.peakGAt ? `${clockOf(s.peakGAt)}${s.peakGPhase ? ` · ${ui.phaseLabels?.[s.peakGPhase] || s.peakGPhase}` : ''}` : '—']];
      if (t?.brakePeakG > 0) rows.push(['Braking peak', `${t.brakePeakG.toFixed(1)} g`]);
      if (t?.maxG > 0) rows.push(['Any tick (spikes)', `${t.maxG.toFixed(1)} g`]);
      return { title: 'G load · peak', big: `${s.peakG.toFixed(1)}`, unit: 'g', sub: 'Highest this flight', rows,
        note: 'Specific force averaged over 0.5 s, as the reveal’s G-FORCE channel read it. Amber from 3 g, red from 4.5 g.' };
    },
    gas() {
      const s = ui.stats, gas = Math.max(0, s.gasKg);
      const burning = s.draw > 0.5;
      const at = burning ? s.draw : s.peakDraw;
      const left = at > 0.5 ? gas / at : NaN;
      const rows = [
        ['Left', fmtMass(gas)], ['Tank', `${fmtPressure(s.tankBar)} · ${s.gasState === 'blowdown' ? 'blowdown' : 'regulated'}`],
        ['Draw now', burning ? flow(s.draw) : 'valves shut'],
        ['Hardest burn', s.peakDraw > 0.5 ? flow(s.peakDraw) : '—'],
        ['Used this flight', s.gasStart >= 0 ? fmtMass(Math.max(0, s.gasStart - gas)) : '—'],
      ];
      return { title: 'Nitrogen · burn time', big: Number.isFinite(left) ? left.toFixed(1) : '—', unit: 's',
        sub: burning ? 'left at this draw' : s.peakDraw > 0.5 ? 'left at this flight’s hardest burn' : 'no burn yet this flight', rows,
        note: 'Below about two thirds of a fill the regulator loses line pressure: every jet thins out with the gas.' };
    },
    splits() {
      const s = ui.stats, sp = s.splits;
      const rows = sp.length ? sp.map((x, i) => {
        const end = i + 1 < sp.length ? sp[i + 1].t : s.clock;
        return [`${String(i + 1).padStart(2, '0')} ${x.label}`, `${clockOf(x.t)} · ${Math.max(0, end - x.t).toFixed(1)} s${i === sp.length - 1 ? ' ·  now' : ''}`];
      }) : [['—', 'the clock starts on the green light']];
      return { title: 'Mission clock · splits', big: clockOf(s.clock).slice(1), unit: '', sub: `Top speed ${fmtSpeed(s.maxSpeed)}`, rows,
        note: 'Each phase from the moment you entered it; the last one is still running.' };
    },
    att() {
      const run = getRun(), t = run?.t;
      const roll = t ? Math.abs(t.rollAccum) * DEG : 0, pitch = t ? Math.abs(t.pitchAccum) * DEG : 0;
      return { title: 'Attitude · turned so far', big: Math.round(Math.max(roll, pitch)).toString(), unit: '°', sub: roll >= pitch ? 'mostly roll' : 'mostly pitch',
        rows: [['Roll', `${Math.round(roll)}° · ${(roll / 360).toFixed(2)} turns`], ['Pitch', `${Math.round(pitch)}°`], ['Inverted', t ? `${t.invertedTime.toFixed(1)} s` : '—']],
        note: 'The panel pays a roll-dominant turn more than a flip. A full roll is 360°; the Wall asks for about 180° off the ledge.' };
    },
    thrust() {
      const thr = ui.stats.throttles || [];
      const groups = { lift: ['Down jets', 0, 0, 0], rear: ['Rear row', 0, 0, 0], yaw: ['Fender jets', 0, 0, 0] };
      let total = 0;
      NOZZLE_SPEC.forEach((n, i) => { const v = Math.max(0, Math.min(1, thr[i] || 0)), g = groups[n.group]; g[1] += v; g[2]++; g[3] += v * n.max; total += v * n.max; });
      const rows = Object.values(groups).map(([name, sum, n, f]) => [`${name} ×${n}`, `${Math.round((sum / Math.max(1, n)) * 100)} % · ${fmtForce(f)}`]);
      rows.push(['Gas left', fmtMass(Math.max(0, ui.stats.gasKg))]);
      const big = total * uk('force');
      return { title: 'Thrusters · valves', big: big.toFixed(isMetric() ? 1 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','), unit: uu('force'), alt: ualt('force', total, isMetric() ? 0 : 1), sub: 'commanded, at rated pressure', rows,
        note: 'Ten cold-gas jets: four down, four in the rear row, two on the fenders. In blowdown each delivers less than its rating.' };
    },
  };

  function render() {
    if (!pop || !open) return;
    const p = PANELS[open]();
    const html = `<p class="ip-t">${esc(p.title)}</p>
      <div class="ip-big"><b>${esc(p.big)}</b>${p.unit ? `<span class="h-unit"${p.alt ? ' data-units title="Tap to swap units"' : ''}>${esc(p.unit)}</span>` : ''}${p.alt ? `<span class="h-alt" data-units>${esc(p.alt)}</span>` : ''}<span class="ip-sub">${esc(p.sub || '')}</span></div>
      <dl class="ip-rows">${p.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${p.note ? `<p class="ip-note">${esc(p.note)}</p>` : ''}`;
    if (html !== lastHtml) { pop.querySelector('.ip-body').innerHTML = html; lastHtml = html; }
  }
  function place() {
    if (!pop || !anchor) return;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, M = 12;
    const above = r.top - h - 10 >= M + 50;
    let y = above ? r.top - h - 10 : r.bottom + 10;
    y = Math.max(M, Math.min(innerHeight - h - M, y));
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(M, Math.min(innerWidth - w - M, x));
    pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    pop.dataset.side = above ? 'above' : 'below';
  }
  function show(kind, el) {
    if (open === kind) { close(); return; }
    close();
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'ipop';
      pop.setAttribute('role', 'dialog');
      pop.innerHTML = '<button type="button" class="ip-x" aria-label="Close">×</button><div class="ip-body"></div>';
      pop.querySelector('.ip-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
      document.body.appendChild(pop);
    }
    open = kind; anchor = el; lastHtml = '';
    pop.setAttribute('aria-label', el.getAttribute('aria-label') || kind);
    pop.hidden = false;
    el.setAttribute('aria-expanded', 'true');
    render(); place();
    pop.classList.remove('on'); void pop.offsetWidth; pop.classList.add('on');
    timer = setInterval(() => { if (hud.hidden) { close(); return; } render(); }, 200);
  }
  function close() {
    clearInterval(timer); timer = 0;
    if (anchor) anchor.removeAttribute('aria-expanded');
    if (pop) { pop.hidden = true; pop.classList.remove('on'); }
    open = null; anchor = null;
    dmgView?.close();
  }
  onUnits(() => { lastHtml = ''; render(); });

  async function openDamage(el) {
    if (dmgView?.isOpen()) { dmgView.close(); return; }
    close();
    if (!dmgView) {
      dmgLoading ??= import('./damage-view.js').then((m) => { dmgView = m.createDamageView(ui, { anchor: el }); return dmgView; });
      await dmgLoading;
    }
    dmgView.toggle();
  }

  function activate(el, e) {
    const kind = el.dataset.inst;
    if (kind === 'damage') openDamage(el).catch((err) => console.error(err));
    else if (PANELS[kind]) show(kind, el);
    // A tap leaves no focus behind: Space is the game's, not the button's.
    if (e && e.detail > 0) el.blur();
  }
  hud.addEventListener('click', (e) => {
    const el = e.target.closest('[data-inst]');
    if (el && hud.contains(el)) activate(el, e);
  });
  hud.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('[data-inst]');
    if (el && e.key === 'Enter') { e.preventDefault(); activate(el, null); }
  });
  // Escape closes whatever is open before anything else hears it; a tap elsewhere closes it too.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (open || dmgView?.isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!open) return;
    if (pop?.contains(e.target) || anchor?.contains(e.target)) return;
    close();
  }, true);
  addEventListener('resize', () => place());

  return { close, get open() { return open || (dmgView?.isOpen() ? 'damage' : null); } };
}
