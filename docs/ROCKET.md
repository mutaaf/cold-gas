# The launch complex

A reusable booster carrying a winged orbiter stands on its mount a few hundred metres beyond the
stage, floodlit, venting, with a fixed service tower, lightning masts and a water tank around it. It frames
the one moment (the Wall, the carry over the row, the title), built to read as a real vehicle at
real scale, and it is a physical place: drive out to it and it is solid where it is drawn, and its
engines are a machine whose static fire will throw your car off the pad (docs/OBJECTS.md).
Code: `src/sim/complex.js` (the geometry, shared by the physics and the drawing), `src/sim/rocket.js`
(the engines, the static fire, the jet, the ascent), `src/render/rocket.js` (the drawing, a lazy
chunk). The film look that came with it (atmosphere, wet slab) is `src/render/film.js`.

## IP (AGENTS.md invariant 3.7)

Inspired by the class, owned by nobody: no names, marks, wordmarks, flags or liveries of any
real vehicle, operator or agency, here or in code. Until 0292 the drawing was the generic
medium-lift silhouette (grid fins, folded legs, an ogive fairing, a lattice strongback); read
together that is one operator's look, so the drawing is now our own stack and our own tower
(render only: the sim's numbers and colliders below are unchanged).

- **The booster:** nine engines (three in the middle, six in the ring) hanging under an open, flared
  engine skirt; six short landing-leg pods round the skirt; a white tank (flight-proven soot)
  with a charcoal intertank band; a charcoal forward skirt carrying four swept steering vanes; a
  charcoal raceway on the tower side and a slim grey one opposite.
- **The interstage and transfer stage:** ribbed metal grey, then a short white stage whose collar
  carries the one signal-red hairline (the game's only accent colour).
- **The orbiter:** a winged stage-separation vehicle standing nose up on an eight-strut adapter: a
  flat-bellied lifting body with a double-delta wing (a steep strake into the main delta), one
  fin, a body flap, two aft pods and a central engine, lit cockpit windows, thruster ports, the
  crew hatch on the tower side, black heat-shield tiles under a white upper skin with its panel
  joints and bay-door line. Its back faces the floods and the stage.
- **The tower:** a fixed service tower on the sim's footprint: corner columns and a service level
  every 7.8 m (a deck slab with a lit edge), a clad back, sides clad on alternate levels (enclosed
  rooms with lit window bands) and K-braced open lattice elsewhere, a lift and stair core with lit
  shaft windows, stair flights on the open levels; three umbilical arms (horizontal trusses on the
  sim's clamp members, an umbilical plate at the booster), the service arm to the transfer stage
  (the sim's arm box) and an enclosed crew access arm ending in a white room at the orbiter's hatch;
  a hammerhead crane and a lightning mast on top.
- **The pad:** hold-down posts with jaws between the leg pods, a deluge ring on the deck and risers
  up the mount's columns, two tail service masts with umbilicals to the engine skirt, the
  deflector's steel plate flush in the trench floor.

Everything a car can reach (the first 12 m above the pad) stays inside the sim's colliders. The
orbiter's wings and fin reach past the old fairing's radius, 55 m up.

## Dimensions (metres)

Sources: the public payload user's guides and press kits of the current medium-lift reusable
class (2018–2025 editions), encyclopedic summaries of reusable first stages, and launch-site
environmental assessments for pad structures. Figures are the class's, rounded; where a part
varies between vehicles or isn't published, the value is marked ESTIMATE.

| Part | Value | Notes |
|---|---|---|
| Overall height | 70.0 | engine section to the orbiter's nose; the class sits at 68–71 m |
| Core diameter | 3.66 | set by road transport (≈ 3.7 m is the class's ceiling) |
| First stage (tanks + engine section) | 41.2 | |
| Interstage | 6.5 | ribbed, metal grey |
| Transfer stage, visible | 8.9 | white; the red hairline on its collar |
| Orbiter (drawn) | 12.3 long, 3.0 body width, ≈ 8.3 span | nose up on an eight-strut adapter 1.1 m above the collar (ESTIMATE: proportions of the class of small winged orbiters). The sim keeps the old fairing's numbers (5.2 diameter, 13.1 long) as its collider |
| Steering vanes | 0.95 span, 2.6 root chord | four, swept, on the booster's forward skirt (ESTIMATE) |
| Landing-leg pods | 5.9 long, ≈ 0.6 wide | six round the engine skirt (ESTIMATE) |
| Launch mount deck | 5.0 above the pad | the vehicle stands on hold-downs on a table of four columns; the flame trench runs beneath it, 9 m wide, and exits 48 m out on the side away from the stage (ESTIMATE) |
| Pad (hardstand) | 3.0 high, ≈ 66 radius | raised, with a sloped skirt to grade |
| Service tower | 82 high, 3.4 square | fixed, a service level every 7.8 m; umbilical arms at three heights; a service arm at the transfer stage; the crew access arm and white room at the orbiter's hatch; a hammerhead crane on top |
| Lightning masts | 104 high | three around the pad; class sites use 90–110 m catenary towers |
| Water tank | ≈ 54 to the top | sound-suppression deluge supply on four legs (ESTIMATE: height) |
| Flood masts | 26–32 high | plus two ground banks close in (ESTIMATE) |

## Where it stands, and why

- **Show / Wall**: 265 m to the −x side of the stage, facing it. Chosen by framing, not survey:
  the title's empty right third (the UI sits left, the curl centre), the side camera on the
  climb (it rises right of the curl), and the broadcast camera on the carry over the row (it
  stands behind the car, so the car rolls over a floodlit vehicle). At 265 m the vehicle is
  ≈ 15° tall from the title camera, about a quarter of the frame. A real spectator would be
  kilometres out; this is set dressing, so the scale is honest and the distance is a choice.
- **Lineup**: ≈ 580 m out toward the ridges where the range's old test stand stood, as the range's
  horizon landmark at blue hour.

## How it's lit (and why it's cheap)

One shader shades the whole structure from four flood banks passed as uniforms: inverse-square
falloff, a soft cone round each bank's aim plus a little spill, a wrap of night sky, a rim and a
small specular. A key from the front-left (a ground bank for the base, a mast for the upper
vehicle), a dimmer bank front-right, and a cool rim from behind on the right, so the tanks
read round. No three.js lights are added: the frame pays nothing per light and no other
material's program changes. Its own haze (by distance) replaces scene fog, so it stays legible
through the stage's dense night fog.

Draw calls: structure 1 (everything opaque merged), lattice 1, lamps 1, beacons 1, beams 1,
vapour 1, plus the static fire's glow (2 instances) while it burns. ≈ 6 draws. Triangles (0292): the
structure 9.9 k on the web (6.5 k before), the lattice 26; the iPhone's baked complex 22.4 k + 648
(21.1 k + 190 before; scripts/native-stage-page.js splits long triangles for its baked lighting).

## Anti-flicker

- Masts, the tower's columns, arms, struts and stairs, the crane and the tank legs carry `aSpread`
  (src/render/sliver.js): never under a pixel; the tower's lit deck edges spread vertically.
- Weld rings, the orbiter's panel joints and bay-door line, its tiles' gaps and shading, and the red
  hairline are drawn in the shader and fade by their own pixel footprint (fwidth), so far away
  they dim instead of sparkling.
- The lattice is a mipmapped alpha texture on open boxes: at range it averages to a steady grey
  rather than a moiré of sub-pixel members.
- Lamps and beacons are sliver blobs (≥ 1.5–2 px); beacons ramp on and off (≈ 40 a minute,
  synchronised, like obstruction lights).
- Vapour puffs are born and die at zero opacity; their whole life is a function of time (no
  per-frame CPU, nothing allocated).

## Moments

- **Power-up**: when the chunk arrives the floods come up over ≈ 2.5 s, then the working lights
  and beacons.
- **Venting**: boil-off from the upper-stage and booster vents and cold vapour rolling off the
  base, always (subtle).
- **Static fire**: on the title (never with `prefers-reduced-motion`) first after ≈ 26 s, then every
  100–160 s; in a run, on the sim's schedule (20 s in, then every 40 s), because there it is physics:
  its jet pushes a car parked in it. 7.5 s burn whose glow follows the engines' thrust as the sim
  integrates it: a glow under the mount and at the trench exit, the vehicle and pad lit orange from
  below, a steam cloud out of the trench that lingers ≈ 20 s. `stage.rocket.fire(t)` triggers one
  (screenshots).

## The machine (src/sim/rocket.js)

The class's first stage and its numbers (OFFICIAL: published payload user's guides and press kits;
REPORTED: encyclopedic summaries; ESTIMATE: ours):

| Quantity | Value | Source |
|---|---|---|
| First-stage engines | 9 | OFFICIAL |
| Thrust per engine, sea level / vacuum | 845 / 914 kN (7,607 / 8,227 kN for nine) | OFFICIAL |
| Isp, vacuum (sea level) | 311 s (282 s) | REPORTED |
| Mass flow per engine | 299.7 kg/s (vacuum thrust / Isp·g₀); sea-level thrust is A_e·p₀ less on the same flow | derived |
| First stage: propellant / dry | 395,700 / 25,600 kg; 10 % held back for landing | REPORTED / ESTIMATE |
| Second stage: engine, Isp, propellant / dry | 981 kN, 348 s, 92,670 / 3,900 kg | OFFICIAL / REPORTED |
| Fairing, payload | 1,750 kg, 15,000 kg | ESTIMATE |
| Liftoff mass (sum) | 534,620 kg; thrust-to-weight 1.45 | derived (the published gross mass, ≈ 549 t, carries more propellant) |
| Drag | reference area π·2.6², Cd 0.30 subsonic, 0.55 at Mach 1.1, 0.30 by Mach 4 | ESTIMATE (ogive-cylinder tunnel curves) |
| Atmosphere | ρ = 1.225·e^(−h/8.5 km), sound speed 340 → 295 m/s | ESTIMATE (isothermal) |

- **Static fire** (`staticFire(t)`): the engines light 40 ms apart and each ramps to full in 0.4 s,
  all cut together over 0.6 s (ESTIMATE). Thrust, mass flow, the propellant burned (the ramps'
  closed-form integral) and the vehicle's mass follow; the mount bears weight − thrust until thrust
  passes weight, then the hold-down clamps carry thrust − weight: 2.43 MN at full thrust, 3 s in.
- **The jet** (`jetSpeed`): the deflector turns the exhaust along the trench; the exit carries a share
  η = 0.5 of its momentum (ESTIMATE: deflector losses and the deluge water). Past the exit it is a
  turbulent round jet: momentum flux conserved (checked to 1 % by integration in the tests), a
  Gaussian profile of width b = 0.113·(x + x₀) (spread rate 0.094 per Pope, *Turbulent Flows*, §5.1),
  x₀ setting b to the trench's half-width at the exit. On the car: ½·ρ·CdA·|u|·u, u the air relative
  to the car, CdA 0.55 m² head-on, 4.2 broadside, 7.8 through the floor (ESTIMATE), at a centre of
  pressure 0.15 m above the CoM. 12 m down the jet that is ≈ 190 kN.
- **The ascent** (`ascend()`): a point mass over a spherical Earth, RK4 at 50 ms; thrust along the
  commanded pitch, mass falling at the engines' flow (the burnout step ends exactly at burnout, so
  without drag and gravity the integrated Δv equals Tsiolkovsky's to 1e-9), drag on the air-relative
  velocity, inverse-square gravity with the centrifugal and Coriolis-like terms, and the gravity turn:
  up to 60 m/s, a 3.2° kick, then thrust along the velocity. It gives Mach 1 at 47 s, max-Q 34 kPa at
  11.9 km and 62 s, MECO at 132 s, 73 km, 2.09 km/s, and SECO at 457 s, 6.9 km/s (the class: max-Q
  near 72 s and 11–13 km, MECO near 150–160 s and 65–70 km at about 2.1 km/s; ours has no throttle
  bucket and burns at full thrust throughout, so it gets there sooner). Not yet flown on screen.

## Loading

`src/render/scene.js` imports the chunk when the page is idle after the first frame, builds it
in ≈ 8 ms slices, compiles its shaders with `compileAsync` (hidden parts too), and only then adds
it. First-load bytes and the time to the first frame are unchanged (see the PR for
`scripts/perf.mjs` numbers). `stage.backdrop` resolves when it's in.
