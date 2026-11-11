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
// climb, tap to let go, hold to land. The release is the page's (src/main.js noteRelease): the tap
// starts the drive-off, and the car is let go on its push-off (LIFT on the deck) or the first tick in
// the air (before 0121 this script let go on the tap itself, skipping the drive-off).
// --skill (thumb, 0121: the touchdown slide, src/thumb-aim.js's sight):
//   none     never slides (the accessibility population; the default)
//   careful  holding in the air, puts the thumb on the amber dot (the mark from the predicted
//            touchdown), a reaction late, re-reading it every 0.25–0.5 s; every read is acted on, in order, even
//            when the thumb re-reads faster than it reacts (0173, scripts/lib/read-react.mjs)
//   sloppy   slides, badly: overshoots ×2–3, half of them read the sight upside down for a beat, and
//            some shove it up early (more carry) and leave it there
//   mixed    a third of each
//
// --coach (0124): also re-fly each landed run through the results' coach (src/sim/coach.js, in this scheme's words) and
// tally its first finding: how many players the What happened card tells "Clean".
//
// --daily (0134): also check each landed-or-not run against every Show objective of the daily jump (src/daily.js
// evaluate, on scoreRun's card) and print each one's completion, so a Daily bar is set on phones as well as keyboards.
// On one thumb it also splits gas-show (0139) and skim-show (0150) by the thumb's choice: held from the tap or lifted and pressed again, slid or not.
// With a --skill, every run also prints a line per what the thumb did (0173): n, median miss and score, clean inside the 7 m ring, jets-out
// gaps, and for "no slide" how many had read a dot ≥ 2 px held in the air (normally a read never acted on, so 0; a last read due after touchdown or a lift could also count; sloppy reads carry ±14 px noise).
//
//   node scripts/human-phone.mjs [n=300] [--scheme=classic|thumb] [--skill=none|careful|sloppy|mixed] [--build=before|after] [--geom=file.json] [--vp=390x844] [--coach] [--daily] [--pad=pre0188] [-v]
import { createGapProbe } from './burn-gap.mjs';
import { createReadReact } from './lib/read-react.mjs';
import { readFileSync } from 'node:fs';
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput, up, forward } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
import { SHOW } from '../src/sim/courses.js';
import { SPEC } from '../src/sim/spec.js';
import { predict, newPrediction } from '../src/sim/predict.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();
// --dump=<file>: every run's telemetry as JSON (re-score offline with a candidate judge).
const DUMP = (process.argv.find((a) => a.startsWith('--dump=')) || '').slice(7);
const dumped = [];   // the rigid-body engine's WASM (src/sim/engine.js)

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const N = +(args.find((a) => /^\d+$/.test(a)) || 300);
const scheme = opt('scheme', 'classic');
const build = opt('build', 'after');
const vp = opt('vp', '390x844');
const verbose = args.includes('-v');
const skill = opt('skill', 'none');
const COACH = args.includes('--coach');
const { coach } = COACH ? await import('../src/sim/coach.js') : {};
const { coachWords } = COACH ? await import('../src/pointer.js') : {};
const DAILY = args.includes('--daily');
const { OBJECTIVES, evaluate } = DAILY ? await import('../src/daily.js') : {};
const dailyMet = {}, gasLeft = [];
// 0139: gas-show split by what the thumb chose: held from the tap or lifted and pressed again, and slid onto the mark or not.
const split = {};
const firsts = {}, markTitles = {};
// 0173: every slide population split by what the thumb did (not what it was told): n, misses, scores, ring, gaps, and
// how many "no slide" thumbs had read a dot of 2 px or more while held in the air (a read never acted on).
const byChoice = {};
let longButWide = 0;
const { createOneThumb, markOffset } = scheme === 'thumb' ? await import('../src/onethumb.js') : {};

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
let seed3 = 4242;
const rnd3 = () => ((seed3 = (seed3 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let seed2 = 777;
const rnd2 = () => ((seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rnd2() + 1e-12)) * Math.cos(2 * Math.PI * rnd2());
const CARRY_CUE = 9.5;
const DEADZONE = build === 'after' ? 0.15 : 0;
const SEARCH = build === 'after' ? 0.06 : 0.12;   // the after layout hides what the phase doesn't use
const WARN = build === 'after';   // the after build warns (a flash on the HUD, a buzz on Android) when the descent leaves green
const PAD_CALM = !process.argv.includes('--pad=pre0188');   // 0188: compare with the pad that pulsed through auto-land

const fails = {};
let ok = 0, onPad = 0, missed = 0, presses = 0, gaps = 0, rises = 0;
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
  const run = createRun('show'), gp = createGapProbe();
  const lagT = Math.round(P.lag * 240);
  // A press: arrives after reaction + move (+ a layout search); may miss and be retried.
  const pressDelay = (ctrl, hand, search = false) => {
    let t = P.lag + (search ? SEARCH : 0);
    const { p, mt } = pressCost(ctrl, hand);
    t += mt; presses++;
    for (let k = 0; k < 3 && rnd2() > p; k++) { missed++; t += P.lag + mt; }
    return Math.round(t * 240);
  };
  let why = '', choice = '', readBig = false;
  if (scheme === 'thumb') {
    const th = createOneThumb();
    let released = false, tapped = false, ledgeT = -1, tapAt = -1, holdFrom = -1, holding = false, lapseAt = -1, landSeen = -1;
    // The slide (0121), drawn from its own stream so the base population is the same with or without it.
    const sk = skill === 'mixed' ? ['none', 'careful', 'sloppy'][Math.floor(rnd3() * 3)] : skill;
    const A = { every: Math.round((0.25 + rnd3() * 0.25) * 240), over: 2 + rnd3(), flip: rnd3() < 0.5, shove: rnd3() < 0.4 ? 20 + rnd3() * 40 : 0, flipFor: Math.round((0.4 + rnd3() * 0.6) * 240) };
    let aimNext = -1, flipUntil = -1, slid = false;
    const rr = createReadReact(lagT);   // 0173: every read acted on, a reaction late
    const off = { x: 0, y: 0, m: 0 };
    // Lifting the thumb mid-climb (20 % do, once): a second, then back on.
    th.down();
    while (run.phase !== 'done') {
      const c = run.car, t = run.tick, inp = newInput();
      if (!tapped) {
        if (F.lapse && lapseAt < 0 && run.phase === 'ramp' && run.t.progress > 0.4) { lapseAt = t; th.up(); }
        if (lapseAt > 0 && t - lapseAt === 240) th.down();
        if (run.phase === 'ramp' && run.t.progress >= 0.92 && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
          if (ledgeT < 0) { ledgeT = t; th.up(); }
          if (tapAt < 0) tapAt = ledgeT + Math.round(P.hangWait * 240) + pressDelay('thumb', 'R');
          if (t === tapAt) {
            th.down(); tapped = true; holding = true;
            // Hold on from the tap ('with-boost'), or let go and press again later.
            if (P.landAt !== 'with-boost') { holding = false; }
          }
        }
      }
      if (tapped) {
        const h = Math.max(0, c.pos.y - SPEC.comHeight);
        predict(c, h, pr);
        if (!holding && t > tapAt + 24 && th.held) th.up();
        if (!holding) {
          let want = false;
          if (P.landAt === 'hud') want = pr.status !== 'green';
          else if (typeof P.landAt === 'number') want = h < P.landAt;
          // 0188: the pad pulses only while a press can still change the flight (not once auto-land or a held LAND flies).
          if (WARN && pr.status !== 'green' && t > tapAt + lagT && !(PAD_CALM && (c.autoLand || th.landing))) want = true;   // the descent warning (flash + buzz)
          if (want && landSeen < 0) landSeen = t;
          if (landSeen >= 0 && holdFrom < 0) holdFrom = landSeen + pressDelay('thumb', 'R');
          if (holdFrom >= 0 && t >= holdFrom && !th.held) { holding = true; th.down(); }
        }
      }
      // The slide: holding in the air, roof up, onto the sight's dot (or, sloppy, near it).
      if (sk !== 'none' && released && run.phase === 'air' && th.held) {
        if (sk === 'sloppy' && A.shove && !run.t.crossedRow) th.move(0, A.shove);
        else if (t >= aimNext) {
          const h = Math.max(0, c.pos.y - SPEC.comHeight);
          predict(c, h, pr);
          markOffset(c, pr, 'show', off, th.ref, th.refA, th.canA);
          let x = off.x, y = -off.y;   // the dot's offset, +y up the glass
          if (sk === 'sloppy') {
            x *= A.over; y *= A.over;
            if (A.flip && flipUntil < 0) flipUntil = t + A.flipFor;
            if (t < flipUntil) y = -y;   // read the sight upside down
            x += 14 * gauss(); y += 14 * gauss();
          }
          if (Math.abs(x) + Math.abs(y) >= 2) readBig = true;
          rr.read(t, x, y); aimNext = t + A.every;
        }
        const want = rr.due(t);
        if (want) { th.move(want.x, want.y); if (Math.abs(want.x) + Math.abs(want.y) > 1) slid = true; }
      }
      th.sample(run, released, inp);
      // main.js wallAssist: a lift on the deck is the release; the fan holds the car until then.
      if (run.phase === 'ramp' && inp.lift > 0) released = true;
      if (run.phase === 'air') released = true;
      inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
      gp.before(run.car); stepRun(run, inp); gp.after(run.car);
    }
    // 0150: a let-go thumb that never came back (the skim day's hint) is its own bucket.
    choice = `${P.landAt === 'with-boost' ? 'held from the tap' : holdFrom < 0 ? 'lifted, stayed off' : 'lifted, pressed again'} · ${slid ? 'slid' : 'no slide'}`;
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
      gp.before(run.car); stepRun(run, inp); gp.after(run.car);
    }
  }
  const t = run.t, s = scoreRun(t);
  if (DUMP) dumped.push({ t: { ...t }, why: null });
  if (DAILY) {
    for (const o of OBJECTIVES) if (o.course === 'show') dailyMet[o.id] = (dailyMet[o.id] || 0) + (evaluate(o, s, 'show').ok ? 1 : 0);
    if (s.facts.jumped && !s.facts.crashed) gasLeft.push(s.facts.airPct);
    if (choice) {
      const g = (split[choice] ||= { n: 0, met: 0, skim: 0, gas: [] });
      g.n++; if (evaluate(OBJECTIVES.find((o) => o.id === 'gas-show'), s, 'show').ok) g.met++;
      if (evaluate(OBJECTIVES.find((o) => o.id === 'skim-show'), s, 'show').ok) g.skim++;
      if (s.facts.jumped && !s.facts.crashed) g.gas.push(s.facts.airPct);
    }
  }
  if (t.airStartTick < 0) why = t.fellOff ? 'climb: fell off' : 'climb: stalled';
  else if (t.fellOff) why = 'climb: fell off';
  else if (t.contact) why = 'contact with the row';
  else if (t.landedOnRamp) why = 'came down on the deck';
  else if (t.flipped || !t.settledUpright) why = 'rolled over';
  else if (t.touchTick < 0) why = 'flew out of the arena';
  else if (t.sink > 3) why = `hard touchdown (${t.sink > 6 ? '>6' : '3–6'} m/s)`;
  else if (t.tiltDeg > 15) why = 'landed tilted';
  if (!why) { ok++; if (s.facts.padMiss < 7) onPad++; totals.push(s.total); } else fails[why] = (fails[why] || 0) + 1;
  let gapped = false;
  if (!why) { const b = gp.read(run); if (b.gap >= 0.08) { gaps++; gapped = true; } if (b.rise > 0.5) rises++; }
  if (choice && skill !== 'none') {
    const b = (byChoice[choice] ||= { n: 0, miss: [], score: [], ring: 0, gaps: 0, read: 0 });
    b.n++; b.miss.push(s.facts.padMiss); b.score.push(s.total);
    if (!why && s.facts.padMiss < 7) b.ring++;
    if (gapped) b.gaps++;
    if (readBig) b.read++;
  }
  if (COACH && !why) {
    const first = coach(run.inputLog, 'show', s, 0, coachWords({ device: 'touch', scheme, tier: s.tier, course: 'show' })).items[0], id = first.id;
    firsts[id] = (firsts[id] || 0) + 1;
    // 0132: the mark's title, and how often "Long" leads a miss that is mostly sideways.
    if (id === 'mark') {
      markTitles[first.title] = (markTitles[first.title] || 0) + 1;
      if (first.title === 'Long of the mark' && Math.abs(t.lateral) > Math.abs(t.landZ - SHOW.pad.z)) longButWide++;
    }
  }
  if (verbose) console.log(JSON.stringify(P), JSON.stringify(F), why || 'OK', s.total, 'sink', t.sink.toFixed(1), 'pad', s.facts.padMiss);
}
totals.sort((a, b) => a - b);
const q = (f) => totals[Math.min(totals.length - 1, Math.floor(totals.length * f))] ?? '–';
console.log(`Phone ${vp} · ${scheme}${scheme === 'thumb' ? ` · skill ${skill}` : ''} · ${build}: ${ok}/${N} landed clean (${Math.round((100 * ok) / N)}%), ${onPad} inside the 7 m ring; median clean score ${q(0.5)} · mis-taps ${missed}/${presses}`);
console.log(`  clean scores: min ${totals[0] ?? '–'} · p10 ${q(0.1)} · median ${q(0.5)} · p90 ${q(0.9)} · max ${totals[totals.length - 1] ?? '–'}`);
console.log('  failures:', JSON.stringify(fails));
console.log(`  one burn (0169), clean landings: ${gaps}/${ok} with the down-jets out ≥ 0.08 s mid-brake (< 0.5 g sinking > 1 m/s, from the peak sink) · ${rises}/${ok} with the sink rising > 0.5 m/s above 1.2 m`);
if (Object.keys(byChoice).length) {
  const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : '–'; };
  for (const [k, b] of Object.entries(byChoice).sort()) {
    console.log(`  by what the thumb did (0173): ${k}: n ${b.n} · median miss ${med(b.miss)} m · median score ${med(b.score)} · ${b.ring} clean inside the 7 m ring · ${b.gaps} jets-out gaps${k.endsWith('no slide') ? ` · ${b.read} read a dot ≥ 2 px` : ''}`);
  }
  const ns = Object.entries(byChoice).filter(([k]) => k.endsWith('no slide')).reduce((a, [, b]) => a + b.read, 0);
  console.log(`  ${skill} · no slide though a dot ≥ 2 px was read held in the air: ${ns}`);
}
if (COACH) console.log(`  coach's first finding (landed runs): ${JSON.stringify(firsts)} · clean ${Math.round((100 * (firsts.clean || 0)) / Math.max(1, ok))}%`);
if (COACH) console.log(`  the mark's title when it leads: ${JSON.stringify(markTitles)} · "Long" on a mostly-sideways miss: ${longButWide}`);
if (DAILY) {
  gasLeft.sort((a, b) => a - b);
  const g = (f) => gasLeft[Math.min(gasLeft.length - 1, Math.floor(gasLeft.length * f))] ?? '–';
  console.log(`  the daily (Show objectives, n ${N}): ${OBJECTIVES.filter((o) => o.course === 'show').map((o) => `${o.id}${o.tier ? ` (${o.tier})` : ''} ${dailyMet[o.id]}/${N} (${Math.round((100 * dailyMet[o.id]) / N)}%)`).join(' · ')}`);
  const over = (x) => `> ${x} % ${gasLeft.filter((a) => a > x).length}/${N}`;
  for (const [k, g] of Object.entries(split).sort()) {
    g.gas.sort((a, b) => a - b);
    console.log(`  gas-show by the thumb's choice: ${k}: ${g.met}/${g.n} met (${Math.round((100 * g.met) / Math.max(1, g.n))}%) · gas left min ${g.gas[0] ?? '–'} · median ${g.gas[Math.floor(g.gas.length / 2)] ?? '–'} · max ${g.gas.at(-1) ?? '–'} %`);
    console.log(`  skim-show by the thumb's choice: ${k}: ${g.skim}/${g.n} met (${Math.round((100 * g.skim) / Math.max(1, g.n))}%)`);
  }
  console.log(`  gas left at touchdown, landed runs: min ${gasLeft[0] ?? '–'} · median ${g(0.5)} · max ${gasLeft[gasLeft.length - 1] ?? '–'} % · ${[25, 28, 30, 32, 35, 40].map(over).join(' · ')}`);
}
if (DUMP) { const { writeFileSync } = await import('node:fs'); writeFileSync(DUMP, JSON.stringify(dumped)); }
