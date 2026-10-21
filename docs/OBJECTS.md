# Objects: what everything you can see is, physically

Every object a player can see or touch, in every mode, and what it is to the physics: a **simulated
body** (a rigid body in the engine with its own mass, inertia and mechanics), a **static collider**
(solid, immovable), a **soft volume** (a drag on the car, no contact), or **pixels** (drawn only).
The rule (LESSONS: "A drawn thing the physics hasn't got is a ghost"): if a car can reach it, it is
solid where it is drawn, from the same numbers. Audited 2026-10-21 (branch `world/real-objects`).

## The table

| Mode | Object | Was | Now | Where the numbers live |
|---|---|---|---|---|
| All | The roadster | body (6-DOF, tyres, fan, ten nozzles; rigid hull) | unchanged | src/sim/spec.js, vehicle.js |
| Show, Lineup | The parked row (Sedan, Crossover, Semi, Pickup, Cab) | body: own mass, CoM, inertia, four (six) suspended parked tyres | unchanged; drawn **between ticks** now (interpolated, live and replay) | courses.js LINEUP_SPEC, docs/VEHICLES.md |
| Show, Wall | The Wall's deck (the curl) | static trimesh | unchanged | courses.js wallProfile |
| Show, Wall | The truss tower's chords, the posts under the curl | static boxes | unchanged | world.js wallSteel |
| Show, Wall | The two uplights at the foot of the curl | pixels | **static boxes** | courses.js FIXTURES |
| Show, Wall | Eight searchlight drums beside the curl | pixels (not drawn at all on `gfx=low`) | **static cylinders**, drawn on every tier (beams off on low) | courses.js FIXTURES |
| Lineup | Twelve floodlight poles along the run-up | pixels | **static cylinders** | courses.js FIXTURES |
| All stunts | Concrete slab, landing pad | static (the pad a paint material) | unchanged | courses.js |
| Show, Wall, Lineup | **The launch complex**: hardstand, launch mount (deck + four columns), the vehicle on its hold-downs, strongback with its arm, white room and clamp arms, three lightning masts, two flood masts, the water tank and its legs, three buildings, three tank-farm spheres | pixels | **static colliders** (≈ 33: hulls, boxes, cylinders, balls), streamed in only within 150 m of the pad | src/sim/complex.js |
| Show, Wall, Lineup | **The rocket's engines** | a cosmetic glow on the title | **mechanics**: a static fire integrated from the engines (thrust, mass flow, mass depletion, hold-down vs mount bearing), on the range's schedule in a run; its jet out of the flame trench shoves a car parked in it | src/sim/rocket.js, docs/ROCKET.md |
| Show, Wall, Lineup | Rocket ascent | none | an integrator (Tsiolkovsky, drag, gravity, gravity turn), tested, not yet flown on screen | src/sim/rocket.js `ascend` |
| All stunts | Vapour, steam, beams, beacons, lamps, sky, stars, horizon, skyline | pixels | pixels (gas, light and far scenery) | src/render/* |
| All | Cold-gas plumes and mist | pixels; the thrust is the sim's | unchanged | src/render/plumes.js |
| All | Crash sparks, chips, dust, dents | pixels keyed to the sim's impact events | unchanged | src/render/crash.js |
| All | Torn-off body parts | render-side rigid boxes on the floor (cosmetic) | unchanged, deliberately (see "Crash debris") | src/render/debris.js |
| Stunts | The ghost car | pixels (a recording) | unchanged | src/ghost.js |
| Free Drive, Endless | Ground, road, verges | static heightfield cells + the exact road for the tyres | unchanged (PR #54) | roads.js, world.js |
| Free Drive, Endless | Guard rails, stone walls, tunnel arches, bridge girders and piers | static | unchanged (PR #54) | roads.js, world.js |
| Free Drive, Endless | Tree trunks, boulders | static cylinders / hulls | unchanged (PR #54) | scenery.js |
| Free Drive, Endless | Shrubs, tree crowns | soft volumes | unchanged (PR #54) | scenery.js |
| Free Drive, Endless | Delineator posts, snow poles | pixels | pixels (deferred) | src/render/road.js |
| Free Drive, Sandbox | Build pieces: kicker, wedge, quarter, half-pipe, loop, wall block, landing mat, barge | static hull colliders (convex slices) | unchanged | src/build/objects.js |
| Free Drive, Sandbox | **Parked car** piece | a static box | **body**: the Lineup's sedan (1,705 kg, its inertia, four suspended parked tyres), scaled with the piece | src/sim/props.js `parkedBody` |
| Free Drive, Sandbox | **Cone** piece (new, key `[`) | — | **body**: 3.2 kg, CoM 0.12 m, rubber base + PVC cone hull, CCD | src/sim/props.js CONE |
| Free Drive, Sandbox | **Barrier** piece (new, key `]`) | — | **body**: 34 kg empty plastic safety-shape section, CCD | src/sim/props.js BARRIER |
| Free Drive, Sandbox | Rings, boost pads, crates, power-ups | sensors | unchanged (you pass through them) | src/build/catalogue.js |
| Sandbox | The apron, its four corner masts | static | unchanged | src/build/arena.js |
| Endless | World-API objects (ramps, boxes, loops) | static | unchanged | src/sim/objects.js |

## How each kind works

**Parked vehicles** were already full bodies: mass and CoM from their curb weights and axle loads,
inertia from measured class values, a raycast corner per wheel (ride 1.3 Hz cars / 1.8 Hz tractor,
ζ 0.3) and locked tyres at μ 0.8. What's new is that the Sandbox's parked car is one of them (it
was a static box), and that the renderer draws every body between ticks (src/render/interp.js
`createBodiesLerp`: the pose before the last tick is kept per body, and the frame draws the fraction
of the tick the clock has reached; the replay lerps between its 60 Hz frames). Momentum through a
hit is conserved to within 3 % over the three ticks a contact takes to resolve (the rest is the
parked tyres' friction): `tests/unit/objects.test.js`.

**Cones and barriers** are light rigid bodies (src/sim/props.js, sourced there). They start asleep
5 mm above the ground (a body placed touching the ground starts a contact, and a new contact wakes
it for two seconds), sweep with CCD (at 30 m/s a car moves 12 cm a tick and throws a 3 kg cone
faster than its own size per tick), and sleep again where they settle. Their pose lives in the
engine; the store keeps where each was placed, and the world keeps where a knocked one was left
when it streams out, so it is still knocked over when you come back.

**The launch complex** is built from one set of numbers (src/sim/complex.js) that the renderer
draws and the physics makes solid. Its ≈ 33 colliders are created in one tick the moment the car
comes within 150 m of the pad's centre, and dropped beyond 180 m. A run on the stage, 265 m away,
never meets them: the references replay to the same bits, and the server's replay pays one
distance check a tick. The car drives up the hardstand's 8.7° skirt onto the pad, under the mount's
deck (3.4 m of headroom over the flame trench, as at a real pad), and is stopped by the columns,
the strongback, the masts, the tank's legs and the buildings.

**The rocket's static fire** (src/sim/rocket.js, numbers in docs/ROCKET.md): nine engines light in a
40 ms stagger and reach full thrust in 0.4 s; thrust, mass flow (from vacuum thrust and Isp), the
propellant burned (the closed-form integral of the ramps) and so the vehicle's mass, and what holds
it: the mount bears weight minus thrust until thrust passes weight, then the hold-down clamps carry
thrust minus weight (2.4 MN at full thrust). The exhaust leaves the flame trench's exit as a
turbulent round jet: momentum flux η·T conserved as it spreads (b = 0.113·(x + x₀)), a Gaussian
profile; the car feels the drag of that air moving past it, ½·ρ·CdA·|u|·u with CdA its projection on
the car's axes and a centre of pressure above its CoM. 12 m down the jet that is ≈ 190 kN: the car is
thrown off the pad. In a run the range fires 20 s in and every 40 s after (the renderer shows that
same fire); the title keeps its own occasional fire.

**Crash debris** stays cosmetic, by decision: torn-off panels are render-side rigid boxes (mass,
inertia, corner contacts with restitution and friction, settling to rest and then not stepped). In a
scored run they would be in the server's replay (CPU it hasn't got: the Show replay is already
≈ 150 ms against a 10 ms budget, kept affordable by caches) and could change a score. Nothing in the
game depends on them, so they don't touch the sim.

## The budget

- **The scored replays** pay, per tick, one distance check for the complex and nothing else new
  while the car is on the stage; the references are bit-identical (Show 94, Wall 96, Lineup 92).
- **Loose props**: at most `PROP_CAP` (48) in the engine, the nearest; at most `PROP_BUILDS` (8)
  brought in a tick (a new body or one from the pool); asleep until something touches them; pooled
  per kind and scale when they stream out (no bodies are freed and remade on the way back).
- **CCD** only on the light props. The parked cars, the roadster and everything static don't sweep.
- **Collision groups**: props are `GROUP.parked` (the tyres' rays see them and drive over a knocked
  barrier); the complex and the fixtures are `GROUP.static`; the near-car ground copy stays
  `GROUP.approx`, which the tyres skip.
- **Render**: the props are instanced per kind (one draw call each), their matrices written from
  the bodies once a frame; nothing is allocated per frame.

`node scripts/objects-bench.mjs` (Node 25, M1 Max; median of 5 passes after a warm-up; quiet
machine, pass 1 of an interleaved A/B against the base branch):

| | before | after |
|---|---|---|
| Show reference, Worker verify path | 132.2 ms (0.038 ms/tick) | 137.0 ms (0.039) |
| Wall reference | 141.6 ms (0.033) | 145.7 ms (0.034) |
| Lineup reference | 61.7 ms (0.018) | 63.5 ms (0.019) |
| Lineup crash into the row | 61.0 ms (0.040) | 69.6 ms (0.046)* |
| Show: parked in the trench's jet through a static fire | — | 0.043 ms/tick, worst tick 0.89 ms (the complex built) |
| Sandbox: 6 parked cars floored through (static boxes before) | 0.030 ms/tick, worst 0.31 | — |
| Sandbox: 6 parked cars, 30 cones, 10 barriers floored through | — | 0.067 ms/tick, worst 2.8 ms** |

\* Within the run-to-run spread on this machine (the same script, six interleaved passes under load:
before 124–230 ms, after 91–139 ms). \*\* Before `PROP_BUILDS`; the first tick built all 40 props.
A 60 fps frame runs 4 ticks: the slalom costs 0.27 ms of a 16.7 ms frame on a laptop, ≈ 1.1 ms on a
4×-throttled phone. `tests/unit/objects.test.js` holds a ceiling ten times the measured cost.

## Deferred

- **A launch on screen.** `ascend()` integrates the whole flight (MECO ≈ 73 km at 2.1 km/s, max-Q
  34 kPa at 12 km), but the backdrop doesn't fly: the vehicle is merged into the complex's one draw
  call, and a launch needs its own mesh, a flame and a camera moment. The integrator is ready for it.
- **Launch debris and ignition overpressure.** The jet is the only thing the fire throws; ice and
  insulation shed at ignition, and the acoustic wave, are not modelled.
- **Delineator posts** along Free Drive's roads stay pixels: they are merged into the road chunks the
  terrain worker builds, so making them bodies needs per-post instances; they are flexible posts that
  a car flattens, the closest thing to a soft volume.
- **Crash debris as bodies** (above): cosmetic by design.
- **The scored courses' phase rules** read "on the Wall" as `z > 0.5 and y > 1.2`; a car driven up
  onto the 3 m pad trips them, and its run can end as a (low-scoring) landing.
- **`surface()`** (the exact geometry the HUD's altimeter and the debris floor read) doesn't know the
  complex: over the pad the altimeter reads 3 m high.
