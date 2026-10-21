// Can a person fly the Show ON A PHONE? scripts/human-show.mjs models keyboard players; this one
// takes the same seeded population (same reaction times, climb habits, hang waits, LAND timing:
// seed 12345, same draw order) and puts a phone in their hands. What changes on glass:
//   - Thumbs, not fingers. In portrait the right thumb owns GO, BRAKE, LIFT, LAND and BOOST; it holds
//     one of them at a time unless the player is a two-finger player (45 %). "Hold BOOST + LAND"
//     becomes BOOST, then a move to LAND.
//   - A resting thumb. Half the players leave the left thumb on the stick in the air; it drifts
//     (OU noise, σ 0.12, τ 0.6 s). In Assist any roll over 0.05 is a rate command and switches off
//     LAND's hold-the-line: unless the stick has a dead zone, the drift flies the car.
//   - Reach and size. Each press costs a Fitts move from where the thumb rests and can miss: touch
//     error σ = 12 pt inside the thumb's comfortable band, growing outside it (a reach heatmap from
//     the control geometry measured on the real page, --geom=file from scripts/thumb-reach.mjs).
//   - A layout that changes under you (GO becomes BOOST, LIFT becomes RELEASE) costs a search.
// --scheme=thumb flies the one-thumb Assist (src/onethumb.js, the code the page runs): hold to
// climb, tap to let go, hold to land.
//
//   node scripts/human-phone.mjs [n=300] [--scheme=classic|thumb] [--build=before|after] [--geom=file.json] [--vp=390x844] [-v]
import { readFileSync } from 'node:fs';
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput, up, forward } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
import { SHOW } from '../src/sim/courses.js';
import { SPEC } from '../src/sim/spec.js';
import { predict, newPrediction } from '../src/sim/predict.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const N = +(args.find((a) => /^\d+$/.test(a)) || 300);
const scheme = opt('scheme', 'classic');
const build = opt('build', 'after');
const vp = opt('vp', '390x844');
const verbose = args.includes('-v');
const { createOneThumb } = scheme === 'thumb' ? await import('../src/onethumb.js') : {};

// Control geometry (CSS px): centre and radius per control, per viewport. Defaults are the
// pre-redesign layout measured at 390×844; --geom reads what scripts/thumb-reach.mjs measured.
const GEOM_ALL = opt('geom') ? JSON.parse(readFileSync(opt('geom'), 'utf8')) : null;
const G = GEOM_ALL ? GEOM_ALL[`${build}-${scheme}-${vp}`] || GEOM_ALL[`${build}-classic-${vp}`] : {
  w: 390, h: 844, controls: { stick: { x: 93, y: 747, r: 75 }, go: { x: 315, y: 765, r: 56 }, brake: { x: 209, y: 783, r: 39 }, lift: { x: 209, y: 659, r: 39 }, land: { x: 324, y: 678, r: 48 } },
};
if (!G) throw new Error(`no geometry for ${build}-${scheme}-${vp}`);
const portrait = G.h > G.w;
// Where each thumb pivots (the CMC joint sits off the glass, below and outside the corner) and its
// comfortable band (Hoober 2013; Bergstrom-Lehtovirta & Oulasvirta 2014), in CSS px.
const PIV = portrait ? { R: { x: G.w + 30, y: G.h + 50 }, L: { x: -30, y: G.h + 50 }, band: [200, 380], max: 470 }
  : { R: { x: G.w + 30, y: G.h * 0.8 }, L: { x: -30, y: G.h * 0.8 }, band: [70, 260], max: 330 };
const SIGMA = 12;
function pressCost(ctrl, hand = 'R') {
  const c = G.controls[ctrl];
  if (!c) return { p: 1, mt: 0.1 };
  const pv = PIV[hand], d = Math.hypot(c.x - pv.x, c.y - pv.y);
  const out = d < PIV.band[0] ? PIV.band[0] - d : d > PIV.band[1] ? d - PIV.band[1] : 0;
  const sigma = SIGMA * (1 + out / 100) * (d > PIV.max ? 2 : 1);
  const p = 1 - Math.exp(-(c.r * c.r) / (2 * sigma * sigma));
  const home = PIV.band[0] + (PIV.band[1] - PIV.band[0]) * 0.5;
  const D = Math.abs(d - home) + 40;
  const mt = 0.08 + 0.12 * Math.log2(1 + D / (2 * c.r)) + (d > PIV.max ? 0.25 : 0);
  return { p, mt };
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
let seed2 = 777;
const rnd2 = () => ((seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rnd2() + 1e-12)) * Math.cos(2 * Math.PI * rnd2());
const CARRY_CUE = 9.5;
const DEADZONE = build === 'after' ? 0.15 : 0;
const SEARCH = build === 'after' ? 0.06 : 0.12;   // the after layout hides what the phase doesn't use
const WARN = build === 'after';   // the after build warns (a flash on the HUD, a buzz on Android) when the descent leaves green

const fails = {};
let ok = 0, onPad = 0, missed = 0, presses = 0;
const totals = [];
const u = { x: 0, y: 0, z: 0 }, fw = { x: 0, y: 0, z: 0 }, pr = newPrediction();
for (let n = 0; n < N; n++) {
  // The human-show population, drawn in the same order (Assist, new cues).
  const P = {
    lag: 0.18 + rnd() * 0.25,
    climb: pick([3, 4, 5, 6, 8, 'hold']),
    hangWait: pick([0.2, 0.8, 2]),
    spaceHold: pick([0.1, 0.2, 0.5]),
    boost: pick(['cue', 'cue', 0.2, 0.5, 1.0]),
    roll: pick(['none', 'left', 'right', 'left']),
    steer: pick(['none', 'marker']),
    landAt: pick(['with-boost', 'with-boost', 'hud', 'hud', 'hud', 8, 4]),
  };
  // The phone in their hands.
  const F = { twoFinger: rnd2() < 0.45, rest: rnd2() < 0.5, lapse: rnd2() < 0.2 };
  const run = createRun('show');
  const lagT = Math.round(P.lag * 240);
  // A press: arrives after reaction + move (+ a layout search); may miss and be retried.
  const pressDelay = (ctrl, hand, search = false) => {
    let t = P.lag + (search ? SEARCH : 0);
    const { p, mt } = pressCost(ctrl, hand);
    t += mt; presses++;
    for (let k = 0; k < 3 && rnd2() > p; k++) { missed++; t += P.lag + mt; }
    return Math.round(t * 240);
  };
  let why = '';
  if (scheme === 'thumb') {
    const th = createOneThumb();
    let released = false, ledgeT = -1, tapAt = -1, holdFrom = -1, holding = false, lapseAt = -1, landSeen = -1;
    // Lifting the thumb mid-climb (20 % do, once): a second, then back on.
    th.down();
    while (run.phase !== 'done') {
      const c = run.car, t = run.tick, inp = newInput();
      if (!released) {
        if (F.lapse && lapseAt < 0 && run.phase === 'ramp' && run.t.progress > 0.4) { lapseAt = t; th.up(); }
        if (lapseAt > 0 && t - lapseAt === 240) th.down();
        if (run.phase === 'ramp' && run.t.progress >= 0.92 && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
          if (ledgeT < 0) { ledgeT = t; th.up(); }
          if (tapAt < 0) tapAt = ledgeT + Math.round(P.hangWait * 240) + pressDelay('thumb', 'R');
          if (t === tapAt) {
            th.down(); released = true; holding = true;
            // Hold on from the tap ('with-boost'), or let go and press again later.
            if (P.landAt !== 'with-boost') { holding = false; }
          }
        }
      }
      if (released) {
        const h = Math.max(0, c.pos.y - SPEC.comHeight);
        predict(c, h, pr);
        if (!holding && t > tapAt + 24 && th.held) th.up();
        if (!holding) {
          let want = false;
          if (P.landAt === 'hud') want = pr.status !== 'green';
          else if (typeof P.landAt === 'number') want = h < P.landAt;
          if (WARN && pr.status !== 'green' && t > tapAt + lagT) want = true;   // the descent warning (flash + buzz)
          if (want && landSeen < 0) landSeen = t;
          if (landSeen >= 0 && holdFrom < 0) holdFrom = landSeen + pressDelay('thumb', 'R');
          if (holdFrom >= 0 && t >= holdFrom) { holding = true; th.down(); }
        }
      }
      th.sample(run, released, inp);
      // main.js wallAssist: a lift on the deck is the release; the fan holds the car until then.
      if (run.phase === 'ramp' && inp.lift > 0) released = true;
      if (run.phase === 'air') released = true;
      inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
      stepRun(run, inp);
    }
  } else {
    let released = false, relT = -1, ledgeT = -1, relPress = -1, boostOn = false, cueOffT = -1, rollOn = false, rollDone = false, rollUprightT = -1;
    let landing = false, landSeen = -1, landPress = -1, wHeld = false, wChange = 0, ax = 0, noise = 0, boostPress = -1;
    while (run.phase !== 'done') {
      const c = run.car, t = run.tick, inp = newInput();
      inp.assist = 1;
      const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
      up(c, u);
      let axTarget = 0;
      if (run.phase === 'drive' || (run.phase === 'ramp' && !released)) {
        inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
        const want = P.climb === 'hold' ? true : v < (run.phase === 'drive' ? 5.5 : P.climb);
        if (want !== wHeld && t - wChange > lagT) { wHeld = want; wChange = t; }
        inp.throttle = wHeld ? 1 : 0;
        inp.fan = run.phase === 'ramp' || c.pos.z > -16 ? 1 : 0;
        if (run.phase === 'ramp' && wallProgress(c.pos) >= 0.97) {
          if (ledgeT < 0) ledgeT = t;
          inp.throttle = 0; inp.brake = 1;
          // RELEASE: the LIFT button relabelled, on the right thumb (which was on GO, then BRAKE).
          if (relPress < 0) relPress = ledgeT + Math.round(P.hangWait * 240) + pressDelay('lift', 'R', true);
          if (t >= relPress) { released = true; relT = t; }
        }
      } else if (run.phase === 'ramp' || run.phase === 'air') {
        const since = t - relT;
        const h = Math.max(0, c.pos.y - SPEC.comHeight);
        predict(c, h, pr);
        if (since < P.spaceHold * 240) inp.lift = 1;
        // BOOST is GO relabelled; LAND is another button on the same thumb.
        const cue = !run.t.crossedRow && -c.vel.z < CARRY_CUE && c.pos.z > SHOW.rowNear;
        let wantBoost = false;
        if (P.boost === 'cue') {
          if (cue && since > lagT) wantBoost = true;
          if (!cue && cueOffT < 0 && boostOn) cueOffT = t;
          if (boostOn && !(cueOffT > 0 && t - cueOffT > lagT)) wantBoost = true;
        } else wantBoost = since > lagT && since < lagT + P.boost * 240;
        if (wantBoost && boostPress < 0) boostPress = t + pressDelay('go', 'R', true) - lagT;
        boostOn = wantBoost && t >= boostPress;
        if (!wantBoost) boostPress = -1;
        // LAND (as human-show), but a one-thumb player can't hold it while BOOST is held.
        if (!landing) {
          let want = false;
          if (P.landAt === 'with-boost') want = since > lagT;
          else if (P.landAt === 'hud') want = since > lagT && pr.status !== 'green';
          else want = h < P.landAt;
          if (WARN && pr.status !== 'green' && since > lagT) want = true;   // the descent warning (flash + buzz)
          if (want && landSeen < 0) landSeen = t;
          if (landSeen >= 0 && landPress < 0 && (F.twoFinger || !boostOn)) landPress = t + pressDelay('land', 'R', true);
          landing = landPress >= 0 && t >= landPress;
        }
        if (landing && !F.twoFinger && boostOn) boostOn = false;   // the thumb moved to LAND
        if (boostOn) inp.thrust = 1;
        // Roll by stick (left thumb, analog, no ramp): toward the roll-out cue, let go a reaction late.
        if (P.roll !== 'none' && !rollDone && since > lagT * 2) {
          rollOn = true;
          if (Math.abs(pr.rollOut) < 0.35 + P.lag * 2.5 && rollUprightT < 0) rollUprightT = t;
          if (rollUprightT > 0 && t - rollUprightT > lagT) { rollOn = false; rollDone = true; }
        }
        if (rollOn) axTarget = (Math.sign(pr.rollOut) || 1) * 0.85;
        if (P.steer === 'marker' && landing && u.y > 0.7 && h > 2.5) {
          forward(c, fw);
          const ez = SHOW.pad.z - pr.landZ, ex = SHOW.pad.x - pr.landX;
          const side = ez * fw.x - ex * fw.z;
          if (Math.abs(side) > 2.5 && t % (2 * lagT) < lagT && !rollOn) axTarget = side > 0 ? 0.4 : -0.4;
        }
        if (landing) inp.level = 1;
        // The resting thumb's drift on the stick, through the stick's dead zone.
        noise += (-noise / (0.6 * 240)) + 0.12 * Math.sqrt(2 / (0.6 * 240)) * gauss();
        ax = axTarget || (F.rest ? noise : 0);
        if (Math.abs(ax) < DEADZONE) ax = 0;
        if (run.phase === 'air') inp.roll = Math.max(-1, Math.min(1, ax));
      } else inp.brake = 1;
      stepRun(run, inp);
    }
  }
  const t = run.t, s = scoreRun(t);
  if (t.airStartTick < 0) why = t.fellOff ? 'climb: fell off' : 'climb: stalled';
  else if (t.fellOff) why = 'climb: fell off';
  else if (t.contact) why = 'contact with the row';
  else if (t.landedOnRamp) why = 'came down on the deck';
  else if (t.flipped || !t.settledUpright) why = 'rolled over';
  else if (t.touchTick < 0) why = 'flew out of the arena';
  else if (t.sink > 3) why = `hard touchdown (${t.sink > 6 ? '>6' : '3–6'} m/s)`;
  else if (t.tiltDeg > 15) why = 'landed tilted';
  if (!why) { ok++; if (s.facts.padMiss < 7) onPad++; totals.push(s.total); } else fails[why] = (fails[why] || 0) + 1;
  if (verbose) console.log(JSON.stringify(P), JSON.stringify(F), why || 'OK', s.total, 'sink', t.sink.toFixed(1), 'pad', s.facts.padMiss);
}
totals.sort((a, b) => a - b);
console.log(`Phone ${vp} · ${scheme} · ${build}: ${ok}/${N} landed clean (${Math.round((100 * ok) / N)}%), ${onPad} inside the 7 m ring; median clean score ${totals[Math.floor(totals.length / 2)] ?? '–'} · mis-taps ${missed}/${presses}`);
console.log('  failures:', JSON.stringify(fails));
