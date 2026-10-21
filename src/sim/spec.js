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
  // The CAR's grip on its tyres alone: Moravy, "typically 1.26 G" (OFFICIAL). It is a car-level
  // number (load transfer included), so the flight computer, the rack and the fan schedule plan
  // with it; the tyre's own peak μ at its nominal load is tyreMu0, below.
  tyreMu: 1.25,            // OFFICIAL (car, steady corner)
  // Load sensitivity (ticket 0021), Magic Formula 5.2 form (Pacejka, Tyre and Vehicle Dynamics,
  // ch. 4): with dfz = Fz/Fz0 − 1 (Fz0 = the tyre's static load on its axle),
  //   μ(Fz) = tyreMu0 · (1 + tyreLoadSens · dfz)                         (PDY1 + PDY2·dfz)
  //   Kα(Fz) ∝ sin(2·atan(Fz / (tyreKyLoad · Fz0)))                      (PKY1, PKY2)
  // Published fit: Cabrera et al., "A Procedure for Determining Tire-Road Friction Characteristics
  // Using a Modification of the Magic Formula Based on Experimental Results", Sensors 18(3) 2018,
  // Table 2, 205/65 R15: PDY1 0.932775, PDY2 −0.128085, PKY1 −17.36, PKY2 2.293896. No fit of the
  // 295/30 R20 / 335/30 R21 semi-slick is public, so the RELATIVE shape is carried over (ESTIMATE):
  // μ falls 13.7 % per unit of normalised load, and cornering stiffness peaks at 2.29 × Fz0.
  // The stiffness at Fz0 stays the track tyre's own (B·C ≈ 21.6, vehicle.js).
  tyreLoadSens: -0.128085 / 0.932775,   // ESTIMATE: PDY2 / PDY1 (Cabrera 2018, Table 2) = −0.137
  tyreKyLoad: 2.293896,                 // ESTIMATE: PKY2 (Cabrera 2018, Table 2)
  // Peak μ at nominal load: ESTIMATE, the one number fitted here. Chosen so the car, through this
  // load sensitivity and its own load transfer, corners at the OFFICIAL 1.2x g on tyres alone
  // (physics-bench steady corner); semi-slicks on dry concrete carry 1.3–1.5.
  tyreMu0: 1.40,
  // Relaxation length σ (m): a tyre's side force builds up over σ metres of rolling after a slip
  // angle step, not at once (Pacejka, Tyre and Vehicle Dynamics, ch. 7 "transient behaviour";
  // https://en.wikipedia.org/wiki/Tire_model). ESTIMATE for 295/30 R20 and 335/30 R21 low-profile
  // track tyres at static load: stiff short sidewalls sit at the low end of the 0.2–0.5 m range.
  // σ grows roughly with √(load) (vehicle.js); the wider, more loaded rear carries the longer one.
  tyreRelaxFront: 0.35,    // ESTIMATE
  tyreRelaxRear: 0.40,     // ESTIMATE
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
  // Steering: a steer-by-wire rack (the yoke's ratio is variable, research §3.5). Road-wheel lock
  // ESTIMATE 0.5 rad (28.6°; cars this size lock the inner wheel at ≈0.5–0.65 rad), which turns the
  // car on a 6.2 m radius at a crawl. Slew rate ESTIMATE 2.2 rad/s at the road wheels (an electric
  // rack moves ≈0.1–0.2 m/s on a ≈65 mm steering arm: 1.5–3 rad/s).
  steerLock: 0.5,
  steerRate: 2.2,
  // Stability control (Assist only; Pro and Advanced drive without it). Production systems act on
  // a few degrees of sideslip or a yaw rate past what the tyres can hold, by braking single wheels
  // and trimming drive torque (Bosch ESP; van Zanten, SAE 2000-01-1633). ESTIMATE: 4° of slip at
  // the rear axle (this car holds 3.7° there cornering flat out at 1.13 g), 4 % over the
  // grip-limited yaw rate.
  escSlip: 0.07,           // rad
  escYaw: 1.04,            // × μg/v

  // Suction: four 20 kW fans in the rear diffuser with four deployable skirts (OFFICIAL). Peak
  // downforce read 4,700 kg on the livestream (TELEMETRY: 46 kN; the "2 G" design claim is for a
  // lighter car). Force falls with the skirt gap as F = Fmax / (1 + (gap / 8 mm)²) (ESTIMATE).
  fanMaxForce: 46000,
  // Deployable skirts must seal across the curl's sag: on the 9.5 m arc the deck bows ≈0.11 m away
  // from the floor between the axles, so they reach ≈0.22 m (ESTIMATE, set by the geometry).
  fanSkirtReach: 0.22,
  fanGapScale: 0.008,      // m (ESTIMATE)
  // The suction is scheduled, not pinned at max. The livestream DOWNFORCE channel (TELEMETRY,
  // docs/REVEAL_RESEARCH.md §2.1.2) climbs with pitch: 79–186 kgf rolling on the pad, 434 at 25°,
  // 825 at 50°, 1,544 at 75°, ≈3,300 at 90°, 4,510 at 127°, 4,700 at 170°. The controller asks for
  // (ESTIMATE, the law fitted to that table):
  //   N_fan = m·g·(fanGrip·sinθ/μ + fanContact·(1 − cosθ) + fanHang·max(0, −cosθ))
  // within [fanIdleForce, fanMaxForce]. θ is the deck's tilt from level (the floor's surface
  // normal against world up), μ = tyreMu. sinθ/μ is the friction gravity along the deck needs;
  // (1 − cosθ) replaces the weight the tilted deck no longer carries, plus a margin; past vertical
  // the whole hanging weight (−cosθ) is the fan's too. On the vertical wall that is 1.18 g of
  // suction against the 0.8 g friction needs (1.5× margin); hanging inverted on the ledge it hits
  // the cap. Fitted with the spool lag below: the reference Wall climb reads −26 %, +24 %, +23 %,
  // −26 %, −5 %, −1 % against the six telemetry rows (tests/unit/fan.test.js holds it to ±30 %).
  fanGrip: 0.6,            // ESTIMATE (fitted)
  fanContact: 0.7,         // ESTIMATE (fitted)
  fanHang: 1,              // physics: inverted, the deck carries none of the weight
  // Below ≈50 mph aero is ineffective and "the fans fill that void" (OFFICIAL, Moravy, Hagerty):
  // held full throttle, or a full stop on the move, asks for up to the cap (filtered over
  // fanGripTime, past half of it, so a crawl's throttle blips don't count).
  fanGripTime: 0.25,       // s (ESTIMATE)
  fanVoidSpeed: 22,        // m/s ≈ 50 mph: above it the aero carries the load (OFFICIAL, Moravy)
  fanIdleForce: 1300,      // N ≈ 130 kgf (TELEMETRY: 79–186 kgf rolling on the pad)
  // Spool: 1.5 s to 90 % of the demand (REPORTED telemetry, §6 row 21: 79 → 434 kgf over 3 s
  // rolling; range 1–3 s), a first-order lag τ = 1.5 / ln 10. The demand itself is held: it
  // decays only slowly once the attitude asks for less (TELEMETRY: on run 1's way back down it
  // stays at 4,691 kgf to 86° and is still 1,412 kgf back on the pad 5 s later, τ ≈ 4 s).
  // Disarming (the release) unseals the skirts: suction dumps in fanDump.
  fanSpool: 1.5,           // s to 90 % (REPORTED)
  fanHold: 4,              // s, demand decay time constant (TELEMETRY, run 1 descent)
  fanDump: 0.4,            // s, skirts unseal on release (ESTIMATE)

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
// pressure: rear 80 kN total (OFFICIAL, "Mach diamonds" on the 0–60 run) → 20 kN each; yaw ≈4 kN
// each (ESTIMATE). Down: 23 kN front, 16 kN rear (ESTIMATE, docs/REVEAL_RESEARCH.md §11.5 (b)). The
// livestream's 3.3 G braking peak (TELEMETRY, §2.1.4) is thrust over mass; equal 20 kN jets "behind
// each wheel" make only 66.5 kN of pitch-free lift (2.8 G at 2,447 kg) because the rears sit 1.5×
// farther from the CoM. Front jets ≈1.5× the rears' throat area are the natural design answer: 78 kN
// rated (the rear row's class), 76.5 kN pitch-free, 3.2 G full. `dir` is the force on the car.
export const NOZZLE_SPEC = [
  // Down: "behind each wheel" (OFFICIAL) at sill level, 0.18 m up: 0.47 m behind the front axle,
  // 0.53 m behind the rear (PHOTO, 04-World and the kickflip clip, §11).
  { id: 'down-fr', group: 'lift', pos: [-0.75, yUp(0.18), AXLE_F - 0.47], dir: [0, 1, 0], max: 23000 },
  { id: 'down-fl', group: 'lift', pos: [0.75, yUp(0.18), AXLE_F - 0.47], dir: [0, 1, 0], max: 23000 },
  { id: 'down-rr', group: 'lift', pos: [-0.75, yUp(0.18), AXLE_R - 0.53], dir: [0, 1, 0], max: 16000 },
  { id: 'down-rl', group: 'lift', pos: [0.75, yUp(0.18), AXLE_R - 0.53], dir: [0, 1, 0], max: 16000 },
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
