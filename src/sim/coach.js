// The coach: what happened in a flight, and the one fix that matters most. Pure: it re-flies the
// input log through the same sim (simulate's onTick) and reads the flight tick by tick: the
// release, the carry over the row, the roll-out, the braking, the touchdown. Every number it
// quotes comes from that replay and the predictor (src/sim/predict.js), never from a guess.
import { simulate } from './run.js';
import { up, CAR, NOZZLES, forward } from './vehicle.js';
import { COURSES } from './courses.js';
import { SPEC } from './spec.js';
import { predict, newPrediction, SINK_SOFT } from './predict.js';
import { v3 } from './m3.js';
import { dhypot } from './dmath.js';

const r1 = (x) => Math.round(x * 10) / 10;
const LIFT_IDX = NOZZLES.map((n, i) => (n.group === 'lift' ? i : -1)).filter((i) => i >= 0);
const REAR_IDX = NOZZLES.map((n, i) => (n.group === 'rear' ? i : -1)).filter((i) => i >= 0);

// Read the flight. Returns the events the coach (and the drills) talk about. `fromTick`: a drill's
// hand-over (what the reference flew before it isn't yours to be coached on).
export function readFlight(inputLog, courseId, fromTick = 0) {
  const course = COURSES[courseId];
  const pr = newPrediction(), u = v3(), fw = v3();
  const f = {
    course: courseId, releaseTick: -1, releaseH: 0, releaseProgress: 0,
    boostTicks: 0, carry: 0, rowCleared: false,
    rollStartTick: -1, uprightTick: -1, uprightH: -1, rollDeg: 0,
    brakeTick: -1, brakeH: 0, brakeSink: 0, brakeA: 0, brakeBy: 0,
    needTick: -1, needH: 0, needSink: 0, needA: 0, needUp: 1, brakeGoverned: false,
    maxSinkBeforeBrake: 0, lowestMargin: Infinity, redTicks: 0,
    touch: null, wasInverted: false, gasAtTouch: 0, pressureAtTouch: 0, apexTick: -1, landedTick: -1, levelHeld: 0, airTicks: 0,
  };
  let lastPhase = '', wasInverted = false;
  const run = simulate(inputLog, courseId, undefined, (r, inp) => {
    const c = r.car, t = r.tick;
    if (r.phase === 'air' && lastPhase !== 'air' && f.releaseTick < 0) {
      f.releaseTick = r.t.airStartTick; f.releaseH = r.t.launchHeight - SPEC.comHeight; f.releaseProgress = r.t.launchProgress;
    }
    lastPhase = r.phase;
    // (After a drill's hand-over the reference's valves take ≈0.1 s to close: not yours either.)
    if (r.phase !== 'air' || t < fromTick + (fromTick > 0 ? 24 : 0)) return;
    f.airTicks++;
    up(c, u);
    const h = Math.max(0, c.pos.y - SPEC.comHeight);
    predict(c, h, pr);
    if (inp.level) f.levelHeld++;
    // The carry: rear jets, and the speed along the run they leave you with.
    let rear = 0;
    for (const i of REAR_IDX) rear += c.throttles[i];
    const vh = dhypot(c.vel.x, c.vel.z);
    if (rear > 0.4) { f.boostTicks++; f.carry = vh; }
    else if (f.boostTicks === 0 && t - f.releaseTick < 120) f.carry = vh;   // no boost (yet): what the release gave
    forward(c, fw);
    if (r.t.crossedRow) f.rowCleared = true;
    // The roll-out: from upside down to the roof up.
    if (u.y < -0.3) wasInverted = f.wasInverted = true;
    if (wasInverted && f.rollStartTick < 0 && Math.abs(c.angVel.x * fw.x + c.angVel.y * fw.y + c.angVel.z * fw.z) > 1) f.rollStartTick = t;
    if (wasInverted && f.uprightTick < 0 && u.y > 0.85) { f.uprightTick = t; f.uprightH = h; }
    // Braking: the first tick the four down-jets push hard while the car is roof-up and falling.
    let lift = 0;
    for (const i of LIFT_IDX) lift += c.throttles[i];
    const falling = c.vel.y < -1;
    if (f.brakeTick < 0 && falling && u.y > 0.5) f.maxSinkBeforeBrake = Math.max(f.maxSinkBeforeBrake, pr.sink);
    if (f.brakeTick < 0 && falling && u.y > 0.5 && lift > 2) {
      f.brakeTick = t; f.brakeH = h; f.brakeSink = pr.sink; f.brakeA = pr.aMax; f.brakeBy = pr.brakeBy; f.brakeGoverned = !!inp.level && !!inp.assist;
    }
    // The brake-by line: the first moment the stop from here (plus a reaction and a metre) no
    // longer fits under the car. That's when braking had to start.
    if (falling && f.needTick < 0 && pr.margin <= 0) { f.needTick = t; f.needH = h; f.needSink = pr.sink; f.needA = pr.aMax; f.needUp = u.y; }
    if (falling && u.y > 0.5) {
      f.lowestMargin = Math.min(f.lowestMargin, pr.margin);
      if (pr.status === 'red') f.redTicks++;
    }
  });
  const t = run.t;
  f.gasAtTouch = t.touchTick >= 0 ? (t.airAtTouch / CAR.airMass) * 100 : (t.airEnd / CAR.airMass) * 100;
  f.touch = t.touchTick >= 0 ? { sink: t.sink, tilt: t.tiltDeg, x: t.lateral, z: t.landZ, padMiss: dhypot(t.lateral, t.landZ - course.pad.z), along: t.landZ - course.pad.z } : null;
  f.rollDeg = Math.max(Math.abs(t.rollAccum), Math.abs(t.pitchAccum)) * 180 / Math.PI;
  f.t = t;
  return { run, flight: f };
}

// The controls a fix names, in the device's words (src/pointer.js coachWords; this default is a keyboard's).
// One instruction per device and tier: on Assist the brake is LAND, on Pro and Advanced it's LIFT by the
// BRAKE line (Pro has no LAND governor), as the how-to card, the cue line and the pointer say it.
export const KEY_WORDS = { land: 'LAND (Shift)', lift: 'LIFT (Space)', release: 'RELEASE (Space)', boost: 'BOOST (F)', roll: '← →' };

// The fixes, most costly first. Each: { id, title, detail, fix, weight }. Only the words depend on `say`.
export function coach(inputLog, courseId, card = null, fromTick = 0, say = KEY_WORDS) {
  const { run, flight: f } = readFlight(inputLog, courseId, fromTick);
  const assist = (card?.tier || run.t.tier) === 'assist';
  const t = run.t, course = COURSES[courseId];
  const wall = courseId !== 'lineup', show = courseId === 'show';
  const out = [];
  const add = (id, weight, title, detail, fix) => out.push({ id, weight, title, detail, fix });

  if (wall && t.airStartTick < 0) {
    if (t.fellOff) add('fell-off', 10, 'Slid off the deck', `The car left the side of the curl ${r1(t.maxRampHeight)} m up.`, 'Keep it on the centreline: small steering corrections, and crawl (≈20 km/h) so the fan holds you.');
    else add('no-release', 10, 'Never let go', `You hung ${r1(t.invertedTime)} s inverted but never released.`, `On the ledge, tap ${say.release} to let go.`);
    return finish(out, f);
  }
  if (wall && f.releaseProgress < 0.95 && f.releaseTick >= 0) {
    add('early-release', 6, 'Let go before the ledge', `Released ${Math.round(f.releaseProgress * 100)} % up the curl: the deck was still under you.`, 'Crawl all the way onto the inverted ledge, stop, then release.');
  }
  if (show && t.contact) {
    const need = 9.5;
    add('short', 9, 'Came down on the row', `You carried ${r1(f.carry)} m/s off the ledge; the far roofs need about ${need} m/s.`,
      f.boostTicks === 0 ? `Right after the release, hold ${say.boost} until the cue goes: about a third of a second.` : 'Hold BOOST a little longer, and don\'t pitch back to chase the mark until you\'re past the roofs.');
  }
  // Braking.
  if (t.touchTick >= 0 && f.t.sink > SINK_SOFT && !t.contact) {
    if (f.brakeTick < 0) {
      add('no-brake', 9, 'Never braked', `You hit the ground at ${r1(t.sink)} m/s.`, assist ? `Hold ${say.land} right after you let go: it rolls you out and brakes you to the ground.` : `Hold ${say.lift} by the BRAKE line on the descent tape${f.needTick >= 0 ? `: it passed at ${Math.ceil(f.needH)} m on this fall` : ''}.`);
    } else {
      const late = f.needTick >= 0 && f.brakeTick > f.needTick + 12;
      // With LAND held the computer brakes as soon as the car is roof-up: a late brake there is a
      // late roll-out (or a late LAND), and the roll-out finding says so.
      const governedLate = late && f.brakeGoverned && f.levelHeld > 0;
      if (governedLate) {
        if (!(f.uprightH >= 0 && f.uprightH < 12)) {
          add('late-land', 8, 'LAND came too late', `The stop needed to start at ${Math.ceil(f.needH)} m; LAND was braking from ${r1(f.brakeH)} m.`,
            `Hold ${say.land} from the release: it rolls you out and paces the whole fall.`);
        }
      } else if (late) {
        const needAt = Math.ceil(f.needH);
        add('late-brake', 8 + Math.min(2, (f.needH - f.brakeH) / 3), 'Braked too late',
          `You started braking at ${r1(f.brakeH)} m, falling ${r1(f.brakeSink)} m/s. With ${r1(f.needA)} m/s² of braking available, the stop needed to start at ${needAt} m (you were falling ${r1(f.needSink)} m/s there${f.needUp < 0.85 ? ', still rolling out' : ''}).`,
          `Hold ${assist ? say.land : say.lift} from ${needAt} m or higher: the BRAKE line on the descent tape.${assist ? ' Or hold it from the release and let it pace the fall.' : ''}`);
      } else {
        add('ran-out', 6, 'Out of braking at the bottom', `You braked from ${r1(f.brakeH)} m but still touched down at ${r1(t.sink)} m/s with ${Math.round(f.gasAtTouch)} % gas.`,
          f.gasAtTouch < 25 ? 'The tanks blow down as they empty: below about 40 % the jets lose thrust. Boost less and brake once, hard, near the BRAKE line.' : 'Stay on the brake through the last 2 m: hold the sink in the green band to the ground.');
      }
    }
  }
  // Roll-out.
  if (wall && f.uprightTick > 0 && f.uprightH >= 0 && f.uprightH < 12 && f.releaseTick >= 0) {
    add('late-roll', f.t.sink > SINK_SOFT ? 8.5 : 6, 'Upright too low', `You were roof-up only ${r1(f.uprightH)} m above the ground: the roll-out ate the height the brake needed.`,
      assist ? `Hold ${say.land} straight after the release: it rolls you out the nearer way.` : `Roll with ${say.roll} straight after the release.`);
  }
  if (wall && f.rollDeg > 230 && !t.flipped) {
    add('over-roll', 4, 'Rolled past upright', `The car turned ${Math.round(f.rollDeg)}°: about ${Math.round(f.rollDeg - 180)}° more than the half-roll you needed.`,
      'Let go of the roll about 40° early: the car keeps turning for a reaction time. Watch the roll-out arrow on the dial.');
  }
  if (wall && f.wasInverted && f.uprightTick < 0 && t.touchTick >= 0) {
    add('no-roll', 9, 'Never rolled upright', `You touched down ${Math.round(t.tiltDeg)}° from level.`, assist ? `Hold ${say.land} after the release: it rolls you upright.` : `Roll out with ${say.roll} straight after the release.`);
  }
  // Touchdown attitude and the mark.
  if (t.touchTick >= 0 && t.tiltDeg > 10 && f.uprightTick >= 0) {
    add('tilt', 4, 'Touched down tilted', `${Math.round(t.tiltDeg)}° off level at touchdown: the wheels met the ground one at a time.`,
      assist ? `Stop steering for the last 2 m and let the car level (${say.land} levels it for you).` : 'Level it by the dial before the last 2 m: the horizon flat, the roll and pitch cues gone.');
  }
  if (f.touch && f.touch.padMiss > 7 && !t.contact) {
    const past = show ? f.touch.along < 0 : false;
    add('mark', 3 + Math.min(3, f.touch.padMiss / 15), past ? 'Long of the mark' : 'Off the mark',
      `You landed ${r1(f.touch.padMiss)} m from the mark${past ? ` (${r1(-f.touch.along)} m past it)` : ''}.`,
      show && f.carry > 11 ? `You carried ${r1(f.carry)} m/s: about 9.5 clears the roofs. Then pitch the nose up a touch to walk the touchdown marker onto the pad.` : 'Watch the touchdown marker on the ground: lean toward the pad (pitch or roll) above 5 m to walk it onto the rings, then level.');
  }
  if (t.touchTick >= 0 && f.gasAtTouch < 10) {
    add('gas', 3, 'Nearly out of gas', `${Math.round(f.gasAtTouch)} % left at touchdown.`, 'Shorter boosts and one hard, late brake use the least gas.');
  }
  if (t.flipped && !out.length) add('flipped', 8, 'Rolled over', 'The car ended on its roof.', 'Touch down level, slowly: watch the sink band and the attitude dial.');
  return finish(out, f, card);
}

function finish(out, f, card) {
  out.sort((a, b) => b.weight - a.weight);
  if (!out.length) {
    out.push({ id: 'clean', weight: 0, title: 'Clean', detail: card ? `${card.verdict}: nothing big to fix.` : 'Nothing big to fix.',
      fix: card && card.tier === 'assist' ? 'Want more? Try Pro: you fly the landing yourself, and it scores ×1.08.' : 'Chase the details: sink under 1 m/s, the 2 m ring, more gas left.' });
  }
  return { items: out.slice(0, 3), flight: f };
}
