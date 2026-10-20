// Advanced by a person: ten valves on keys, no flight computer. Can a disciplined player fly the
// Show with taps? Every reaction time (0.18–0.35 s) they look at the HUD (the attitude dial, the
// roll and pitch to level, the BRAKE line) and tap: a side pair to roll, the fronts or the rears to
// pitch, the trimmed LIFT chord to brake, the rear row to carry. Half-open taps (Shift) or full.
//
//   node scripts/human-advanced.mjs [n=120] [-v]
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput, VALVE_KEYS, bodyRates, up } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
import { SHOW } from '../src/sim/courses.js';
import { SPEC } from '../src/sim/spec.js';
import { predict, newPrediction } from '../src/sim/predict.js';
import { createKeyRamp } from '../src/valves.js';

const args = process.argv.slice(2);
const N = +(args.find((a) => /^\d+$/.test(a)) || 120);
const verbose = args.includes('-v');
let seed = 777;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

let ok = 0, onPad = 0;
const fails = {}, totals = [];
const pr = newPrediction(), rates = { x: 0, y: 0, z: 0 }, u = { x: 0, y: 0, z: 0 }, valves = new Float64Array(10);
for (let n = 0; n < N; n++) {
  const P = { lag: 0.18 + rnd() * 0.17, tap: pick([0.05, 0.08, 0.12]), half: pick([true, false]), carry: pick([9, 10, 11]) };
  const run = createRun('show');
  const lagT = Math.max(1, Math.round(P.lag * 240)), tapT = Math.round(P.tap * 240);
  let released = false, decideT = 0, keys = new Set(), keysUntil = 0, burning = false, boostDone = false;
  const ramp = createKeyRamp();
  while (run.phase !== 'done') {
    const c = run.car, t = run.tick, inp = newInput();
    inp.assist = 0; inp.manual = 1;
    const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    if (run.phase === 'drive' || (run.phase === 'ramp' && !released)) {
      inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
      inp.throttle = v < (run.phase === 'drive' ? 5.5 : 5) ? 1 : 0;
      inp.fan = run.phase === 'ramp' || c.pos.z > -16 ? 1 : 0;
      if (run.phase === 'ramp' && wallProgress(c.pos) >= 0.95) { inp.throttle = 0; inp.brake = 1; if (v < 0.3) released = true; }
      stepRun(run, inp);
      continue;
    }
    inp.fan = 0;
    // Look and decide once per reaction time; hold the chosen keys for one tap.
    if (t >= decideT) {
      decideT = t + lagT;
      const h = Math.max(0, c.pos.y - SPEC.comHeight);
      predict(c, h, pr); bodyRates(c, rates); up(c, u);
      keys = new Set();
      if (P.half) keys.add('ShiftLeft');
      if (!boostDone) {
        if (Math.hypot(c.vel.x, c.vel.z) < P.carry && c.pos.z > SHOW.rowNear) keys.add('KeyF'); else boostDone = true;
        if (keys.has('KeyF')) keys.delete('ShiftLeft');
      }
      // Roll toward upright at a rate the eye can follow (≈2 rad/s per radian, at most 3).
      const want = Math.max(-3, Math.min(3, 2 * pr.rollOut)), have = rates.z;
      if (want - have > 0.8) keys.add('KeyA');          // left pair up → roll right
      else if (have - want > 0.8) keys.add('KeyD');
      const wantP = Math.max(-1.5, Math.min(1.5, 2 * pr.pitchOut)), haveP = rates.x;
      if (u.y > 0 && wantP - haveP > 0.6) keys.add('KeyS');   // rears up → nose down
      else if (u.y > 0 && haveP - wantP > 0.6) keys.add('KeyW');
      // Brake: one hard burn from the BRAKE line, roof up.
      if (!burning && pr.margin < 0.5 && u.y > 0.6) burning = true;
      if (burning && pr.sink < Math.min(1.6, 0.35 * pr.profileSink + 0.8)) burning = false;
      if ((burning || (h < 3 && pr.sink > 1.2)) && u.y > 0.6) { keys.add('Space'); keys.delete('ShiftLeft'); }
      keysUntil = t + (keys.has('Space') || keys.has('KeyF') ? lagT : tapT);
    }
    valves.fill(0);
    ramp((code) => (t < keysUntil ? keys.has(code) : (code === 'Space' || code === 'KeyF') && keys.has(code)), valves);
    for (let i = 0; i < 10; i++) inp[VALVE_KEYS[i]] = valves[i];
    stepRun(run, inp);
  }
  const t = run.t, s = scoreRun(t);
  let why = '';
  if (t.airStartTick < 0) why = 'never left';
  else if (t.contact) why = 'contact with the row';
  else if (t.flipped || !t.settledUpright) why = 'rolled over';
  else if (t.touchTick < 0) why = 'flew out';
  else if (t.sink > 3) why = 'hard touchdown';
  else if (t.tiltDeg > 15) why = 'landed tilted';
  if (!why) { ok++; if (s.facts.padMiss < 7) onPad++; totals.push(s.total); } else fails[why] = (fails[why] || 0) + 1;
  if (verbose) console.log(JSON.stringify(P), why || 'OK', s.total, s.tier, 'sink', t.sink.toFixed(1), 'tilt', t.tiltDeg.toFixed(0), 'pad', s.facts.padMiss, 'gas', s.facts.airPct);
}
totals.sort((a, b) => a - b);
console.log(`Advanced (keys, taps): ${ok}/${N} landed clean (${Math.round((100 * ok) / N)}%), ${onPad} inside the 7 m ring; median clean score ${totals[Math.floor(totals.length / 2)] ?? '–'}`);
console.log('  failures:', JSON.stringify(fails));
