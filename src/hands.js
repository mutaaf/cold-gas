// The driver's hands: what keys and a thumb on a stick become at the wheel and the pedals, once
// per 240 Hz sim tick. Pure (no DOM), so the bench and the unit tests drive through the same
// hands a player has. src/input.js owns the devices and calls these.
import { newInput, clearInput } from './sim/vehicle.js';

const KEY_IN = 4 / 240, KEY_OUT = 8 / 240, STICK_RATE = 4;

// An analog stick on the ground: a dead zone that starts from zero at its edge (a thumb resting
// near the centre gives nothing, and the first millimetre past it gives a little, not a jump to
// 12 %), then a mild expo, so half the stick's travel is the finer third of the lock where lane
// changes and corrections live, and full stick is still full lock.
export function stickShape(v, dead = 0.12, expo = 0.45) {
  const a = Math.abs(v);
  if (a <= dead) return 0;
  const x = Math.min(1, (a - dead) / (1 - dead));
  return Math.sign(v) * x * (1 - expo + expo * x * x);
}

// Reverse (Free Drive and the Sandbox): hold the brake at a standstill. A stop is a stop first:
// the brake held from speed brings the car to rest and holds it there for REVERSE_DWELL before
// it backs up (it used to back up the instant the car slowed through 0.8 m/s, so stopping at a
// line rolled you backwards). Already rolling back, it keeps reversing. Mutates `inp`.
const REVERSE_DWELL = 0.35;
export function createReverse() {
  let held = 0;
  return function reverse(c, inp) {
    const q = c.quat, fz = 1 - 2 * (q.x * q.x + q.y * q.y), fx = 2 * (q.x * q.z + q.w * q.y);
    const vf = c.vel.x * fx + c.vel.z * fz;
    if (inp.brake > 0 && inp.throttle === 0 && vf < 0.8) {
      if (vf < -0.3 || held >= REVERSE_DWELL) { inp.throttle = -0.35 * inp.brake; inp.brake = 0; }
      else held += 1 / 240;
    } else held = 0;
    return inp;
  };
}

export function createHands() {
  // The hands' state lives on objects, not in closure variables: a double written to a closure slot is a
  // new heap number on every write, 240 times a second (0049). `pd` is pedals()'s answer, reused.
  const h = { ax: 0, thr: 0, brk: 0 }, pd = { thr: 0, brk: 0 };
  const pedal = (cur, on, tIn) => Math.max(0, Math.min(1, cur + (on ? 1 / (240 * tIn) : -2 / (240 * tIn))));
  return {
    reset() { h.ax = 0; h.thr = 0; h.brk = 0; },
    get ax() { return h.ax; },
    // A steering target in [−1, 1] (keys, or the touch stick) at ground speed v (m/s). Keys: full
    // lock in 0.25 s at a crawl, ≈0.6 s at 60 km/h, ≈1 s at 120 km/h, back to centre twice as fast.
    // A stick (`analog`) already is a hand: it gets STICK_RATE times that, enough to take the edge
    // off a thumb's jab without adding the lag that made phone steering late into every bend.
    steer(target, v = 0, analog = false) {
      const ax = h.ax;
      const into = Math.abs(target) > Math.abs(ax) && Math.sign(target) !== -Math.sign(ax);
      const rate = (into ? KEY_IN / (1 + v / 12) : KEY_OUT) * (analog ? STICK_RATE : 1);
      h.ax = ax + Math.max(-rate, Math.min(rate, target - ax));
      return h.ax;
    },
    pedals(up, down) { h.thr = pedal(h.thr, up, 0.3); h.brk = pedal(h.brk, down, 0.15); pd.thr = h.thr; pd.brk = h.brk; return pd; },
    // Keyboard only, straight into a sim input (the bench and the tests).
    keyboard(keys, car, tier = 'assist', out = newInput()) {
      clearInput(out);
      out.assist = tier === 'assist' ? 1 : 0;
      const v = car ? Math.sqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z) : 0;
      out.steer = this.steer((keys.right ? 1 : 0) - (keys.left ? 1 : 0), v);
      const p = this.pedals(!!keys.up, !!keys.down);
      out.throttle = p.thr; out.brake = p.brk;
      return out;
    },
  };
}
