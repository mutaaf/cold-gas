// The car, as specified. Sources: docs/REVEAL_RESEARCH.md (the Oct 15, 2026 reveal: Tesla's
// statements, the livestream's on-screen telemetry, and press measurements). Every number is
// tagged OFFICIAL (Tesla / exec statement), TELEMETRY (read off the livestream), or ESTIMATE (our
// engineering estimate, with the reasoning in the research doc). One source of truth for the sim
// AND the 3D model.
//
// Body frame: +x is the car's left, +y up, +z forward (right-handed), origin at the centre of mass.

export const SPEC = {
  // Geometry (m)
  length: 4.33,            // PHOTO: official side render (docs/REVEAL_RESEARCH.md §10). The official side render measures 4.33 m (PHOTO, research §10.8): pending a SIM_VERSION bump
  width: 2.0,              // OFFICIAL
  height: 1.15,            // ESTIMATE (not disclosed; PHOTO 1.14 m, research §10.1)
  wheelbase: 2.825,        // OFFICIAL (Moravy)
  trackFront: 1.70,        // ESTIMATE
  trackRear: 1.74,         // ESTIMATE
  overhangFront: 0.85,     // PHOTO (0.82–0.87); rear overhang ≈0.65 follows from length (PHOTO 0.82–0.87 m, §10.1)
  // Tyres: Pirelli P Zero Trofeo RS, 295/30 R20 front, 335/30 R21 rear (OFFICIAL sizes).
  wheelRadiusFront: 0.343, // 20" + 30% of 295 mm
  wheelRadiusRear: 0.367,  // 21" + 30% of 335 mm
  wheelRadius: 0.355,      // mean, for code that wants one number
  tyreWidthFront: 0.295,
  tyreWidthRear: 0.335,
  tyreMu: 1.25,            // OFFICIAL: Moravy, "typically 1.26 G" of tyre grip
  rideHeight: 0.10,        // ESTIMATE (fan car, runs low)
  // Centre of mass (docs/REVEAL_RESEARCH.md §11, component build-up: floor battery, both motors at
  // the rear axle, 200 L tank behind the seats, 400 L in the passenger seat): 42 : 58 front:rear.
  comHeight: 0.40,         // ESTIMATE (0.37–0.45)
  comFromFront: 1.62,      // ESTIMATE: CoM behind the FRONT axle, m (1.52–1.75)

  // Mass (kg). The base car is "just under 1,700 kg" (OFFICIAL). The single-seat Rocket trim adds
  // a 400 L tank, six thrusters and plumbing: ≈2,150 kg dry is our ESTIMATE for the stunt car.
  dryMass: 2150,
  // Nitrogen: 600 L of composite tanks at 69 MPa (10,000 psi) (OFFICIAL). Real-gas density of N2
  // at 690 bar and 20 °C is 0.495 kg/L (Z ≈ 1.60) → 297 kg (computed; Tesla said "about 250 kg").
  gasVolumeL: 600,
  gasPressureBar: 690,
  gasMass: 297,
  // Moments of inertia (kg·m²), ESTIMATE from the §11 build-up for the Rocket, gas full. The gas
  // sits near the CoM, so emptying the tanks (−12 % mass) moves inertia only ≈4 %: held fixed.
  inertia: { roll: 615, pitch: 2680, yaw: 3080 },

  // Powertrain: two rear motors, 1.0 MW (OFFICIAL), 1,400 N·m each (OFFICIAL) through an 8.4:1
  // reduction (OFFICIAL) → ≈11,800 N·m at each rear wheel.
  power: 1_000_000,
  maxWheelTorque: 11760,
  brakeTorque: 5200,       // per wheel, N·m (carbon-ceramic, ESTIMATE)

  // Suction: four 20 kW fans in the rear diffuser with four deployable skirts (OFFICIAL). Peak
  // downforce read 4,700 kg on the livestream (TELEMETRY: 46 kN; the "2 G" design claim is for a
  // lighter car). Force falls with the skirt gap as F = Fmax / (1 + (gap / 8 mm)²) (ESTIMATE).
  fanMaxForce: 46000,
  // Deployable skirts must seal across the curl's sag: on the 9.5 m arc the deck bows ≈0.11 m away
  // from the floor between the axles, so they reach ≈0.22 m (ESTIMATE, set by the geometry).
  fanSkirtReach: 0.22,
  fanGapScale: 0.008,      // m (ESTIMATE)
  fanSpool: 0.4,           // s (ESTIMATE)

  // Aero
  cdA: 0.55,               // m², low-drag mode (ESTIMATE)

  // Cold gas: nitrogen. Specific impulse ≈72 s at full pressure, falling as the tanks blow down
  // (≈60 s average) (ESTIMATE). Thrust follows tank pressure; pressure follows the gas left
  // adiabatically (p ∝ m^γ, γ ≈ 1.4 for N2).
  ispFull: 72,
  // A regulator holds the nozzle feed at line pressure until the tanks fall below it (the
  // livestream's in-car readout showed 5,500 psi against 10,000 psi tanks: TELEMETRY). Thrust and
  // Isp are full while regulated, then blow down with the tanks.
  regulatedFraction: 0.55,
};

// Axles in the body frame (+z forward, origin at the CoM).
export const AXLE_F = SPEC.comFromFront, AXLE_R = SPEC.comFromFront - SPEC.wheelbase;
const yUp = (h) => h - SPEC.comHeight;   // height above the ground → body y

// Ten thrusters (OFFICIAL count and grouping: 4 rear, 4 down "one per corner", 2 front yaw),
// placed from the axles so a CoM change moves nothing on the car. Per-nozzle thrust at full
// pressure: rear 80 kN total (OFFICIAL, "Mach diamonds" on the 0–60 run) → 20 kN each; down 20 kN
// each (the same rating; §11); yaw ≈4 kN each (ESTIMATE). `dir` is the force on the car.
export const NOZZLE_SPEC = [
  // Down: "behind each wheel" (OFFICIAL) at sill level, 0.18 m up: 0.47 m behind the front axle,
  // 0.53 m behind the rear (PHOTO, 04-World and the kickflip clip, §11).
  { id: 'down-fr', group: 'lift', pos: [-0.75, yUp(0.18), AXLE_F - 0.47], dir: [0, 1, 0], max: 20000 },
  { id: 'down-fl', group: 'lift', pos: [0.75, yUp(0.18), AXLE_F - 0.47], dir: [0, 1, 0], max: 20000 },
  { id: 'down-rr', group: 'lift', pos: [-0.75, yUp(0.18), AXLE_R - 0.53], dir: [0, 1, 0], max: 20000 },
  { id: 'down-rl', group: 'lift', pos: [0.75, yUp(0.18), AXLE_R - 0.53], dir: [0, 1, 0], max: 20000 },
  // Rear: one row along the top of the diffuser, centres 0.42 m up, 0.26 m apart (PHOTO, §10.3),
  // at the tail (rear overhang ≈0.65 m).
  { id: 'rear-1', group: 'rear', pos: [-0.39, yUp(0.42), AXLE_R - 0.63], dir: [0, 0, 1], max: 20000 },
  { id: 'rear-2', group: 'rear', pos: [-0.13, yUp(0.42), AXLE_R - 0.64], dir: [0, 0, 1], max: 20000 },
  { id: 'rear-3', group: 'rear', pos: [0.13, yUp(0.42), AXLE_R - 0.64], dir: [0, 0, 1], max: 20000 },
  { id: 'rear-4', group: 'rear', pos: [0.39, yUp(0.42), AXLE_R - 0.63], dir: [0, 0, 1], max: 20000 },
  // Yaw: "on each front fender" (REPORTED), ≈0.6 m ahead of the front axle.
  { id: 'yaw-r', group: 'yaw', pos: [-0.86, yUp(0.37), AXLE_F + 0.6], dir: [1, 0, 0], max: 4000 },
  { id: 'yaw-l', group: 'yaw', pos: [0.86, yUp(0.37), AXLE_F + 0.6], dir: [-1, 0, 0], max: 4000 },
];

export const wheelRadiusOf = (i) => (i < 2 ? SPEC.wheelRadiusFront : SPEC.wheelRadiusRear);

// Wheel anchors (body frame, at the suspension's top mount, 0.24 m above the wheel centre at rest).
export function wheelAnchors() {
  const zf = AXLE_F, zr = AXLE_R;
  const yf = SPEC.wheelRadiusFront - SPEC.comHeight + 0.24, yr = SPEC.wheelRadiusRear - SPEC.comHeight + 0.24;
  return [
    [-SPEC.trackFront / 2, yf, zf], [SPEC.trackFront / 2, yf, zf],
    [-SPEC.trackRear / 2, yr, zr], [SPEC.trackRear / 2, yr, zr],
  ];
}
