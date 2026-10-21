// THE ROCKET as a machine, not a backdrop: its engines, propellant and mass, the static fire's
// thrust held down on the mount, the jet the flame trench throws out (which shoves a car parked in
// it), and an ascent integrator (Tsiolkovsky mass depletion, drag, gravity, the gravity turn) for the
// day it flies. Pure and deterministic like the rest of src/sim: + − × ÷ √ and dmath (dexp, dlog).
//
// Numbers are the vehicle class's (docs/ROCKET.md: a medium-lift, reusable, two-stage kerosene/LOX
// launcher with nine engines on its first stage). OFFICIAL = the class's published payload user's
// guides and press kits; REPORTED = encyclopedic summaries of the class; ESTIMATE = ours, with why.
// No names (AGENTS.md invariant 3.7).
import { dexp, dlog, dsin, dcos } from './dmath.js';

export const G0 = 9.80665;                 // standard gravity (Isp ↔ exhaust velocity)

export const ROCKET = {
  stage1: {
    engines: 9,                            // OFFICIAL: nine sea-level engines in a 3 × 3 octagonal mount
    thrustSL: 845e3,                       // N per engine at sea level, OFFICIAL (7,607 kN at liftoff)
    thrustVac: 914e3,                      // N per engine in vacuum, OFFICIAL (8,227 kN)
    ispVac: 311,                           // s, REPORTED (282 s at sea level, REPORTED)
    propellant: 395700,                    // kg of LOX + RP-1, REPORTED (summaries give 395–411 t)
    dry: 25600,                            // kg, REPORTED (with legs and grid fins)
    reserve: 0.1,                          // ESTIMATE: the share held back for the boost-back and landing burns
  },
  stage2: {
    engines: 1,                            // OFFICIAL: one vacuum engine
    thrustVac: 981e3,                      // N, OFFICIAL
    ispVac: 348,                           // s, REPORTED
    propellant: 92670,                     // kg, REPORTED
    dry: 3900,                             // kg, REPORTED
  },
  fairing: 1750,                           // kg, ESTIMATE (composite clamshell, 13 m × 5.2 m)
  payload: 15000,                          // kg, ESTIMATE: a typical low-orbit batch on a reusable flight
  // Aerodynamics: reference area the fairing's (5.2 m), drag coefficient against Mach for a slender
  // launcher (ESTIMATE: 0.3 subsonic, a transonic peak ≈ 0.55 near M 1.1, ≈ 0.3 by M 4; the shape of
  // the classic wind-tunnel curves for ogive-nosed cylinders).
  refArea: Math.PI * 2.6 * 2.6,
  cd: [[0, 0.30], [0.8, 0.32], [1.1, 0.55], [1.5, 0.48], [2.5, 0.36], [4, 0.30], [10, 0.28]],
  // The static fire (ESTIMATE): engines light in a fast stagger (the centre first, then the ring in
  // pairs a few tens of milliseconds apart, as test-stand recordings sound), each reaching full thrust
  // in 0.4 s, and all cut together, spooling down over 0.6 s.
  fire: { len: 7.5, stagger: 0.04, rampUp: 0.4, rampDown: 0.6 },
};
// Each engine's mass flow (kg/s): fixed by its vacuum thrust and Isp; at sea level the exit plane's
// back-pressure takes A_e·p₀ off the thrust (the same flow, so the effective sea-level Isp is ≈ 288 s
// against the 282 s reported: within the spread of published figures).
const S1 = ROCKET.stage1, S2 = ROCKET.stage2;
export const MDOT1 = S1.thrustVac / (S1.ispVac * G0);
export const MDOT2 = S2.thrustVac / (S2.ispVac * G0);
export const AEP0 = S1.thrustVac - S1.thrustSL;     // A_e·p₀ per first-stage engine, N
export const LIFTOFF_MASS = S1.dry + S1.propellant + S2.dry + S2.propellant + ROCKET.fairing + ROCKET.payload;

// --- Atmosphere (ESTIMATE: isothermal exponential, scale height 8.5 km; good to ≈10 % to 30 km) ---
export const RHO0 = 1.225, H_SCALE = 8500, R_EARTH = 6371e3;
export const pressureRatio = (h) => (h <= 0 ? 1 : dexp(-h / H_SCALE));
export const airDensity = (h) => RHO0 * pressureRatio(h);
export const soundSpeed = (h) => Math.max(295, 340.3 - 0.0039 * Math.max(0, h));
export function dragCoefficient(mach) {
  const t = ROCKET.cd;
  if (mach <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (mach <= t[i][0]) { const [m0, c0] = t[i - 1], [m1, c1] = t[i]; return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0); }
  return t[t.length - 1][1];
}

// --- The static fire ---------------------------------------------------------------------------------
// How lit engine i is (0–1) ft seconds after the fire's start.
function engineLevel(i, ft) {
  const F = ROCKET.fire, t0 = i * F.stagger;
  if (ft <= t0 || ft >= F.len) return 0;
  const up = (ft - t0) / F.rampUp, down = (F.len - ft) / F.rampDown;
  return Math.min(1, up, down);
}
// ∫₀^ft of engine i's level: its burn so far in full-thrust seconds (the ramps are linear).
function engineIntegral(i, ft) {
  const F = ROCKET.fire, t0 = i * F.stagger, a = t0 + F.rampUp, b = F.len - F.rampDown;
  if (ft <= t0) return 0;
  const t = Math.min(ft, F.len);
  let s = 0;
  s += t < a ? ((t - t0) * (t - t0)) / (2 * F.rampUp) : F.rampUp / 2;
  if (t > a) s += Math.min(t, b) - a;
  if (t > b) { const u = t - b; s += u - (u * u) / (2 * F.rampDown); }
  return s;
}
/**
 * The static fire ft seconds after ignition, on the mount at sea level, into `out`:
 * thrust (N), level (0–1, the share of full thrust), mdot (kg/s), burned (kg of propellant so far),
 * mass (kg, the vehicle now), weight (N), holdDown (N: what the clamps hold once thrust beats weight),
 * bearing (N: what the mount carries while weight beats thrust).
 */
export function staticFire(ft, out = {}) {
  const n = S1.engines;
  let level = 0, burn = 0;
  for (let i = 0; i < n; i++) { level += engineLevel(i, ft); burn += engineIntegral(i, ft); }
  out.level = level / n;
  out.thrust = level * S1.thrustSL;
  out.mdot = level * MDOT1;
  out.burned = burn * MDOT1;
  out.mass = LIFTOFF_MASS - out.burned;
  out.weight = out.mass * G0;
  out.holdDown = Math.max(0, out.thrust - out.weight);
  out.bearing = Math.max(0, out.weight - out.thrust);
  return out;
}

// When the range fires it, in run time (s): the first fire 20 s into a run, then every 40 s (a run
// lasts at most 90 s, so twice). A player who drives out to the pad from the stage gets there in
// time to see the first (it's ≈ 270 m). The title screen fires on its own clock (src/render/rocket.js).
export const FIRE_SCHEDULE = { first: 20, every: 40 };
/** Seconds into the current static fire at run time t, or −1 between fires. */
export function fireClock(t) {
  const F = FIRE_SCHEDULE;
  if (t < F.first) return -1;
  const k = Math.floor((t - F.first) / F.every), ft = t - F.first - k * F.every;
  return ft < ROCKET.fire.len ? ft : -1;
}

// --- The jet out of the flame trench -------------------------------------------------------------------
// The deflector turns the exhaust along the trench; what leaves the exit carries a share η of the
// engines' momentum (ESTIMATE η = 0.5: turning losses on the deflector and the momentum handed to the
// deluge water). Beyond the exit it behaves as a turbulent round jet: momentum flux J conserved, a
// Gaussian velocity profile U = U_c·exp(−(r/b)²) whose width grows linearly, b = 0.113·(x + x₀)
// (half-velocity spread rate 0.094: Pope, Turbulent Flows, 2000, §5.1; b = r½/√ln 2), with the
// virtual origin x₀ set so b is the trench's half-width at the exit. Then J = ρ·π·U_c²·b²/2. Far
// out it has mixed with the air: ambient density (ESTIMATE; near the exit the hot gas is lighter and
// faster at the same momentum flux, which the drag law below barely notices).
export const JET = { eta: 0.5, spread: 0.113, rho: 1.2, reach: 400, cutoff: 2.5 };
/**
 * The jet's velocity (m/s along its axis) at a point a metres downstream of the exit and r from the
 * axis, while the engines make `thrust` N. 0 outside its reach.
 */
export function jetSpeed(thrust, a, r2, halfWidth) {
  if (thrust <= 0 || a < 0 || a > JET.reach) return 0;
  const x0 = halfWidth / JET.spread, b = JET.spread * (a + x0), b2 = b * b;
  if (r2 > JET.cutoff * JET.cutoff * b2) return 0;
  const J = JET.eta * thrust;
  const uc = Math.sqrt((2 * J) / (JET.rho * Math.PI * b2));
  return uc * dexp(-r2 / b2);
}
// What the jet does to the roadster: drag on the air moving past it, F = ½·ρ·CdA·|u|·u with u the
// jet's velocity relative to the car's, and CdA its projection on the car's axes (ESTIMATE: 0.55 m²
// head-on, the car's own low-drag figure in spec.js; 4.2 m² broadside, Cd ≈ 1.0 on 85 % of length ×
// height, from crosswind tests of saloons at 90° yaw; 7.8 m² through the floor, a flat plate's 1.0
// on 90 % of length × width), at a centre of pressure 0.15 m above the CoM (it rolls the car away).
export const CAR_CDA = { front: 0.55, side: 4.2, floor: 7.8, cpUp: 0.15 };

// --- The ascent ------------------------------------------------------------------------------------------
// A point mass over a spherical Earth, in the plane of flight: downrange angle θ, altitude h, radial
// and horizontal velocities. Thrust along the commanded pitch, mass depleting at the engines' flow
// (Tsiolkovsky's rocket), drag against the air-relative velocity, inverse-square gravity, and the
// gravity turn: straight up to `kickSpeed`, a `kick`-degree pitch-over until the flight path has
// fallen that far from the vertical, then thrust along the velocity (zero angle of attack) and let
// gravity bend the path. RK4 at dt. Stage 1 burns to its landing reserve (MECO), separates, the
// second stage lights after `coast` seconds and burns to depletion (SECO), or stops at `tEnd`.
// Not run in any scored event; the renderer may fly the backdrop from it one day (docs/ROCKET.md).
export function ascend({ dt = 0.05, tEnd = 600, kickSpeed = 60, kick = 3.2, coast = 3, drag = true, gravity = true, vacuum = false, onSample = null } = {}) {
  const st = { t: 0, x: 0, h: 0, vx: 0, vh: 0, m: LIFTOFF_MASS, stage: 1, prop: S1.propellant * (1 - S1.reserve), phase: 'vertical', coastT: 0 };
  const ev = { maxQ: 0, maxQt: 0, maxQh: 0, mach1t: -1, meco: null, seco: null };
  const kickRad = (kick * Math.PI) / 180;
  // Derivatives at (h, vx, vh, m) with throttle on/off: [dx, dh, dvx, dvh, dm].
  const d = new Float64Array(5);
  function deriv(h, vx, vh, m, on) {
    const r = R_EARTH + h, v = Math.sqrt(vx * vx + vh * vh);
    let T = 0, mdot = 0;
    if (on && st.stage === 1) { const p = vacuum ? 0 : pressureRatio(h); T = S1.engines * (S1.thrustVac - AEP0 * p); mdot = S1.engines * MDOT1; }
    else if (on && st.stage === 2) { T = S2.thrustVac; mdot = MDOT2; }
    // Pitch: up, the kick, or along the velocity.
    let ux = 0, uh = 1;
    if (st.phase === 'kick') { ux = dsin(kickRad); uh = dcos(kickRad); }
    else if (st.phase === 'turn' && v > 1) { ux = vx / v; uh = vh / v; }
    let ax = (T * ux) / m, ah = (T * uh) / m;
    if (drag && !vacuum && v > 0) {
      const rho = airDensity(h), D = 0.5 * rho * v * v * dragCoefficient(v / soundSpeed(h)) * ROCKET.refArea;
      ax -= (D * vx) / (v * m); ah -= (D * vh) / (v * m);
    }
    if (gravity) { const g = (G0 * R_EARTH * R_EARTH) / (r * r); ah += -g + (vx * vx) / r; ax -= (vx * vh) / r; }
    d[0] = vx / r * R_EARTH; d[1] = vh; d[2] = ax; d[3] = ah; d[4] = -mdot;
    return d;
  }
  const k = [new Float64Array(5), new Float64Array(5), new Float64Array(5), new Float64Array(5)];
  let burning = true;
  while (st.t < tEnd) {
    // The step that empties a stage ends exactly at burnout (the mass flow is constant through it).
    let h = dt;
    const md = st.stage === 1 ? S1.engines * MDOT1 : MDOT2;
    if (burning && st.prop < md * dt) h = st.prop / md;
    const s0 = [st.x, st.h, st.vx, st.vh, st.m];
    const stepTo = (src, f, out) => { out.set(deriv(s0[1] + src[1] * f, s0[2] + src[2] * f, s0[3] + src[3] * f, s0[4] + src[4] * f, burning)); };
    k[0].set(deriv(s0[1], s0[2], s0[3], s0[4], burning));
    stepTo(k[0], h / 2, k[1]); stepTo(k[1], h / 2, k[2]); stepTo(k[2], h, k[3]);
    const inc = (i) => (h / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
    st.x += inc(0); st.h += inc(1); st.vx += inc(2); st.vh += inc(3); st.m += inc(4);
    if (burning) st.prop = h < dt ? 0 : st.prop - md * h;
    st.t += h;
    if (gravity && st.h < 0) { st.h = 0; st.vh = Math.max(0, st.vh); }
    const v = Math.sqrt(st.vx * st.vx + st.vh * st.vh);
    // The gravity turn's phases.
    if (st.phase === 'vertical' && v >= kickSpeed) st.phase = 'kick';
    else if (st.phase === 'kick' && st.vx >= st.vh * dsin(kickRad) / dcos(kickRad)) st.phase = 'turn';
    if (!vacuum) {
      const q = 0.5 * airDensity(st.h) * v * v;
      if (q > ev.maxQ) { ev.maxQ = q; ev.maxQt = st.t; ev.maxQh = st.h; }
      if (ev.mach1t < 0 && v >= soundSpeed(st.h)) ev.mach1t = st.t;
    }
    if (onSample) onSample(st);
    if (burning && st.prop <= 0) {
      if (st.stage === 1) {
        ev.meco = { t: st.t, h: st.h, v, x: st.x, m: st.m };
        // Separation: the first stage (dry + its reserve) falls away; the interstage stays with it.
        st.m -= S1.dry + S1.propellant * S1.reserve;
        st.stage = 2; st.prop = S2.propellant; burning = false; st.coastT = 0;
      } else { ev.seco = { t: st.t, h: st.h, v, x: st.x, m: st.m }; break; }
    } else if (!burning && st.stage === 2) {
      st.coastT += dt;
      if (st.coastT >= coast) burning = true;
    }
  }
  return { state: st, events: ev };
}

/** Tsiolkovsky's ideal Δv for an exhaust velocity and mass ratio (the check the integrator must meet). */
export const idealDeltaV = (isp, m0, m1) => isp * G0 * dlog(m0 / m1);
