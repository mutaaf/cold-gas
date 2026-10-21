// The damage map, opened up (a lazy chunk: src/instruments.js loads it on the first tap of the HUD's
// damage map). A larger car with each zone's integrity, the hits that landed (where, which way,
// how fast, the load, when, what each cost), and what damage does to the car in this sim, from
// src/sim/damage.js and src/sim/judge.js, nothing more. It never pauses: the run carries on under
// it and it updates live (on a hit, batched to the next frame). Escape, ×, a tap elsewhere or a
// second tap on the HUD's map closes it. On a phone it's a sheet from the bottom.
import './damage-view.css';
import { ZONES } from './sim/damage.js';
import { WRECK_PCT } from './sim/judge.js';
import { SCRAPE, WHEEL } from './sim/impacts.js';
import { missionClock } from './ui.js';
import { fmtSpeed, onUnits } from './units.js';

const NAMES = { nose: 'Nose', tail: 'Tail', left: 'Left side', right: 'Right side', roof: 'Roof', floor: 'Floor & skirts', susp: 'Wheels & suspension' };
const KIND = (h) => (h.kind === SCRAPE ? 'scrape' : h.kind === WHEEL ? 'tyre slam' : 'hit');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const level = (v) => (v >= 40 ? 'red' : v >= 10 ? 'amber' : v > 0.5 ? 'scuff' : '');

// The same top view as the HUD's (44 × 80, nose up, +x the car's left drawn on the left).
const CAR = `
  <rect class="z" data-z="floor" x="9" y="10" width="26" height="60" rx="9" />
  <path class="z" data-z="nose" d="M11 14 Q22 2 33 14 L33 18 L11 18 Z" />
  <path class="z" data-z="tail" d="M11 62 L33 62 L33 66 Q22 76 11 66 Z" />
  <rect class="z" data-z="left" x="6" y="20" width="5" height="40" rx="2" />
  <rect class="z" data-z="right" x="33" y="20" width="5" height="40" rx="2" />
  <rect class="z" data-z="roof" x="15" y="28" width="14" height="20" rx="4" />
  <g class="z susp" data-z="susp"><circle cx="5" cy="21" r="3" /><circle cx="39" cy="21" r="3" /><circle cx="5" cy="59" r="3" /><circle cx="39" cy="59" r="3" /></g>`;

export function createDamageView(ui, { anchor }) {
  const root = document.createElement('section');
  root.className = 'dmv';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Damage map');
  root.innerHTML = `
    <header class="dmv-head">
      <div><p class="dmv-eyebrow">Damage map · live</p><h2 class="dmv-title"><b data-v-int>100</b><span>% intact</span></h2><p class="dmv-word" data-v-word>Intact</p></div>
      <button type="button" class="dmv-x" data-v-close aria-label="Close the damage map (Esc)">×</button>
    </header>
    <div class="dmv-main">
      <svg class="dmv-car" viewBox="-6 -4 56 88" aria-label="Zones, tap one to focus it">${CAR}<g class="dmv-hits" data-v-hits></g></svg>
      <ol class="dmv-zones" data-v-zones>${ZONES.map((z) => `<li><button type="button" data-zone="${z}" aria-pressed="false"><span class="n">${NAMES[z]}</span><span class="pct"><b>100</b> %</span><i class="bar"><i></i></i></button></li>`).join('')}</ol>
    </div>
    <section class="dmv-sec"><h3 data-v-hits-h>Hits</h3><ol class="dmv-list" data-v-list></ol></section>
    <section class="dmv-sec dmv-does"><h3>What damage does</h3>
      <ul>
        <li><b>It costs Integrity.</b> Every judge marks it: 15 % of the Engineer’s score, 12 % of the Designer’s, 8 % of the Coordinator’s.</li>
        <li><b>${WRECK_PCT} % is a wreck.</b> At ${WRECK_PCT} % damage or more the run is a crash: no landing marks, whatever else happened.</li>
        <li><b>Crushed stays crushed.</b> A panel that has folded has used up its give, so the next hit there folds it further, sooner.</li>
        <li><b>It doesn’t slow the car.</b> In this sim the motors, tyres, fan and jets work the same at any damage: it models the crash, not the repair.</li>
      </ul>
      <p class="dmv-fine">Damage is ∝ impact energy: 100 % at a 31 mph (50 km/h) hit; a tyre arriving faster than 9.8 ft/s (3 m/s) bends suspension. The total is 0.6 × the worst zone + 0.4 × the mean.</p>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const zoneEls = Object.fromEntries([...root.querySelectorAll('.dmv-car [data-z]')].map((el) => [el.dataset.z, el]));
  const rowEls = Object.fromEntries([...root.querySelectorAll('[data-zone]')].map((el) => [el.dataset.zone, el]));
  let sel = null, raf = 0, open = false;

  function render() {
    raf = 0;
    if (!open) return;
    const st = ui.damageState, total = Math.round(st.total);
    $('[data-v-int]').textContent = String(100 - total);
    const word = total >= WRECK_PCT ? 'Wrecked' : total >= 25 ? 'Damaged' : total > 0 ? 'Scuffed' : 'Intact';
    $('[data-v-word]').textContent = word;
    root.dataset.state = total >= WRECK_PCT ? 'wreck' : total >= 25 ? 'warn' : '';
    ZONES.forEach((z, i) => {
      const v = st.zones[i], lv = level(v);
      zoneEls[z].dataset.level = lv; zoneEls[z].style.setProperty('--dmg', String((Math.round(v) / 100).toFixed(2)));
      const row = rowEls[z];
      row.dataset.level = lv;
      row.querySelector('b').textContent = String(Math.round(100 - v));
      row.querySelector('.bar i').style.transform = `scaleX(${(1 - v / 100).toFixed(3)})`;
    });
    const hits = ui.hits.filter((h) => sel == null || ZONES[h.zone] === sel);
    $('[data-v-hits-h]').textContent = sel ? `Hits · ${NAMES[sel]}` : 'Hits';
    // The marks: every hit, where it landed, with the way it came in.
    $('[data-v-hits]').innerHTML = ui.hits.map((h, i) => {
      const len = Math.hypot(h.fx, h.fy), rot = len > 0.35 ? (Math.atan2(-h.fx, h.fy) * 180) / Math.PI : 0;
      const dim = sel != null && ZONES[h.zone] !== sel;
      return `<g class="mk${h.kind === SCRAPE ? ' scr' : ''}${dim ? ' dim' : ''}${i === ui.hits.length - 1 ? ' new' : ''}" data-sev="${h.cost >= 15 ? 'red' : h.cost >= 4 ? 'amber' : ''}" transform="translate(${h.sx.toFixed(1)} ${h.sy.toFixed(1)})">
        <circle r="1.7" />${len > 0.35 && h.kind !== SCRAPE ? `<path transform="rotate(${rot.toFixed(0)})" d="M0 -11 L0 -3.4 M-2 -6 L0 -3 L2 -6" />` : ''}</g>`;
    }).join('');
    $('[data-v-list]').innerHTML = hits.length ? hits.slice().reverse().map((h) => `
      <li data-sev="${h.cost >= 15 ? 'red' : h.cost >= 4 ? 'amber' : ''}"><span class="w">${esc(NAMES[ZONES[h.zone]])} <em>${KIND(h)}</em></span>
        <span class="s">${esc(fmtSpeed(h.speed))}</span><span class="g">${h.g.toFixed(1)} g</span>
        <span class="t">T${missionClock(Math.round(h.t * 10))}</span><span class="c">−${h.cost < 1 ? h.cost.toFixed(1) : Math.round(h.cost)} %</span></li>`).join('')
      : `<li class="empty">${sel ? 'Nothing has touched this zone.' : 'Clean so far: no hits this flight.'}</li>`;
  }
  const schedule = () => { if (open && !raf) raf = requestAnimationFrame(render); };
  ui.onDamage(schedule);
  onUnits(schedule);

  function select(z) {
    sel = sel === z ? null : z;
    for (const [k, el] of Object.entries(rowEls)) el.setAttribute('aria-pressed', String(k === sel));
    for (const [k, el] of Object.entries(zoneEls)) el.classList.toggle('sel', k === sel);
    root.classList.toggle('has-sel', sel != null);
    render();
  }
  root.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zone], .dmv-car [data-z]');
    if (z) { select(z.dataset.zone || z.dataset.z); if (e.detail > 0) z.blur?.(); }
    if (e.target.closest('[data-v-close]')) close();
  });
  for (const el of Object.values(zoneEls)) { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', NAMES[el.dataset.z]); }
  root.addEventListener('keydown', (e) => { const z = e.target.closest('.dmv-car [data-z]'); if (z && e.key === 'Enter') select(z.dataset.z); });
  // A tap anywhere else closes it (the HUD's map toggles it itself).
  document.addEventListener('pointerdown', (e) => { if (open && !root.contains(e.target) && !anchor.contains(e.target)) close(); }, true);

  function openView() {
    open = true; root.hidden = false; anchor.setAttribute('aria-expanded', 'true');
    render();
    root.classList.remove('on'); void root.offsetWidth; root.classList.add('on');
  }
  function close() {
    if (!open) return;
    open = false; root.hidden = true; root.classList.remove('on'); anchor.removeAttribute('aria-expanded');
    cancelAnimationFrame(raf); raf = 0;
  }
  return { toggle: () => (open ? close() : openView()), close, isOpen: () => open, root };
}
