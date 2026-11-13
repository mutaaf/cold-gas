// A car wedged against something it can't push through (0229): nose into a lamp post, a set light's
// drum, a tree, a rail, a bank. The scored sim has no end for it (a run in its 'drive' phase that stops
// dead against a fixture sits there until MAX_TICKS, 90 s: the HUD looks frozen and nothing the player
// does helps), and Free Drive's own watchdog only catches a car off its wheels. This reads the car the
// sim hands back and says when it is stuck; the app decides what to do about it (a scored run goes again
// from the mark, Free Drive puts the car back on the road). Nothing here touches the sim, the input log
// or a score. Pure: no DOM, no clock.
//
// Stuck is "going nowhere while the body touches something": the car stays within WEDGE_R of where it
// was, its hull touched something in that time, and the pedal was down for WEDGE_PUSH s (or, where an
// idle limit is given, that long in all). Distance, not speed: pinned in a bank, the engine jitters a car
// at 0.1–0.7 m/s without it moving a centimetre.
//
//   const w = createWedge({ idle: 4 });   // idle: s with no pedal before it counts (default: never)
//   w.update(dt, car, demand)             true once stuck (demand: the pedal, 0..1)
//   w.reset()
export const WEDGE_R = 0.6;        // m: closer than this to where it was is "not getting anywhere"
export const WEDGE_PUSH = 1.2;     // s stuck with the pedal down: it can't get out
export const WEDGE_IDLE = 4;       // s stuck in all (pedal or not), where the app gives an idle limit

const finite = (c) => Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z + c.quat.x + c.quat.y + c.quat.z + c.quat.w + c.angVel.x + c.angVel.y + c.angVel.z);
/** Is every number the engine is fed finite? (A NaN reaching the engine can panic its WASM.) */
export const carFinite = (c) => !!c && finite(c);

export function createWedge({ idle = Infinity } = {}) {
  const s = { push: 0, all: 0, touched: false, x: NaN, y: NaN, z: NaN };
  const anchor = (c) => { s.x = c.pos.x; s.y = c.pos.y; s.z = c.pos.z; s.push = 0; s.all = 0; s.touched = !!c.hullContact; };
  return {
    get t() { return s.push; },
    reset() { s.push = 0; s.all = 0; s.touched = false; s.x = NaN; },
    update(dt, c, demand = 0) {
      if (!c) return false;
      const dx = c.pos.x - s.x, dy = c.pos.y - s.y, dz = c.pos.z - s.z;
      if (!(dx * dx + dy * dy + dz * dz < WEDGE_R * WEDGE_R)) { anchor(c); return false; }
      if (c.hullContact) s.touched = true;
      s.all += dt;
      if (demand > 0.2) s.push += dt;
      return s.touched && (s.push > WEDGE_PUSH || s.all > idle);
    },
  };
}
