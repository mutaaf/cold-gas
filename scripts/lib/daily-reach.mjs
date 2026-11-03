// The daily jump's reach (0135): what share of the players who fly each objective's course, the way they fly it, can
// meet it. Pure and seeded (no DOM, no wall clock), so scripts/daily-reach.mjs prints the table and
// tests/unit/daily-reach.test.js holds the floor with the same code. Three populations, one per way a course is flown:
//
//   thumb  The Show and the Wall on a phone (most players): the one-thumb Assist (src/onethumb.js, the code the page
//          runs), modelled as scripts/human-phone.mjs --scheme=thumb --skill=careful models it: a reaction time
//          (0.18–0.43 s) + a 0.1 s press on every decision, a wait on the ledge, then either the pad held from the tap
//          or let go and pressed again on the descent warning (the band leaving green: the drive-off is the computer's, so
//          for every let-go thumb it comes 0.65 s after the tap, before any height trigger; as in human-phone.mjs, the
//          'hud' / 8 m / 4 m habits collapse into that one), and, holding in the air, the thumb
//          put on the sight's amber dot a reaction late, re-read every 0.25–0.5 s. 20 % lift the thumb once mid-climb.
//   touch  The Lineup (no one-thumb scheme there: main.js flies it classic on touch, Assist): their own run-up speed,
//          LIFT timed to the marker and held for their own press, the stick over until the roll-out cue says upright, then
//          LAND; each decision a reaction late (flyTouch).
//   pro    Pro objectives (no thumb: Pro is classic or keys): scripts/human-show.mjs's Pro population with the 1.0 cues
//          (release on the ledge, boost by the cue, roll by the roll-out cue, one hard burn from the BRAKE line).
//
// Each objective is judged with src/daily.js evaluate on scoreRun's card, as the results do.
import { createRun, stepRun, wallProgress } from '../../src/sim/run.js';
import { newInput, up, forward } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { SHOW, COURSES } from '../../src/sim/courses.js';
import { SPEC } from '../../src/sim/spec.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { createOneThumb, markOffset } from '../../src/onethumb.js';
import { OBJECTIVES, evaluate } from '../../src/daily.js';

// A seeded LCG stream (the scripts' own).
export function stream(seed) {
  let s = seed & 0x7fffffff;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  r.pick = (a) => a[Math.floor(r() * a.length)];
  return r;
}

export const POPULATION = {
  thumb: 'one thumb, Assist, careful (slides onto the amber dot)',
  touch: 'two thumbs (classic touch), Assist: lift, roll by the cue, LAND, each a reaction late',
  pro: 'keys, Pro, 1.0 cues (scripts/human-show.mjs pro --cues=new), on the course the objective names',
};
// Which population flies an objective: Pro objectives the Pro players; the Lineup touch; the Show and the Wall one thumb.
export const populationOf = (o) => (o.tier === 'pro' ? 'pro' : o.course === 'lineup' ? 'touch' : 'thumb');

const pr = newPrediction(), off = { x: 0, y: 0, m: 0 }, u = { x: 0, y: 0, z: 0 }, fw = { x: 0, y: 0, z: 0 };

// One one-thumb player on the Show or the Wall.
export function flyThumb(course, r) {
  const P = { lag: 0.18 + r() * 0.25, hangWait: r.pick([0.2, 0.8, 2]), landAt: r.pick(['with-boost', 'with-boost', 'hud', 'hud', 'hud', 8, 4]),
    lapse: r() < 0.2, every: Math.round((0.25 + r() * 0.25) * 240) };
  const lagT = Math.round(P.lag * 240), press = Math.round((P.lag + 0.1) * 240);
  const run = createRun(course), th = createOneThumb();
  let released = false, tapped = false, holding = false, ledgeT = -1, tapAt = -1, lapseAt = -1, landSeen = -1, holdFrom = -1;
  let aimNext = -1, aimAt = -1, want = null;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, t = run.tick, inp = newInput();
    if (!tapped) {
      if (P.lapse && lapseAt < 0 && run.phase === 'ramp' && run.t.progress > 0.4) { lapseAt = t; th.up(); }
      if (lapseAt > 0 && t - lapseAt === 240) th.down();
      if (run.phase === 'ramp' && run.t.progress >= 0.92 && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
        if (ledgeT < 0) { ledgeT = t; th.up(); }
        if (tapAt < 0) tapAt = ledgeT + Math.round(P.hangWait * 240) + press;
        if (t === tapAt) { th.down(); tapped = true; holding = P.landAt === 'with-boost'; }
      }
    } else {
      const h = Math.max(0, c.pos.y - SPEC.comHeight);
      predict(c, h, pr);
      if (!holding && t > tapAt + 24 && th.held) th.up();
      if (!holding) {
        let w = P.landAt === 'hud' ? pr.status !== 'green' : typeof P.landAt === 'number' ? h < P.landAt : false;
        if (pr.status !== 'green' && t > tapAt + lagT) w = true;   // the descent warning (flash + buzz)
        if (w && landSeen < 0) landSeen = t;
        if (landSeen >= 0 && holdFrom < 0) holdFrom = landSeen + press;
        if (holdFrom >= 0 && t >= holdFrom && !th.held) { holding = true; th.down(); }
      }
    }
    // Careful: holding in the air, the thumb goes onto the sight's dot a reaction late, re-read every 0.25–0.5 s.
    if (released && run.phase === 'air' && th.held) {
      if (t >= aimNext) {
        predict(c, Math.max(0, c.pos.y - SPEC.comHeight), pr);
        markOffset(c, pr, course, off);
        want = { x: off.x, y: -off.y }; aimAt = t + lagT; aimNext = t + P.every;
      }
      if (want && t >= aimAt) th.move(want.x, want.y);
    }
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;   // main.js: a lift on the deck lets go
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return run;
}

// One Lineup player on touch (classic, Assist): GO to their own run-up speed, LIFT timed to the lift-off marker
// and held for their own press (0.35–0.5 s), then the stick over (full) to roll (half as LIFT ends, half near the top),
// let go once the roll-out cue says upright again (as scripts/human-show.mjs rolls by the cue), and LAND held a reaction
// after that: LAND rolls out what is left and governs the descent. Half of them nudge the stick toward the mark once
// LAND is holding (tap, look, tap; along the run only past the row), as the Show's marker steerers do.
export function flyTouch(course, r) {
  const lag = 0.18 + r() * 0.25, lagT = Math.round(lag * 240);
  const P = { speed: r.pick([6, 6.5, 7, 7.5, 8, 8.5]), hold: r.pick([0.35, 0.4, 0.45, 0.5]), early: -0.15 + r() * 0.4, rollAt: r.pick(['lift', 'top']), steer: r() < 0.5 };
  const run = createRun(course), { liftOffZ, lineupEnd, pad } = COURSES[course];
  let liftSeen = -1, liftOff = -1, rollFrom = -1, rollSeen = -1, rollOff = -1, landFrom = -1;
  while (run.phase !== 'done') {
    const c = run.car, t = run.tick, inp = newInput();
    inp.assist = 1;
    const v = Math.hypot(c.vel.x, c.vel.z), h = Math.max(0, c.pos.y - SPEC.comHeight);
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    if (run.phase === 'drive' || run.phase === 'air') {
      if (liftSeen < 0) inp.throttle = v < P.speed ? 1 : 0;
      // LIFT: timed to the lift-off marker as it comes (an anticipated press, not a reaction: −0.15 to +0.25 s off it,
      // late more often), held for the player's own press (the reference holds ≈ 0.4 s).
      if (liftSeen < 0 && c.pos.z > liftOffZ + P.early * v) liftSeen = t;
      if (liftSeen >= 0 && t < liftSeen + Math.round(P.hold * 240)) inp.lift = 1;
      if (liftSeen >= 0 && rollFrom < 0 && t >= liftSeen + Math.round(P.hold * 240)) { liftOff = t; if (P.rollAt === 'lift') rollFrom = t + lagT; }
      if (P.rollAt === 'top' && liftOff >= 0 && rollFrom < 0 && c.vel.y < 2) rollFrom = t + lagT;
      if (rollFrom >= 0 && t >= rollFrom) {
        predict(c, h, pr);
        if (rollSeen < 0 && Math.abs(run.t.rollAccum) > Math.PI && Math.abs(pr.rollOut) < 0.35 + lag * 2.5) rollSeen = t;
        if (rollSeen < 0 || t < rollSeen + lagT) inp.roll = -1;
        else if (rollOff < 0) { rollOff = t; landFrom = t + lagT; }
        if (landFrom >= 0 && t >= landFrom) {
          inp.level = 1;
          if (P.steer && h > 2.5 && pr.status !== 'red') {
            up(c, u);
            forward(c, fw);
            const ez = pad.z - pr.landZ, ex = pad.x - pr.landX, side = ez * fw.x - ex * fw.z, along = ez * fw.z + ex * fw.x;
            const tap = t % (2 * lagT) < lagT;
            if (u.y > 0.9 && Math.abs(side) > 1.5 && tap) inp.roll = side > 0 ? 0.4 : -0.4;
            // Along the run only once the row is behind (pitched back over it, the lift leaves the brake and hovers).
            if (u.y > 0.9 && c.pos.z > lineupEnd + 1 && Math.abs(along) > 1.5 && tap) inp.pitch = along > 0 ? 0.5 : -0.5;
          }
        }
      }
    } else inp.brake = 1;
    stepRun(run, inp);
  }
  return run;
}

// One Pro player on the Show or the Wall (scripts/human-show.mjs, `pro --cues=new`; the BOOST cue is the Show's only).
export function flyPro(course, r) {
  const P = { lag: 0.18 + r() * 0.25, climb: r.pick([3, 4, 5, 6, 8, 'hold']), hangWait: r.pick([0.2, 0.8, 2]), spaceHold: r.pick([0.1, 0.2, 0.5]),
    // `roll` is drawn and not read (Pro rolls by the cue): kept so the draws match human-show.mjs's order.
    boost: r.pick(['cue', 'cue', 0.2, 0.5, 1.0]), roll: r.pick(['none', 'left', 'right', 'left']), steer: r.pick(['none', 'marker']),
    landAt: r.pick(['hud', 'hud', 'hud', 'hud', 8]) };
  const run = createRun(course), lagT = Math.round(P.lag * 240);
  let released = false, relT = -1, ledgeT = -1, boostOn = false, cueOffT = -1, rollOn = false, rollDone = false, rollUprightT = -1;
  let burning = false, landing = false, landSeen = -1, keyAx = 0, wHeld = false, wChange = 0, liftHeld = false, liftChange = 0;
  while (run.phase !== 'done') {
    const c = run.car, t = run.tick, inp = newInput();
    inp.assist = 0;
    const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    up(c, u);
    let axTarget = 0;
    if (run.phase === 'drive' || (run.phase === 'ramp' && !released)) {
      inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
      const w = P.climb === 'hold' ? true : v < (run.phase === 'drive' ? 5.5 : P.climb);
      if (w !== wHeld && t - wChange > lagT) { wHeld = w; wChange = t; }
      inp.throttle = wHeld ? 1 : 0;
      inp.fan = run.phase === 'ramp' || c.pos.z > -16 ? 1 : 0;
      if (run.phase === 'ramp' && wallProgress(c.pos) >= 0.97) {
        if (ledgeT < 0) ledgeT = t;
        if (t - ledgeT > (P.hangWait + P.lag) * 240) { released = true; relT = t; }
        else { inp.throttle = 0; inp.brake = 1; }
      }
    } else if (run.phase === 'ramp' || run.phase === 'air') {
      const since = t - relT, h = Math.max(0, c.pos.y - SPEC.comHeight);
      predict(c, h, pr);
      if (since < P.spaceHold * 240) inp.lift = 1;
      const cue = course === 'show' && !run.t.crossedRow && -c.vel.z < 9.5 && c.pos.z > SHOW.rowNear;
      if (P.boost === 'cue') {
        if (cue && since > lagT) boostOn = true;
        if (!cue && cueOffT < 0 && boostOn) cueOffT = t;
        if (cueOffT > 0 && t - cueOffT > lagT) boostOn = false;
      } else boostOn = since > lagT && since < lagT + P.boost * 240;
      if (boostOn) inp.thrust = 1;
      if (!rollDone && since > lagT * 2) {
        rollOn = true;
        if (Math.abs(pr.rollOut) < 0.35 + P.lag * 2.5 && rollUprightT < 0) rollUprightT = t;
        if (rollUprightT > 0 && t - rollUprightT > lagT) { rollOn = false; rollDone = true; }
      }
      if (rollOn) axTarget = Math.sign(pr.rollOut) || 1;
      if (rollDone && Math.abs(pr.rollOut) > 0.18 && t - rollUprightT > lagT * 2) axTarget = Math.sign(pr.rollOut) * 0.6;
      if (rollDone && Math.abs(pr.pitchOut) > 0.15 && t % (2 * lagT) < lagT) inp.pitch = Math.sign(pr.pitchOut) * 0.5;
      if (!landing) {
        const w = P.landAt === 'hud' ? since > lagT && pr.status !== 'green' : h < P.landAt;
        if (w && landSeen < 0) landSeen = t;
        landing = landSeen >= 0 && t - landSeen >= lagT;
      }
      if (landing) {
        if (!burning && pr.margin < 0.5 && u.y > 0.5) burning = true;
        if (burning && pr.sink < Math.min(1.6, 0.35 * pr.profileSink + 0.8)) burning = false;
        const wantLift = u.y > 0.5 && (burning || (h < 3 && pr.sink > 1.2));
        if (wantLift !== liftHeld && t - liftChange > lagT * 0.6) { liftHeld = wantLift; liftChange = t; }
        if (liftHeld) inp.lift = 1;
      }
      if (P.steer === 'marker' && landing && u.y > 0.7 && h > 2.5) {
        forward(c, fw);
        const { pad } = COURSES[course], ez = pad.z - pr.landZ, ex = pad.x - pr.landX;
        const along = ez * fw.z + ex * fw.x, side = ez * fw.x - ex * fw.z;
        const tap = t % (2 * lagT) < lagT;
        if (Math.abs(along) > 2.5 && tap) inp.pitch = along > 0 ? 0.5 : -0.5;
        if (Math.abs(side) > 2.5 && tap && !rollOn) axTarget = side > 0 ? 0.4 : -0.4;
      }
    } else inp.brake = 1;
    const rate = Math.abs(axTarget) > Math.abs(keyAx) && Math.sign(axTarget) !== -Math.sign(keyAx) ? 4 / 240 : 8 / 240;
    keyAx += Math.max(-rate, Math.min(rate, axTarget - keyAx));
    if (run.phase === 'air') inp.roll = keyAx;
    stepRun(run, inp);
  }
  return run;
}

const FLY = { thumb: flyThumb, touch: flyTouch, pro: flyPro };
// scoreRun's cards for `n` players of a population on a course (each population and course starts from `seed`).
export function cards(pop, course, n = 150, seed = 12345) {
  const r = stream(seed), list = [];
  for (let i = 0; i < n; i++) list.push(scoreRun(FLY[pop](course, r).t));
  return list;
}

// Fly `n` players of each needed (population, course) once, and judge every objective on its own population's cards.
// → [{ id, course, population, n, met, share }]
export function reach({ n = 150, seed = 12345, objectives = OBJECTIVES } = {}) {
  const memo = new Map();
  const cardsFor = (pop, course) => {
    const k = `${pop}:${course}`;
    if (!memo.has(k)) memo.set(k, cards(pop, course, n, seed));
    return memo.get(k);
  };
  return objectives.map((o) => {
    const population = populationOf(o), list = cardsFor(population, o.course);
    const met = list.filter((s) => evaluate(o, s, o.course)?.ok).length;
    return { id: o.id, course: o.course, population, n: list.length, met, share: met / list.length };
  });
}
