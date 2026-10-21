// The landing HUD: what the descent will do, read at a glance. Driven by src/sim/predict.js (the
// governor's own physics), updated in place every frame (no allocations, DOM touched on change).
//
//  - Sink: the number that decides the landing, coloured by the band it's in: green on or under
//    the LAND profile, amber fast but still stoppable, red past stopping.
//  - The descent tape: altitude, with the BRAKE line (where the stop from here has to start: the
//    stop, one reaction time and a metre). Keep the car's marker above the line until you brake.
//  - Time to ground (free fall from here), the touchdown sink if you braked now at full lift.
//  - Gas: a tick on the tank bar at what the stop costs; the bar goes red below it.
//  - Attitude: an attitude indicator (the horizon turns over when you're upside down), and the
//    roll-out cue: which way and how far, and LET GO a reaction time before upright.
//  - On the ground: a ring where you'll touch down if you ride the profile from here.
import * as THREE from 'three';
import { predict, newPrediction, REACTION } from './sim/predict.js';
import { CAR } from './sim/vehicle.js';
import { rateK, lenK, lenUnit, isMetric, onUnits, k as uk, u as uu } from './units.js';

const $ = (sel, root = document) => root.querySelector(sel);
// Colour is state only: nominal ink, caution amber, warning red (the HUD's own palette).
const COLORS = { green: 0xf5f6f8, amber: 0xffbf5a, red: 0xff5a62 };
// The tape's top, m: 30 m in metric, 100 ft (30.48 m) in US units, so its scale reads round.
const tapeMax = () => (isMetric() ? 30 : 30.48);
const ROLL_RATE = 4.6;          // rad/s, Assist/Pro full stick (src/sim/vehicle.js RATE.z)

export function createLandingHud({ scene, onStatus = null }) {
  const root = $('[data-descent]');
  const el = {
    sink: $('[data-d-sink]'), sinkWrap: $('[data-d-sinkwrap]'), target: $('[data-d-target]'), state: $('[data-d-state]'),
    ttg: $('[data-d-ttg]'), brakeLine: $('[data-d-brake]'), brakeLbl: $('[data-d-brake-lbl]'), car: $('[data-d-car]'),
    carLbl: $('[data-d-car-lbl]'), fill: $('[data-d-fill]'),
    need: $('[data-air-need]'), tank: $('[data-tank]'),
    horizon: $('[data-adi-horizon]'), adi: $('[data-adi]'), cue: $('[data-roll-cue]'),
  };
  const pr = newPrediction();
  const last = { sink: -1, status: '', target: -1, ttg: -1, brake: -1, car: -1, need: -1, low: null, cue: 0, on: null, adi: NaN, word: '' };
  const TAPE_H = 140;   // tape height in its viewBox units (0 m at the bottom)
  let TAPE_MAX = tapeMax();
  const yOf = (h) => (TAPE_H - Math.max(0, Math.min(TAPE_MAX, h)) * (TAPE_H / TAPE_MAX)).toFixed(1);
  const topEl = $('[data-d-top]'), zeroEl = $('[data-d-zero]');
  const scale = () => {
    TAPE_MAX = tapeMax();
    if (topEl) topEl.textContent = isMetric() ? '30' : '100';
    if (zeroEl) zeroEl.textContent = `0 ${lenUnit()}`;
    last.sink = -1; last.target = -1; last.brake = -1; last.car = -1;
  };
  const s2 = { dsink: $('[data-2="dsink"]'), dtarget: $('[data-2="dtarget"]') }, l2 = { dsink: NaN, dtarget: NaN };
  const set2 = (key, si) => { const r = Math.round(si * uk('rate', true) * 10); if (r !== l2[key] && s2[key]) { s2[key].textContent = `${(r / 10).toFixed(1)} ${uu('rate', true)}`; l2[key] = r; } };
  scale();
  onUnits(() => { scale(); l2.dsink = NaN; l2.dtarget = NaN; });

  // The touchdown marker: a hairline ring and a dot, flat on the ground.
  const mk = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: COLORS.green, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.32, 64), mat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), mat);
  const tickGeo = new THREE.PlaneGeometry(0.06, 0.55);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(tickGeo, mat);
    const a = (i * Math.PI) / 2;
    t.position.set(Math.cos(a) * 1.75, Math.sin(a) * 1.75, 0);
    t.rotation.z = a + Math.PI / 2;
    mk.add(t);
  }
  mk.add(ring, dot);
  mk.rotation.x = -Math.PI / 2;
  mk.position.y = 0.03;
  mk.renderOrder = 3;
  mk.visible = false;
  scene.add(mk);

  function show(on) {
    if (last.on === on) return;
    last.on = on;
    root.hidden = !on;
    mk.visible = on;
    if (!on) { el.tank.classList.remove('low'); el.need.style.opacity = '0'; el.cue.textContent = ''; last.cue = 0; }
  }

  // Every frame of a live run. `h`: the floor's height over what's below (the HUD's altitude).
  function update(car, h, phase) {
    const air = phase === 'air';
    // The attitude indicator runs whenever you're live (on the wall it shows you're upside down).
    predict(car, h, pr);
    // An attitude indicator, as from the driver's seat: banked left (rollOut > 0), the world turns
    // clockwise; nose up (pitchOut > 0), the horizon drops. Upside down, the ground is on top.
    const roll = (pr.rollOut * 180) / Math.PI, pitch = Math.max(-40, Math.min(40, (pr.pitchOut * 180) / Math.PI));
    // (Strings only when the picture changes: a key of the rounded angles, not a string a frame.)
    const rq = Math.round(roll * 2), pq = Math.round(pitch * 2), key = rq * 1000 + pq;
    if (key !== last.adi) { el.horizon.setAttribute('transform', `rotate(${rq / 2} 60 60) translate(0 ${((pq / 2) * 0.9).toFixed(2)})`); last.adi = key; }
    const level = Math.abs(pr.rollOut) < 0.09 && Math.abs(pr.pitchOut) < 0.09;
    el.adi.classList.toggle('level', air && level);
    show(air);
    if (!air) return;

    const sink = Math.round(pr.sink * rateK() * 10);
    if (sink !== last.sink) { el.sink.textContent = (Math.max(0, sink) / 10).toFixed(1); last.sink = sink; }
    set2('dsink', Math.max(0, pr.sink));
    if (pr.status !== last.status) {
      root.dataset.status = pr.status;
      mat.color.setHex(COLORS[pr.status]);
      onStatus?.(pr.status, last.status);
      last.status = pr.status;
    }
    // What the band asks of you: roof up first, then the brake.
    const word = pr.status === 'green' ? 'On profile' : pr.upY < 0.85 ? 'Roll out · now' : pr.status === 'amber' ? 'Brake' : 'Too fast';
    if (word !== last.word) { el.state.textContent = word; last.word = word; }
    const tg = Math.round(pr.profileSink * rateK() * 2);
    if (tg !== last.target) { el.target.textContent = (tg / 2).toFixed(1); last.target = tg; }
    set2('dtarget', pr.profileSink);
    const ttg = Number.isFinite(pr.tGround) ? Math.round(pr.tGround * 10) : 999;
    if (ttg !== last.ttg) { el.ttg.textContent = ttg >= 999 ? '–' : (ttg / 10).toFixed(1); last.ttg = ttg; }
    // The tape.
    const by = Math.round(Math.min(TAPE_MAX, pr.brakeBy) * 2);
    if (by !== last.brake) {
      const y = yOf(by / 2);
      el.brakeLine.setAttribute('y1', y); el.brakeLine.setAttribute('y2', y);
      el.brakeLbl.setAttribute('y', String(Number(y) - 6));
      el.fill.setAttribute('y', y); el.fill.setAttribute('height', String(Math.max(0, TAPE_H - Number(y))));
      el.brakeLbl.textContent = pr.brakeBy > TAPE_MAX ? 'BRAKE ↑' : `BRAKE ${Math.ceil(pr.brakeBy * lenK())} ${lenUnit()} · ${Math.ceil(pr.brakeBy * uk('len', true))} ${uu('len', true)}`;
      last.brake = by;
    }
    const ch = Math.round(Math.min(TAPE_MAX, h) * 4);
    if (ch !== last.car) {
      el.car.setAttribute('transform', `translate(0 ${yOf(ch / 4)})`);
      const hs = h * lenK();
      el.carLbl.textContent = hs >= 10 ? Math.round(hs).toString() : hs.toFixed(1);
      last.car = ch;
    }
    // Gas: what the stop costs, as a tick on the tank bar.
    const need = Math.round((pr.gasNeed / CAR.airMass) * 100);
    if (need !== last.need) { el.need.style.transform = `translateX(${Math.min(100, need)}%)`; el.need.style.opacity = '1'; last.need = need; }
    const low = pr.gas < pr.gasNeed;
    if (low !== last.low) { el.tank.classList.toggle('low', low); last.low = low; }
    // Roll-out cue: the way round and how far; LET GO once the car will coast the rest within a
    // reaction time at the rate it's turning.
    const deg = Math.abs(pr.rollOut) * 180 / Math.PI;
    // The cue as a number (0 none, 1 LEVEL, 2 LET GO, ±(5..180) roll that way): text only on change.
    let cue = 0;
    if (deg > 12) {
      // Body roll rate has the stick's sign (+ = rolling right), so it's turning the right way
      // when it matches the roll-out's sign.
      const rate = rollRate(car), toward = Math.sign(rate) === Math.sign(pr.rollOut);
      const lead = Math.min(ROLL_RATE, Math.abs(rate)) * REACTION;
      cue = toward && Math.abs(rate) > 1 && lead > Math.abs(pr.rollOut) * 0.9 ? 2 : (pr.rollOut > 0 ? 1 : -1) * Math.round(deg / 5) * 5;
    } else if (level) cue = 1;
    if (cue !== last.cue) {
      el.cue.textContent = cue === 0 ? '' : cue === 1 ? 'LEVEL' : cue === 2 ? 'LET GO' : `ROLL ${cue > 0 ? '→' : '←'} ${Math.abs(cue)}°`;
      el.cue.dataset.kind = cue === 2 ? 'go' : cue === 1 ? 'ok' : cue ? 'roll' : '';
      last.cue = cue;
    }
    // The touchdown marker.
    mk.position.x = pr.landX; mk.position.z = pr.landZ;
    const s = 0.8 + Math.min(1.2, pr.tLand * 0.12);
    mk.scale.set(s, s, s);
  }

  return { update, show, prediction: pr, marker: mk };
}

// Roll rate about the car's long axis (rad/s): angular velocity · forward.
function rollRate(c) {
  const q = c.quat, w = c.angVel;
  // forward = q · (0,0,1)
  const fx = 2 * (q.x * q.z + q.w * q.y), fy = 2 * (q.y * q.z - q.w * q.x), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return w.x * fx + w.y * fy + w.z * fz;
}
