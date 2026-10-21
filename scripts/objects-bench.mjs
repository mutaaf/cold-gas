// What the world's objects cost the sim, per 240 Hz tick: the scored references as the Worker
// replays them (simulate(log): the verify path), a crash that wakes the parked row, the car parked
// beside the launch pad through a static fire, and the Sandbox with a row of parked cars, cones and
// barriers driven through at speed. Median of `--reps` passes after a warm-up; mean and worst tick.
//   node scripts/objects-bench.mjs [--reps=5] [--json]
// A 60 fps frame runs 4 ticks: ms/frame = 4 × ms/tick. docs/OBJECTS.md has the budget.
import { initPhysics } from '../src/sim/engine.js';
import { createRun, stepRun, simulate } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { createVehicle, step, newInput, DT } from '../src/sim/vehicle.js';
import { freeWorld } from '../src/sim/world.js';
import { createArenaCourse } from '../src/build/arena.js';
import { createObjectStore, composeCourse } from '../src/build/objects.js';
import { PIECES } from '../src/build/catalogue.js';

await initPhysics();
const REPS = +(process.argv.find((a) => a.startsWith('--reps='))?.slice(7) || 5);
const now = () => performance.now();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// Record a log once (the autopilot, or a scripted input), then time the Worker's path: simulate(log).
function logOf(course, input) {
  const run = createRun(course);
  const ap = input ? null : createAutopilot(course);
  while (run.phase !== 'done') stepRun(run, ap ? ap(run) : input(run));
  return run.inputLog;
}
function replay(name, course, log) {
  const ms = [];
  let ticks = 0;
  for (let r = 0; r <= REPS; r++) {
    const t0 = now();
    const run = simulate(log, course);
    const t = now() - t0;
    ticks = run.tick;
    if (r) ms.push(t);   // the first pass warms the JIT
  }
  const m = median(ms);
  return { name, ticks, ms: +m.toFixed(1), msPerTick: +(m / ticks).toFixed(4) };
}

// A car stepped tick by tick on a course object (the Sandbox), with a per-tick worst case.
function drive(name, course, setup, input, ticks) {
  const means = [], worst = [];
  let bodies = 0;
  for (let r = 0; r <= REPS; r++) {
    const c = createVehicle(course);
    setup?.(c);
    const inp = newInput();
    let tot = 0, max = 0;
    for (let k = 0; k < ticks; k++) {
      Object.assign(inp, input(c, k));
      const t0 = now();
      step(c, inp);
      const t = now() - t0;
      tot += t; if (t > max) max = t;
    }
    bodies = Math.max(bodies, c.world.rw.bodies.len());
    freeWorld(c.world);
    if (r) { means.push(tot / ticks); worst.push(max); }
  }
  return { name, ticks, msPerTick: +median(means).toFixed(4), worstTick: +median(worst).toFixed(3), engineBodies: bodies };
}

const out = [];
for (const course of ['show', 'wall', 'lineup']) out.push(replay(`${course} reference (verify)`, course, logOf(course)));
// Floored at the Lineup's parked row from the start line: every body woken, shoved and stacked.
out.push(replay('lineup crash into the row (verify)', 'lineup', logOf('lineup', () => ({ throttle: 1, assist: 1 }))));

// The Show with the car parked on the launch pad's apron through the static fire (the complex's
// colliders streamed in, the plume on the car): the course as a player who drives out there meets it.
{
  let site = null, rocket = null;
  try { site = await import('../src/sim/complex.js'); rocket = await import('../src/sim/rocket.js'); } catch { /* before the complex was solid */ }
  if (site?.siteOf) {
    const s = site.siteOf('show'), p = site.toWorld(s, site.PLUME.exit[0] - 12, 0, site.PLUME.exit[2]);
    const ticks = Math.round((rocket.FIRE_SCHEDULE.first + 9) / DT);
    out.push(drive('show: parked at the trench exit through a static fire', 'show', (c) => { c.pos.x = p.x; c.pos.z = p.z; c.pos.y = site.PAD_Y + 0.62; }, () => ({ brake: 1, assist: 1 }), ticks));
  }
}

// The Sandbox: a slalom of parked cars, cones and barriers, driven through at full throttle.
function sandbox(dynamic) {
  const store = createObjectStore();
  const course = composeCourse(createArenaCourse(), store);
  for (let i = 0; i < 6; i++) store.addObject({ type: 'car', transform: { x: (i % 2 ? 1.2 : -1.2), y: 0, z: 20 + i * 9, yaw: Math.PI / 2 } });
  if (dynamic && PIECES.cone && PIECES.barrier) {
    for (let i = 0; i < 30; i++) store.addObject({ type: 'cone', transform: { x: -3 + (i % 6) * 1.2, y: 0, z: 80 + Math.floor(i / 6) * 3 } });
    for (let i = 0; i < 10; i++) store.addObject({ type: 'barrier', transform: { x: -4 + (i % 5) * 2, y: 0, z: 100 + Math.floor(i / 5) * 4, yaw: Math.PI / 2 } });
  }
  return course;
}
const label = PIECES.cone ? 'sandbox: 6 parked cars, 30 cones, 10 barriers, floored through them' : 'sandbox: 6 parked cars (static boxes), floored through them';
out.push(drive(label, sandbox(true), (c) => { c.pos.z = 0; }, (c, k) => ({ throttle: k < 240 * 6 ? 1 : 0, brake: k >= 240 * 6 ? 1 : 0, assist: 1 }), 240 * 9));

if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else for (const r of out) console.log(JSON.stringify(r));
