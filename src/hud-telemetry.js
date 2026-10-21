// The HUD's telemetry channels, read like the reveal livestream read them (ticket 0018,
// docs/REVEAL_RESEARCH.md §2.1.2 PITCH, §2.1.4 G-FORCE). Pure and allocation-free: the HUD calls
// these every frame. Display only: nothing here feeds back into the sim.
import { CAR, G, pressureOf } from './sim/vehicle.js';
import { G_WIN } from './sim/run.js';
import { SPEC } from './sim/spec.js';

const DEG = 180 / Math.PI, DT = 1 / 240, SLOTS = G_WIN + 1;   // 121 velocities span 120 ticks

// PITCH in degrees. On the deck it is the nose's angle up the curl in the course's vertical plane
// (the Wall runs toward +z): 0 on the approach, 90 on the vertical, 170 hanging at the top, as the
// livestream's "170° pitch". Off the deck it is the signed angle of the nose from level (+ up).
// The car's nose is body +z, so its world direction is the quaternion's third column.
export function hudPitch(q, onDeck) {
  const fx = 2 * (q.x * q.z + q.w * q.y), fy = 2 * (q.y * q.z - q.w * q.x), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  if (!onDeck) return Math.atan2(fy, Math.sqrt(fx * fx + fz * fz)) * DEG;
  const a = Math.atan2(fy, fz) * DEG;
  return a < -90 ? a + 360 : a;   // past the top of the curl it keeps counting (181°…), never wraps to −179
}

// G: specific force over the last 0.5 s, the window `run.t.brakePeakG` (the results chip) is taken
// over, read like an accelerometer averaged over that window: |Δv/0.5 s + g| / g from the velocity
// half a second ago. (Averaging each tick's magnitude instead rectifies the rigid contacts'
// tick-to-tick jitter and reads 1.2 G cruising on the level.) Feed it the car's velocity after
// every sim tick; until it has half a second it spans what it has.
export function createGWindow() {
  const buf = new Float64Array(SLOTS * 3);
  let n = 0;
  return {
    reset() { n = 0; },
    push(v) { const i = (n % SLOTS) * 3; buf[i] = v.x; buf[i + 1] = v.y; buf[i + 2] = v.z; n++; },
    read() {
      if (n < 2) return 1;
      const span = Math.min(n - 1, G_WIN), now = ((n - 1) % SLOTS) * 3, then = ((n - 1 - span) % SLOTS) * 3, dt = span * DT;
      const ax = (buf[now] - buf[then]) / dt, ay = (buf[now + 1] - buf[then + 1]) / dt + G, az = (buf[now + 2] - buf[then + 2]) / dt;
      return Math.sqrt(ax * ax + ay * ay + az * az) / G;
    },
  };
}

// Tank pressure in bar: the adiabatic blowdown `pressureOf` flies (p ∝ m^1.375), from 690 bar full.
export const tankBar = (air) => (air > 0 ? SPEC.gasPressureBar * (air / CAR.airMass) ** 1.375 : 0);

// REG while the regulator holds line pressure at the nozzles; BLOWDOWN once the tanks fall below it
// (SPEC.regulatedFraction) and every jet loses thrust with the gas.
export const gasState = (air) => (pressureOf(air) < 1 ? 'blowdown' : 'reg');
