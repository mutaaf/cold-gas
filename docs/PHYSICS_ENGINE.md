# The physics engine

COLD GAS runs its rigid-body dynamics, collisions and contacts on **Rapier**
(<https://rapier.rs>, Apache-2.0, by Dimforge), the cross-platform-deterministic build
`@dimforge/rapier3d-deterministic@0.21.0`. This file says why, how we proved it is
deterministic everywhere the game runs, what moved into the engine, and what stayed ours.

## Requirements

1. **Bit-exact determinism** across Chromium, WebKit (Safari), Firefox, Node and the Cloudflare
   Worker. The Worker replays every submitted input log to verify the score (AGENTS.md §3.4–3.5);
   a one-ulp difference grows into a different score in a chaotic stunt.
2. **240 Hz on a phone**, with rendering in the same frame.
3. **The geometry we have**: a curved Wall the car drives up and hangs under (held there by our
   fan force), flat concrete, Free Drive's kilometres of real road, and parked vehicles as full 3D
   rigid bodies with their own mass, inertia, suspension and materials.
4. **Permissive licence** (the repo is public).
5. **Maintained.**
6. Fits the Worker: the free plan allows 3 MB (gzip) per Worker.

## The candidates (evidence gathered 2026-10-20)

| Engine (npm) | Licence | Last release | Size (gzip) | Deterministic across hosts? | Verdict |
|---|---|---|---|---|---|
| **Rapier** `@dimforge/rapier3d-deterministic` 0.21.0 | Apache-2.0 | 2026-09-25 | WASM 1,172 KB + JS 38 KB | **Yes, by design**: built with Rapier's `enhanced-determinism` feature (IEEE-754 strict, no SIMD, its own `libm` for every transcendental). The WASM imports no `Math` function from JS (its 29 imports are wasm-bindgen glue and `performance.now`, used only by the optional profiler). **Measured identical** below. | **Chosen** |
| Jolt `jolt-physics` 1.1.0 | MIT | 2026-07-11 | WASM 741 KB | Probably in practice (one WASM binary, no JS `Math` imports), but the npm build is **not** compiled with `CROSS_PLATFORM_DETERMINISTIC=ON` (opt-in per its README), so Jolt makes no promise for it. The emscripten API needs manual `destroy()` of every object. | Strong runner-up |
| PhysX `physx-js-webidl` 2.8.0 | MIT (bindings), BSD-3 (PhysX) | 2026-09-27 | WASM 1,612 KB + a 4.8 MB JS glue file | Enhanced-determinism is a scene flag, not a build guarantee; heavy glue; tight against the Worker's 3 MB | Too heavy |
| Bullet `ammo.js` 0.0.10 | zlib | 2022-06 | — | Unmaintained since 2022 | Rejected |
| cannon-es 0.20.0 | MIT | 2022-08 | 0.2 MB JS | Pure JS: 31 calls to `Math.sin/cos/atan2/…` whose last bit differs between engines (LESSONS: "Engines disagree on transcendental functions"). Unmaintained since 2022 | Rejected |
| Oimo `oimophysics` 1.2.2 | MIT | 2024-03 | 0.4 MB JS | Pure JS: 114 transcendental `Math` calls; dormant | Rejected |

Rapier wins on the requirement that matters most: it ships a build whose *purpose* is
cross-platform bit-exactness, with an ergonomic, garbage-collected JS API. The price is the
bigger download (1.2 MB gzip), lazy-loaded after the title paints.

## Determinism: the proof

Two layers, both checked in:

- **Engine spike** (`scripts/engine-spike.js`): a chaotic scene of the engine alone (a curved
  trimesh ramp, a floor, six stacked boxes, a car-like box on raycast springs with scripted thrust,
  2,400 steps at 240 Hz), hashed (FNV-1a over every body's pose and velocity bits).
  `node scripts/engine-determinism.mjs` runs it in Node, Chromium, Firefox and WebKit;
  `scripts/engine-worker/` runs it in workerd (`npx wrangler dev`).
- **The game itself**: `node scripts/engine-logs.mjs <dir>` writes input logs (a clean reference,
  an Advanced valve run, and crashes that wake the parked bodies, shove them into each other and
  roll the car); `node scripts/determinism.mjs <dir>/crash.json` replays them in Node, Chromium
  and WebKit; `node scripts/engine-worker/check.mjs <dir>/crash.json` replays them in workerd.
  Compared: the car's position, attitude and gas, **and every parked body's pose**, bit for bit.

Results (macOS 27, Node 25, Playwright Chromium/WebKit, wrangler 4.151 / workerd):

| | Node | Chromium | WebKit | workerd | Firefox |
|---|---|---|---|---|---|
| engine spike | `0ddfc5d3` | `0ddfc5d3` | `0ddfc5d3` | `0ddfc5d3` | not run* |
| clean logs (Show Advanced 100, Wall 93.7, Lineup 86.7) | reference | IDENTICAL | IDENTICAL | IDENTICAL | not run* |
| crash logs (Show 35, Wall 60, Lineup 28) | reference | IDENTICAL | IDENTICAL | IDENTICAL | not run* |

\* Playwright's Firefox (Nightly) fails to launch on this machine's macOS beta ("Could not find
profile folder"); it is skipped here as it was before. SpiderMonkey runs the same WASM under the
same IEEE-754 semantics; run `scripts/engine-determinism.mjs` on a machine where it launches.

## How it is wired

- `src/vendor/rapier3d.js`: Rapier's JS API bundled into one ES module by
  `scripts/vendor-rapier.mjs` (the package's bundler-only glue can't load in plain Node or in the
  Worker). The WASM binary is used untouched from `node_modules`.
- `src/sim/engine.js`: `initPhysics(source)` instantiates the WASM once per process, as each host
  can: the browser streams the hashed asset (`src/sim/engine-web.js`, asked for first thing in
  src/main.js; a run asked for before it lands waits a beat with "Loading physics"), the Worker passes
  a precompiled module (`src/worker/physics.js`: workerd may not compile WASM from bytes), Node
  reads the file. Tests start it in `tests/unit/setup.js`; scripts call it first thing.
- `src/sim/world.js`: a run's world. Static colliders built from the same numbers as
  `src/sim/courses.js` (the floor; the Wall's deck as a closed trimesh sampled along
  `wallProfile` every 20 cm; the truss tower and the posts beside the curl; the kicker when a
  course has one), every parked vehicle as a dynamic body, and the roadster's rigid hull. Free
  Drive builds a 96 m heightfield (2 m posts sampled from the exact road) plus boxes for rails,
  walls and tunnel roofs around the car, and moves the engine's origin with it (the engine stores
  single-precision floats; the roads span 6.5 km).
- `src/sim/vehicle.js`: the roadster's own force models (below), then one engine step.

### What the engine does

- Integrates every parked body (its own mass, CoM height and inertia tensor), finds and solves
  every contact (body on body, body on ground, the roadster's hull on anything), with friction
  (Min rule) and restitution (mean) per material pair, and sleeps bodies at rest.
- Resolves the roadster's rigid hull (a convex hull of its faceted body). While the hull touches
  nothing, the car's motion is exactly the integral of our forces in double precision (the engine
  stores single); in contact, the engine's answer is taken.
- Ray casts for every tyre, the fan's seal and the skirts.

### What stays ours (no engine ships it)

- **Tyres**: Pacejka magic formula (`tyreFx`/`tyreFy`), friction ellipse for combined slip, load
  sensitivity, implicit wheel spin, TC/ABS, stiction at crawl speed, rolling resistance.
- **Suspension**: raycast spring/damper per corner, rated to each axle's load, bump stop.
- **Suction fan**: four quarters of the skirts' sealed floor, each sealing or leaking on its own,
  pulled where that floor is; the reaction pulls whatever is under the car.
- **Skirts and floor pan**: compliant (0.3 MN/m) under the rigid hull, as on the curl's sag.
- **Cold-gas thrusters**: ten nozzles, blowdown, regulator, Isp sag; the mixer and the flight
  computer (Assist / Pro), or ten valves by hand (Advanced).
- **Angular momentum**: integrated in the world frame (LESSONS); after a contact the engine's new
  angular velocity is turned back into momentum through the inertia at the start of the step.
- **Parked vehicles' suspension and parked tyres**: a raycast corner per wheel position from LINEUP_SPEC's axles (six on the tractor), each rated to its share of the load, ride frequency
  1.3 Hz (cars) / 1.8 Hz (the tractor), damping ratio 0.3, locked tyres at μ 0.8 of their load.
- **Bodywork crush**: a contact puts ½·J·|v_n| into the patch of structure it hits (the nearest
  hull probe of the part its normal points at); past the 4.2 kJ the structure stores elastically,
  it folds by the excess over the 100 kN yield, up to 0.35 m, and stays folded. Impact events
  (hit, scrape, tyre slam, crush) are derived from the engine's contacts, closing speed measured
  against what the car hit as it was before the step.

## Known limits

- The rigid hull meets a wall in one tick (the engine's contact is rigid), so a crash's
  deceleration pulse is a single-tick impulse rather than the 60–100 ms a real crumple zone
  spreads it over. Momentum, energy loss and crush depth come out right; the G trace of a crash
  doesn't.
- A tyre is a ray: it can't climb a kerb taller than its travel the way a round tyre does.
- The engine allocates small JS objects per ray cast and per contact query (its API returns
  objects); the sim's own code still allocates nothing per tick.

## Performance

`node scripts/engine-bench.mjs --browser` (whole reference flights: tyres, fan, jets, flight
computer, the engine's step and contacts), ticks per second; a 60 fps frame runs 4 ticks:

| | Show | Wall | Lineup |
|---|---|---|---|
| Node 25, M1 Max (before: own integrator, no engine) | 95,600 | 126,100 | 159,400 |
| Node 25, M1 Max (Rapier; two runs on a busy machine) | 14,100–18,700 | 15,700–26,100 | 22,500–38,100 |
| Chromium (Rapier) | 20,100 | 28,400 | 44,900 |
| Chromium, 4× CPU throttle ≈ mid-range phone (Rapier) | 3,850 → **1.04 ms/frame** | 5,680 → 0.70 ms | 8,780 → 0.46 ms |

Real time needs 240 ticks/s; the Show's worst case leaves the phone's frame budget to the renderer.
First load: the 1.2 MB WASM and the 38 KB API are asked for before the stage starts building and
stream in parallel with it (the stage's sliced boot yields with `scheduler.yield`, which starves
anything queued behind it, so asking later cost a deep-linked run 10–15 s under software GL).
`scripts/perf.mjs` (3 runs, median): first 3D frame 446 → 537 ms desktop, 3.71 → 3.92 s on the
4×-throttled phone profile; FCP 56 → 104 ms desktop, 752 → 768 ms phone; main chunk 229 → 240 KB
gzip. The Worker grows from 332 KB to 1.53 MB gzip (free plan limit 3 MB).
