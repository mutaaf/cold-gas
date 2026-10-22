// The aftermath (ticket 0062): a run that ends with the car still moving doesn't freeze it there.
// The same world keeps stepping on a fixed post-crash input (brakes through ABS, no drive, no fan,
// valves shut) until the car is at rest or the 6 s cap. Deterministic, and it changes nothing that
// is scored: the card is closed when the run ends, and the Worker replays to there.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate, armAftermath, aftermathStep, aftermath, AFTER_CAP, AFTER_SPEED, FRAME_EVERY } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { newInput } from '../../src/sim/vehicle.js';

const speedOf = (c) => Math.hypot(c.vel.x, c.vel.y, c.vel.z);

// Full throttle down the Lineup's approach and never lift: the run ends 'no-jump' at ≈38 m/s.
function noJump(arm) {
  const run = createRun('lineup');
  if (arm) armAftermath(run);
  const inp = newInput();
  inp.throttle = 1;
  while (run.phase !== 'done') { inp.steer = run.tick > 600 ? 0.1 : 0; stepRun(run, inp); }
  return run;
}
// The Show flown by the reference with LAND never pressed after the release: it comes down on the row.
function showCrash(arm) {
  const run = createRun('show');
  if (arm) armAftermath(run);
  const ap = createAutopilot('show');
  while (run.phase !== 'done') { const inp = ap(run); if (run.phase === 'air') { inp.level = 0; inp.lift = 0; inp.thrust = 1; } stepRun(run, inp); }
  return run;
}
const fingerprint = (run) => {
  const c = run.car, b = c.world.bodies.map((x) => [x.cx, x.cy, x.cz, x.qx, x.qy, x.qz, x.qw]);
  return JSON.stringify([run.tick, c.pos, c.vel, c.quat, c.angVel, b, run.frames.length, Array.from(run.frames.at(-1))]);
};

describe('the aftermath: a crashed car brakes to rest under the same physics', () => {
  it('a car doing 38 m/s when its run ends brakes to rest within the cap, in a straight ABS stop', () => {
    const run = noJump(true);
    expect(run.t.endReason).toBe('no-jump');
    const v0 = speedOf(run.car);
    expect(v0).toBeGreaterThan(30);
    expect(run.car.world.freed).toBe(false);   // armed: the world outlives the run
    const z0 = run.car.pos.z, frames0 = run.frames.length;
    let ticks = 0, prev = v0, rises = 0;
    while (!aftermathStep(run)) {
      ticks++;
      const v = speedOf(run.car);
      if (v > prev + 0.05) rises++;
      prev = v;
    }
    expect(ticks).toBeLessThan(AFTER_CAP);
    expect(speedOf(run.car)).toBeLessThan(AFTER_SPEED);
    expect(run.car.world.freed).toBe(true);
    expect(rises).toBe(0);                                   // it only slows
    // ≈1 g on concrete: v²/2a from 38 m/s is ≈70–110 m, in ≈3.5–5 s.
    const dist = run.car.pos.z - z0;
    expect(dist).toBeGreaterThan(55);
    expect(dist).toBeLessThan(130);
    expect(ticks / 240).toBeGreaterThan(3);
    expect(ticks / 240).toBeLessThan(5.5);
    // The replay carries it: frames every 4 ticks to the stop, the parked bodies with them.
    expect(run.frames.length - frames0).toBeGreaterThanOrEqual(Math.floor(ticks / FRAME_EVERY));
    expect(run.frames.at(-1).length).toBe(run.frames[0].length);
    // The jets stay shut and the fan stays off.
    expect(Math.max(...run.car.throttles)).toBeLessThan(0.01);
    expect(run.car.fan).toBeLessThan(0.01);
  });

  it('is deterministic: two runs of the same crash come to rest bit-identically', () => {
    const a = aftermath(noJump(true)), b = aftermath(noJump(true));
    expect(fingerprint(a)).toBe(fingerprint(b));
    const c = aftermath(showCrash(true)), d = aftermath(showCrash(true));
    expect(fingerprint(c)).toBe(fingerprint(d));
  });

  it('a Show crash moving at the end settles (or reaches the cap) with every frame finite', () => {
    const run = showCrash(true);
    aftermath(run);
    expect(run.after.done).toBe(true);
    expect(run.after.ticks).toBeLessThanOrEqual(AFTER_CAP);
    for (const f of run.frames) for (let i = 0; i < f.length; i++) expect(Number.isFinite(f[i])).toBe(true);
  });

  it('changes nothing scored: the card and telemetry match the plain run and the Worker replay', () => {
    for (const fly of [noJump, showCrash]) {
      const plain = fly(false);
      const armed = fly(true);
      const t0 = JSON.stringify(armed.t), card0 = JSON.stringify(scoreRun(armed.t));
      aftermath(armed);
      expect(armed.after.ticks).toBeGreaterThan(0);
      expect(JSON.stringify(armed.t)).toBe(t0);                        // the book stays closed
      expect(JSON.stringify(armed.t)).toBe(JSON.stringify(plain.t));
      expect(JSON.stringify(scoreRun(armed.t))).toBe(card0);
      expect(armed.inputLog).toEqual(plain.inputLog);                  // nothing logged
      const server = simulate(plain.inputLog, plain.course);           // what the Worker does
      expect(JSON.stringify(scoreRun(server.t))).toBe(card0);
      expect(server.car.world.freed).toBe(true);                       // and it frees at 'done', as before
      expect(plain.car.world.freed).toBe(true);
    }
  });
});
