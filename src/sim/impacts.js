// Impact events: what the physics hit, where, how hard. Written by vehicle.step (pure,
// deterministic, part of the sim) and read by the renderer, the camera and the sound, live and in
// the replay (events carry the tick they happened on, so the replay re-shows the crash from the
// same record). Fixed-capacity typed arrays, allocated once per run: no allocation per tick.
//
// Kinds:
//   HIT     a hull probe (sill, nose, tail, shoulder, roof) arrives at a surface; `speed` is the
//           closing speed along the normal (m/s), `crush` the probe's permanent crush after it (m)
//   SCRAPE  a hull probe sliding along a surface; `speed` is the sliding speed (m/s); sampled at
//           most every SCRAPE_EVERY ticks so a long slide costs a few events per second
//   WHEEL   a tyre slamming down; `speed` is the contact patch's closing speed (m/s)
//   CRUSH   a probe's bodywork folded a further CRUSH_STEP (or more); `crush` is its new
//           permanent depth (m), `probe` which one: the renderer dents the body to match
// `body` is the parked vehicle's index in the run's world (−1: the ground or the Wall's deck).
export const HIT = 0, SCRAPE = 1, WHEEL = 2, CRUSH = 3;
export const KIND_NAMES = ['hit', 'scrape', 'wheel', 'crush'];
export const IMPACT_CAP = 768;
export const SCRAPE_EVERY = 8;          // ticks (30 Hz)
export const HIT_MIN = 1.0;             // m/s closing speed: below it a touch is a touch
export const SCRAPE_MIN = 2.0;          // m/s sliding
export const WHEEL_MIN = 3.0;           // m/s: a tyre arriving faster than a hard landing's sink
export const CRUSH_STEP = 0.03;         // m of further fold between CRUSH reports

// Which part of the body a hull probe is (vehicle.js HULL order), so a crash knows what broke.
export const PART = { floor: 0, nose: 1, tail: 2, side: 3, roof: 4, wheel: 5 };
export const PART_NAMES = ['floor', 'nose', 'tail', 'side', 'roof', 'wheel'];

export function createImpacts(cap = IMPACT_CAP) {
  return {
    count: 0, cap, lastScrape: -1e9,
    tick: new Int32Array(cap), kind: new Uint8Array(cap), part: new Uint8Array(cap), probe: new Uint8Array(cap), body: new Int8Array(cap),
    x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap),
    nx: new Float32Array(cap), ny: new Float32Array(cap), nz: new Float32Array(cap),
    speed: new Float32Array(cap), crush: new Float32Array(cap),
  };
}

// Record one event (dropped once the buffer is full: the first 768 are the crash).
export function pushImpact(b, tick, kind, part, probe, body, x, y, z, nx, ny, nz, speed, crush) {
  if (b.count >= b.cap) return;
  const i = b.count++;
  b.tick[i] = tick; b.kind[i] = kind; b.part[i] = part; b.probe[i] = probe; b.body[i] = body;
  b.x[i] = x; b.y[i] = y; b.z[i] = z; b.nx[i] = nx; b.ny[i] = ny; b.nz[i] = nz;
  b.speed[i] = speed; b.crush[i] = crush;
}
