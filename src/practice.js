// Practice: drills that start anywhere in the flight, with instant retry. Not scored, never
// posted: a drill is a training run on this device only.
//
// Each drill starts from a moment of the reference flight (src/sim/autopilot.js), flown by the
// same deterministic sim to that tick and handed over. So a retry is exactly the same start, the
// reference ghost is exactly where the car is at the hand-over, and the input log (prefix and all)
// still replays bit-exactly for the coach.
import { createRun, stepRun, wallProgress } from './sim/run.js';
import { createAutopilot } from './sim/autopilot.js';
import { newInput, up } from './sim/vehicle.js';
import { COURSES } from './sim/courses.js';
import { SPEC } from './sim/spec.js';
import { dhypot } from './sim/dmath.js';

const uv = { x: 0, y: 0, z: 0 };
const speedOf = (c) => dhypot(c.vel.x, c.vel.y, c.vel.z);
const heightOf = (c) => c.pos.y - SPEC.comHeight;
// The release drills: a RELEASE tap's push-off on the down-jets (ticks), then the hand-over.
const PUSH = 24, HANDOVER = 36;

export const DRILLS = [
  {
    id: 'ledge', n: '01', label: 'On the ledge', courses: ['show', 'wall'],
    blurb: 'Hanging upside down, 27.7 m up. Let go, carry, roll out, land.',
    goal: 'Land it from the ledge',
    hang: true,
    at: (run, st) => st.hanging,
    released: false,
  },
  {
    id: 'release', n: '02', label: 'Just let go', courses: ['show', 'wall'],
    blurb: 'Falling inverted off the lip. Boost, roll out, brake, set it down.',
    goal: 'Roll out high, brake by the line',
    hang: true,
    at: (run, st) => st.releasedTicks >= HANDOVER,
    released: true,
  },
  {
    id: 'carry', n: '03', label: 'Over the row', courses: ['show'],
    blurb: 'Only the boost: carry over five roofs with a metre or two to spare. Ends past the row.',
    goal: 'Clear the roofs by 1–3 m',
    hang: true,
    at: (run, st) => st.releasedTicks >= HANDOVER,
    released: true,
    // Ends once the car is past the row (or on it).
    done: (run) => run.t.contact || run.car.pos.z < COURSES.show.rowFar - 2 || run.phase === 'landed' || run.phase === 'done',
  },
  {
    id: 'land', n: '04', label: '10 m up', courses: ['show', 'wall'],
    blurb: 'Roof up over the pad, falling fast. Catch it and put it down soft.',
    goal: 'Touch down under 1.5 m/s',
    at: (run) => run.phase === 'air' && run.car.vel.y < -2 && heightOf(run.car) <= 10 && up(run.car, uv).y > 0.8,
    released: true,
  },
];
export const drillById = (id) => DRILLS.find((d) => d.id === id) || null;
export const drillsFor = (course) => DRILLS.filter((d) => d.courses.includes(course));

// Fly the reference to the drill's start and hand the run over (≈30–70 ms of sim). The ledge
// drills fly it onto the inverted ledge (93 % of the curl), stop and hang there; the release
// drills then let go as a player does (fan off, a 0.1 s RELEASE tap on the down-jets) and hand over
// 0.15 s after the release: every decision after it is yours.
export function buildDrill(drill, course) {
  const run = createRun(course);
  const ap = createAutopilot(course, drill.hang ? { releaseAt: 0.93, hang: 999, driveOff: false } : {});
  const st = { releasedTicks: 0, hanging: false };
  const idle = newInput();
  for (let i = 0; i < 240 * 60 && run.phase !== 'done'; i++) {
    if (drill.hang && !st.hanging && run.phase === 'ramp' && wallProgress(run.car.pos) >= 0.92 && speedOf(run.car) < 0.2) st.hanging = true;
    if (drill.at(run, st)) break;
    if (drill.released && st.hanging) {
      Object.assign(idle, newInput()); idle.fan = 0; idle.lift = st.releasedTicks < PUSH ? 1 : 0; st.releasedTicks++;
      stepRun(run, idle);
      continue;
    }
    stepRun(run, ap(run));
  }
  run.drill = drill.id;
  run.drillStartTick = run.tick;
  return { run, released: drill.released || run.phase === 'air' };
}

// The drill's own scorecard: what it trains, in numbers, with a pass mark.
export function drillResult(drill, run, card) {
  const t = run.t;
  if (drill.id === 'carry') {
    const clear = Number.isFinite(t.minClearance) ? t.minClearance : null;
    const pass = !t.contact && t.crossedRow && clear !== null && clear >= 0.8 && clear <= 4;
    const carry = dhypot(run.car.vel.x, run.car.vel.z);
    return {
      pass, headline: t.contact ? 'On the roofs' : !t.crossedRow ? 'Short of the row' : clear > 4 ? 'Over, with room to spare' : 'Over the row',
      stats: [[t.contact ? 'contact' : clear !== null ? `${clear.toFixed(1)} m over the roofs` : 'no clearance', t.contact || (clear !== null && clear < 0.8)], [`${carry.toFixed(1)} m/s carry`, carry > 12]],
    };
  }
  const landed = t.touchTick >= 0 && card && !card.facts.crashed;
  const soft = landed && t.sink <= 1.5;
  return {
    pass: drill.id === 'land' ? soft : landed && t.sink <= 3,
    headline: !landed ? (card?.verdict || 'Crash') : soft ? 'Soft' : t.sink <= 3 ? 'Firm' : 'Hard',
    stats: landed ? [[`${t.sink.toFixed(1)} m/s touchdown`, t.sink > 3], [`${t.tiltDeg.toFixed(0)}° tilt`, t.tiltDeg > 15], [`${card.facts.padMiss} m from the mark`, card.facts.padMiss > 7], [`${card.facts.airPct}% gas left`]] : [],
  };
}

// The carry drill ends over the row, so its coaching is its own: the boost, nothing after it.
export function drillCoach(drill, run) {
  if (drill.id !== 'carry') return null;
  const t = run.t, carry = dhypot(run.car.vel.x, run.car.vel.z).toFixed(1);
  const clear = Number.isFinite(t.minClearance) ? t.minClearance.toFixed(1) : null;
  if (t.contact || !t.crossedRow) {
    return [{ id: 'short', title: t.contact ? 'Came down on the row' : 'Short of the row', detail: `You carried ${carry} m/s off the ledge; the far roofs need about 9.5 m/s.`, fix: 'Hold BOOST (F) right after the release, until the cue goes: about a third of a second.' }];
  }
  if (clear > 4) {
    return [{ id: 'long', title: 'More boost than the roofs need', detail: `${clear} m over the roofs at ${carry} m/s. Every extra m/s off the ledge lands you about 4 m further past the mark.`, fix: 'Let go of BOOST as the cue goes (about 9.5 m/s): a metre or two over the roofs is the art.' }];
  }
  return [{ id: 'clean', title: 'Just enough', detail: `${clear} m over the roofs at ${carry} m/s.`, fix: 'Now fly it all the way down: drill 02, Just let go.' }];
}
