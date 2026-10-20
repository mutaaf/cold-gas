// The car, as specified. Public numbers from the October 2026 reveal where they exist
// (wheelbase, width, power, 0–60, thruster count, gas volume and pressure); engineering
// estimates where they don't, each marked. One source of truth for the sim AND the model.
//
// Body frame: +x right, +y up, +z forward, origin at the centre of mass.

export const SPEC = {
  // Geometry (m)
  length: 4.62,            // est. from the 2,825 mm wheelbase and the reveal's proportions
  width: 2.0,              // public: ~2,000 mm
  height: 1.12,            // est.
  wheelbase: 2.825,        // public: 2,825 mm
  trackFront: 1.70,        // est.
  trackRear: 1.74,         // est.
  overhangFront: 0.86,     // est.: front axle to nose
  wheelRadius: 0.36,       // 22" rim with a 30-profile tyre ≈ 720 mm diameter
  tyreWidthFront: 0.285,
  tyreWidthRear: 0.335,
  rideHeight: 0.11,        // floor to ground at rest (fan cars run low)
  comHeight: 0.43,         // centre of mass above ground at rest (battery in the floor)
  comFromFront: 1.42,      // CoM behind the front axle (≈50:50 with the rear tank)

  // Mass (kg). A target of under 1,700 kg was announced for the base car; the single-seat
  // Rocket trim adds a 400 L tank and six more thrusters. Estimate: 1,640 kg dry.
  dryMass: 1640,
  // Nitrogen: 600 L of composite-overwrapped pressure vessels at ~690 bar (public).
  // Real-gas density of N2 at 690 bar, 300 K ≈ 0.47 kg/L (Z ≈ 1.6) → ≈ 280 kg.
  gasVolumeL: 600,
  gasPressureBar: 690,
  gasMass: 280,
  // Moments of inertia about the CoM (kg·m²) for the dry car, from a mass-distribution
  // estimate (battery slab, two rear motors, tanks behind the seat); scaled with mass.
  inertia: { pitch: 2650, yaw: 2950, roll: 640 },

  // Powertrain: two rear motors, torque-vectoring, 1,000 kW (public: >1,341 hp).
  power: 1_000_000,
  maxWheelTorque: 6200,    // per rear wheel, N·m (est.)
  brakeTorque: 4200,       // per wheel, N·m (carbon-ceramic, est.)
  tyreMu: 1.45,            // semi-slick peak friction (est.)

  // Suction fan: "can pull up to two Gs" (public, Lars Moravy). Modelled as a force toward
  // the surface under the floor, fading with gap, with a spool-up time.
  fanMaxG: 2.0,
  fanSpool: 0.35,          // s, est.
  fanGapFull: 0.16,        // m: full suction at or below this floor gap (est.)
  fanGapZero: 0.55,        // m: no suction above this gap (est.)

  // Aero
  cdA: 0.62,               // m² (Cd ≈ 0.27 × 2.3 m² frontal), est.

  // Cold gas: nitrogen, Isp ≈ 70 s at sea level for a simple converging-diverging nozzle (est.).
  isp: 70,
};

// Ten thrusters (public: 4 rear on the Thrust trim, 6 more at the front and sides on Rocket).
// Placement here is our engineering reading of the reveal footage: 4 rear in the diffuser
// (the four round nozzles visible at the back), 2 front retro, 4 underbody lift jets.
// `dir` is the force direction on the car (opposite to the jet). `max` in newtons at full tank.
export const NOZZLE_SPEC = [
  // Lift jets sit under the sills between the wheels (outboard of the battery, clear of the tyres).
  { id: 'lift-fl', group: 'lift', pos: [-0.62, -0.3, 0.9], dir: [0, 1, 0], max: 10200 },
  { id: 'lift-fr', group: 'lift', pos: [0.62, -0.3, 0.9], dir: [0, 1, 0], max: 10200 },
  { id: 'lift-rl', group: 'lift', pos: [-0.62, -0.3, -0.9], dir: [0, 1, 0], max: 10200 },
  { id: 'lift-rr', group: 'lift', pos: [0.62, -0.3, -0.9], dir: [0, 1, 0], max: 10200 },
  { id: 'rear-1', group: 'rear', pos: [-0.5, -0.2, -2.28], dir: [0, 0, 1], max: 3300 },
  { id: 'rear-2', group: 'rear', pos: [-0.18, -0.2, -2.3], dir: [0, 0, 1], max: 3300 },
  { id: 'rear-3', group: 'rear', pos: [0.18, -0.2, -2.3], dir: [0, 0, 1], max: 3300 },
  { id: 'rear-4', group: 'rear', pos: [0.5, -0.2, -2.28], dir: [0, 0, 1], max: 3300 },
  { id: 'front-l', group: 'front', pos: [-0.62, -0.18, 2.22], dir: [0, 0, -1], max: 5200 },
  { id: 'front-r', group: 'front', pos: [0.62, -0.18, 2.22], dir: [0, 0, -1], max: 5200 },
];

// Derived wheel anchors (body frame, at the suspension's top mount).
export function wheelAnchors() {
  const zf = SPEC.wheelbase - SPEC.comFromFront, zr = -SPEC.comFromFront;
  const y = SPEC.wheelRadius - SPEC.comHeight + 0.24; // top mount ≈ 0.24 m above the wheel centre at rest
  return [
    [-SPEC.trackFront / 2, y, zf], [SPEC.trackFront / 2, y, zf],
    [-SPEC.trackRear / 2, y, zr], [SPEC.trackRear / 2, y, zr],
  ];
}
