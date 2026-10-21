// POWER-UPS: the arcade layer. Opt-in, Free Drive and the Sandbox only, never a scored event (the
// Show, the Wall and the Lineup never construct this). Each one acts between sim ticks, on the
// car's inputs before a tick or its state after one, and says what it changed:
//   nitrogen      tanks refilled to the full fill (CAR.airMass)
//   overpressure  3 s: the rear jets lit, the gas they burn handed back, and a +0.5 g push
//   fan           10 s: the suction fan on, plus 1 g more toward whatever surface is under it
//   slowmo        6 s: the clock at 0.35× (the sim still steps at 240 Hz; fewer ticks per second)
//   magnet        8 s: airborne, LAND (Assist's leveller) with the gas handed back, and 3 m/s² down
//   shield        8 s: hits, scrapes and dents don't register (impact events dropped, crush held)
import { POWERUPS, POWERUP_IDS } from './catalogue.js';
import { CAR } from '../sim/vehicle.js';

const G = 9.81;

export function createPowerups() {
  const timers = Object.fromEntries(POWERUP_IDS.map((id) => [id, 0]));
  const st = { airBefore: 0, impBefore: 0, crushSnap: null, shownSnap: null, granted: 0 };

  function grant(id, car) {
    const p = POWERUPS[id];
    if (!p) return false;
    st.granted++;
    if (id === 'nitrogen') { if (car) car.air = CAR.airMass; return true; }
    timers[id] = p.s;
    if (id === 'shield' && car) { st.crushSnap = Float64Array.from(car.crush); st.shownSnap = Float64Array.from(car.crushShown); }
    return true;
  }

  const airborne = (c) => c.grounded === 0 && !c.hullContact;
  // Before a sim tick: inputs.
  function preStep(car, inp) {
    st.airBefore = car.air;
    st.impBefore = car.impacts.count;
    if (timers.overpressure > 0) inp.thrust = 1;
    if (timers.fan > 0) inp.fan = 1;
    if (timers.magnet > 0 && airborne(car)) { inp.level = 1; inp.assist = 1; inp.manual = 0; }
  }
  // After a sim tick (dt = sim seconds): state.
  function postStep(car, dt) {
    const q = car.quat;
    if (timers.overpressure > 0) {
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), l = Math.hypot(fx, fz) || 1;
      car.vel.x += (fx / l) * 0.5 * G * dt; car.vel.z += (fz / l) * 0.5 * G * dt;
      car.air = Math.max(car.air, st.airBefore);
    }
    if (timers.fan > 0 && car.floorGap < 0.6) {
      // Body up, in the world: the extra suction pulls the car the other way.
      const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
      car.vel.x -= ux * G * dt; car.vel.y -= uy * G * dt; car.vel.z -= uz * G * dt;
    }
    if (timers.magnet > 0 && airborne(car)) {
      car.air = Math.max(car.air, st.airBefore);
      if (car.vel.y < 0) car.vel.y -= 3 * dt;
    }
    if (timers.shield > 0) {
      // Immunity: this tick's impact events never happened, and nothing folds further.
      car.impacts.count = Math.min(car.impacts.count, st.impBefore);
      if (st.crushSnap) for (let i = 0; i < car.crush.length; i++) { if (car.crush[i] > st.crushSnap[i]) car.crush[i] = st.crushSnap[i]; if (car.crushShown[i] > st.shownSnap[i]) car.crushShown[i] = st.shownSnap[i]; }
      if (car.damage) car.damage.seen = car.impacts.count;   // a damage sensor (src/sim/damage.js) skips them too
    }
    for (const id of POWERUP_IDS) if (timers[id] > 0) timers[id] = Math.max(0, timers[id] - dt);
  }

  return {
    grant, preStep, postStep,
    get timeScale() { return timers.slowmo > 0 ? 0.35 : 1; },
    // Active power-ups for the HUD: [{ id, left, frac }].
    active(out = []) {
      out.length = 0;
      for (const id of POWERUP_IDS) if (timers[id] > 0) out.push({ id, left: timers[id], frac: timers[id] / POWERUPS[id].s });
      return out;
    },
    isActive: (id) => timers[id] > 0,
    reset() { for (const id of POWERUP_IDS) timers[id] = 0; st.crushSnap = null; },
    timers,
  };
}
