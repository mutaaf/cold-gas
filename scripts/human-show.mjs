// Can a PERSON fly the Show? The naive sweeps (naive-players, naive-show) hold keys perfectly;
// people don't. This one models human players: on/off keys with the keyboard's ramp, a reaction
// time on every decision (0.18–0.43 s), feathering ↑ up the curl, boosting by eye, rolling by hand
// and letting go late, and LAND pressed when they think of it. Deterministic (seeded).
//
//   node scripts/human-show.mjs [n=300] [assist|pro] [--cues old|new] [-v]
//
// --cues old: what players did with the 0.9 cues and no landing HUD (release at the first "let go"
//             cue, boost until the cue goes away, LAND after the roll-out or at a height they
//             picked).
// --cues new: the 1.0 cues and the predictive HUD (release on the ledge; Assist: hold BOOST and
//             LAND together from the release, or press LAND when the sink band leaves green; Pro:
//             fly the band with LIFT and roll by the roll-out cue). A share still ignores the HUD.
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput, up, forward } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
import { SHOW } from '../src/sim/courses.js';
import { SPEC } from '../src/sim/spec.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();   // the rigid-body engine's WASM (src/sim/engine.js)

const args = process.argv.slice(2);
const N = +(args.find((a) => /^\d+$/.test(a)) || 300);
const assistMode = !args.includes('pro');
const cues = args.includes('new') || args.includes('--cues=new') ? 'new' : 'old';
const verbose = args.includes('-v');
// The predictor drives the new cues and the HUD; the old population never sees it (and so this
// script also runs against a pre-HUD sim, for before/after).
const { predict, newPrediction } = cues === 'new' ? await import('../src/sim/predict.js') : { predict: () => {}, newPrediction: () => ({}) };

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const CARRY_CUE = cues === 'new' ? 9.5 : 8.5;   // the BOOST cue hides at this speed along the run

const fails = {}, byClass = {};
let ok = 0, onPad = 0;
const totals = [];
const u = { x: 0, y: 0, z: 0 }, fw = { x: 0, y: 0, z: 0 }, pr = newPrediction();
for (let n = 0; n < N; n++) {
  const P = process.env.P ? JSON.parse(process.env.P) : {
    lag: 0.18 + rnd() * 0.25,
    climb: pick([3, 4, 5, 6, 8, 'hold']),
    hangWait: pick([0.2, 0.8, 2]),
    spaceHold: pick([0.1, 0.2, 0.5]),
    boost: pick(['cue', 'cue', 0.2, 0.5, 1.0]),
    roll: pick(['none', 'left', 'right', 'left']),
    steer: cues === 'new' ? pick(['none', 'marker']) : 'none',
    landAt: cues === 'old' ? pick(['cue', 'cue', 15, 8, 4]) : assistMode ? pick(['with-boost', 'with-boost', 'hud', 'hud', 'hud', 8, 4]) : pick(['hud', 'hud', 'hud', 'hud', 8]),
  };
  const run = createRun('show');
  let released = false, relT = -1, ledgeT = -1, boostOn = false, cueOffT = -1, rollOn = false, rollDone = false, rollUprightT = -1;
  let burning = false, landing = false, landSeen = -1, keyAx = 0, wHeld = false, wChange = 0, liftHeld = false, liftChange = 0;
  const lagT = Math.round(P.lag * 240);
  while (run.phase !== 'done') {
    const c = run.car, t = run.tick, inp = newInput();
    inp.assist = assistMode ? 1 : 0;
    const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    up(c, u);
    let axTarget = 0;
    if (run.phase === 'drive' || (run.phase === 'ramp' && !released)) {
      inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
      const want = P.climb === 'hold' ? true : v < (run.phase === 'drive' ? 5.5 : P.climb);
      if (want !== wHeld && t - wChange > lagT) { wHeld = want; wChange = t; }
      inp.throttle = wHeld ? 1 : 0;
      inp.fan = run.phase === 'ramp' || c.pos.z > -16 ? 1 : 0;
      // The "let go" cue: 0.9 showed it from 85 % up the curl; 1.0 only on the ledge.
      const cueOn = run.phase === 'ramp' && (cues === 'old' ? run.t.progress >= 0.85 : wallProgress(c.pos) >= 0.97);
      if (cueOn) {
        if (ledgeT < 0) ledgeT = t;
        if (t - ledgeT > (P.hangWait + P.lag) * 240) { released = true; relT = t; }
        else if (wallProgress(c.pos) > 0.97) { inp.throttle = 0; inp.brake = cues === 'new' ? 1 : 0; }
      }
    } else if (run.phase === 'ramp' || run.phase === 'air') {
      const since = t - relT;
      const h = Math.max(0, c.pos.y - SPEC.comHeight);
      predict(c, h, pr);
      if (since < P.spaceHold * 240) inp.lift = 1;
      // BOOST: hold while the cue shows (and a reaction time after it goes), or a fixed hold.
      const cue = !run.t.crossedRow && -c.vel.z < CARRY_CUE && c.pos.z > SHOW.rowNear;
      if (P.boost === 'cue') {
        if (cue && since > lagT) boostOn = true;
        if (!cue && cueOffT < 0 && boostOn) cueOffT = t;
        if (cueOffT > 0 && t - cueOffT > lagT) boostOn = false;
      } else boostOn = since > lagT && since < lagT + P.boost * 240;
      if (boostOn) inp.thrust = 1;
      // Roll by hand: hold until it looks upright (or, with the HUD, until the roll-out cue says
      // stop), let go a reaction time later.
      const pro = !assistMode && cues === 'new';
      if ((P.roll !== 'none' || pro) && !rollDone && since > lagT * 2 && (!boostOn || cues === 'new')) {
        rollOn = true;
        const done = cues === 'new' ? Math.abs(pr.rollOut) < 0.35 + P.lag * 2.5 : u.y > 0.85;
        if (done && rollUprightT < 0) rollUprightT = t;
        if (rollUprightT > 0 && t - rollUprightT > lagT) { rollOn = false; rollDone = true; }
      }
      if (rollOn) axTarget = cues === 'new' ? Math.sign(pr.rollOut) || 1 : P.roll === 'left' ? -1 : 1;
      // Pro with the HUD keeps flying it: a tap toward the roll-out cue whenever it shows (>10°).
      if (pro && rollDone && Math.abs(pr.rollOut) > 0.18 && t - rollUprightT > lagT * 2) axTarget = Math.sign(pr.rollOut) * 0.6;
      if (pro && rollDone && Math.abs(pr.pitchOut) > 0.15 && t % (2 * lagT) < lagT) inp.pitch = Math.sign(pr.pitchOut) * 0.5;
      // LAND (Assist) or LIFT by hand (Pro).
      if (!landing) {
        let want = false;
        if (P.landAt === 'cue') want = (rollDone || P.roll === 'none') && c.vel.y < -1 && since > lagT * 3;
        else if (P.landAt === 'with-boost') want = since > lagT;
        else if (P.landAt === 'hud') want = since > lagT && pr.status !== 'green';
        else want = h < P.landAt;
        if (want && landSeen < 0) landSeen = t;
        landing = landSeen >= 0 && t - landSeen >= (P.landAt === 'with-boost' ? 0 : lagT);
      }
      if (assistMode) { if (landing) inp.level = 1; }
      else if (landing) {
        // Pro: one hard burn from the BRAKE line (the band going amber) until the car is slow, then
        // short taps to set it down; keep it upright by hand. (Old cues: brake by eye.)
        if (cues === 'new' && !burning && pr.margin < 0.5 && u.y > 0.5) burning = true;
        if (burning && pr.sink < Math.min(1.6, 0.35 * pr.profileSink + 0.8)) burning = false;
        const wantLift = cues === 'new' ? u.y > 0.5 && (burning || (h < 3 && pr.sink > 1.2)) : c.vel.y < -2;
        if (wantLift !== liftHeld && t - liftChange > lagT * 0.6) { liftHeld = wantLift; liftChange = t; }
        if (liftHeld) inp.lift = 1;
      }
      // Fly the projected touchdown point onto the pad: nose up to bleed carry, roll to slide.
      // In the car's frame (what the screen shows): + along = toward the nose, + side = its right.
      if (P.steer === 'marker' && landing && u.y > 0.7 && h > 2.5) {
        forward(c, fw);
        const ez = SHOW.pad.z - pr.landZ, ex = SHOW.pad.x - pr.landX;
        const along = ez * fw.z + ex * fw.x, side = ez * fw.x - ex * fw.z;
        const tap = t % (2 * lagT) < lagT;          // tap, look, tap
        if (Math.abs(along) > 2.5 && tap) inp.pitch = along > 0 ? 0.5 : -0.5;   // + pitch = nose down = speed up
        if (Math.abs(side) > 2.5 && tap && !rollOn) axTarget = side > 0 ? 0.4 : -0.4;
      }
    } else inp.brake = 1;
    const rate = Math.abs(axTarget) > Math.abs(keyAx) && Math.sign(axTarget) !== -Math.sign(keyAx) ? 4 / 240 : 8 / 240;
    keyAx += Math.max(-rate, Math.min(rate, axTarget - keyAx));
    if (run.phase === 'air') inp.roll = keyAx;
    stepRun(run, inp);
  }
  const t = run.t, s = scoreRun(t);
  let why = '';
  if (t.airStartTick < 0) why = t.fellOff ? 'climb: fell off' : 'climb: stalled';
  else if (t.fellOff) why = 'climb: fell off';
  else if (t.contact) why = 'contact with the row';
  else if (t.landedOnRamp) why = 'came down on the deck';
  else if (t.flipped || !t.settledUpright) why = 'rolled over';
  else if (t.touchTick < 0) why = 'flew out of the arena';
  else if (t.sink > 3) why = `hard touchdown (${t.sink > 6 ? '>6' : '3–6'} m/s)`;
  else if (t.tiltDeg > 15) why = 'landed tilted';
  const cls = `LAND ${P.landAt}${P.steer === 'marker' ? ' +steer' : ''}`;
  byClass[cls] = byClass[cls] || [0, 0];
  byClass[cls][1]++;
  if (!why) { ok++; byClass[cls][0]++; if (s.facts.padMiss < 7) onPad++; totals.push(s.total); }
  else fails[why] = (fails[why] || 0) + 1;
  if (verbose) console.log(JSON.stringify(P), why || 'OK', s.total, 'sink', t.sink.toFixed(1), 'pad', s.facts.padMiss, 'gas', s.facts.airPct);
}
totals.sort((a, b) => a - b);
console.log(`${assistMode ? 'Assist' : 'Pro'} · cues ${cues}: ${ok}/${N} landed clean (${Math.round((100 * ok) / N)}%), ${onPad} inside the 7 m ring; median clean score ${totals[Math.floor(totals.length / 2)] ?? '–'}`);
console.log('  by when they braked:', Object.entries(byClass).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(' · '));
console.log('  failures:', JSON.stringify(fails));
