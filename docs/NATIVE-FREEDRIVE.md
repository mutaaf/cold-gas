# NATIVE-FREEDRIVE.md: Free Drive on the iPhone, a world without an edge

The owner, 2026-11-11: "unlock a free drive mode within the same game map with semi infinite rendering using the
latest and greatest in open source metal and game repos, think superior innovation here". NATIVE.md §1 had Free Drive
as "Not in v1"; this document replaces that line for Free Drive (the Sandbox, builds, side quests and the rocket's
flight stay out). Written 2026-11-11 by the operator's session. Tickets: 0213 (this design), 0214 (the world), 0215
(driving it), 0216 (the bench).

## 1 · What the player gets

- **The same map.** Free Drive starts on the Show's apron: the Wall, the parked row, the pad, the launch complex, all
  of it drawn and solid exactly as in a scored run (the same stage, the same colliders). You can drive up the curl.
- **Then it doesn't end.** Past the 3 km concrete apron the land begins, in every direction: mountain ranges,
  mesas, forest hills and a coast, cut by roads that leave the apron and keep going, junction to junction, as far as
  anyone will drive. The horizon is real: the far ranges at 20–30 km stand against the sky.
- **Blue hour.** The keynote look (AGENTS.md §1): the sun just under the horizon, a cold gradient sky with its last
  warm band, matte land going violet with distance, the roads' delineators catching the headlamps.
- **Unscored.** No judges, no board, no vectors, no Worker: nothing a drive does reaches a score (§6).

## 2 · The survey: what's out there, what we take, what we skip

Every dependency must be permissive (MIT, Apache-2.0, BSD, zlib) and, by NATIVE.md §2.3, vendored or written by us:
no remote packages. Nothing below adds a binary dependency to the app; what we take is either an Apple framework, an
algorithm from a paper, or a tool for the offline asset pipeline.

| Candidate | Licence | Verdict | Why |
|---|---|---|---|
| **CDLOD terrain** (Strugar 2009, "Continuous Distance-Dependent Level of Detail") | paper (an algorithm) | **Take** | A quadtree of fixed 33×33 tiles chosen by distance; each tile is a pure function of (seed, level, x, z), so it streams on any thread and caches by key. The geomorph (each vertex slides to its parent's height across the last 30 % of its range) kills popping without stitching. Maps 1:1 onto chunked procedural generation and onto the physics' cells. |
| Geometry clipmaps (Losasso & Hoppe 2004; GPU Gems 2 ch. 2) | paper | Skip | Nested rings of a heightmap texture updated toroidally. Great for a stored DEM; for a procedural source it means re-rasterising texture rings on the CPU each move and sampling in the vertex shader. CDLOD gives the same screen-space error with independent cacheable tiles. |
| Concurrent binary trees (Dupuy 2020; Benyoub & Dupuy, HPG 2024, "CBT for large-scale game components") | paper; the 2024 demo repo states no licence and is DX12 | Skip (watch) | GPU-side adaptive tessellation is the state of the art for planet-scale terrain, but it wants a GPU heightfield and compute every frame; with no licence on the reference code we'd write it from the paper. It's the v3 path if the land ever needs sub-metre detail at 120 Hz. |
| **Floating origin** (Thorne 2005; every open-world engine) | technique | **Take, twice** | The engine (Rapier) stores f32: at 30 km its ulp is 2 mm, which is suspension noise. The world's engine origin moves with the car in 512 m steps (the web's world.js rebase, ported: `World.ox/oy/oz`, constants until now). The renderer draws camera-relative: positions stay `Double` on the CPU and become `Float` only as `position − origin`, the origin snapped to 256 m (exact in f32). |
| **Background chunk streaming** (GCD) | Apple | **Take** | Tiles, road ribbons and prop instances are built on a concurrent utility queue, uploaded on the main thread under a per-frame budget, nearest-and-ahead first (the camera's velocity 2 s ahead), into a pool of preallocated slabs (no allocation in the frame, NATIVE.md §2.5). |
| **Metal 4 residency sets** (`MTLResidencySet`, iOS 18+) | Apple | **Take the shape, not yet the API** | The stage renderer is on the Metal 3 encoder API with implicit residency. The world's buffers live in a fixed slab pool so that moving to MTL4 command buffers is "add the pool to one residency set", not a rewrite. The migration is the stage renderer's (0153's track). |
| Metal 4 argument tables (`MTL4ArgumentTable`) | Apple | Skip for now | Same reason: they come with MTL4 command encoders. The world's pipelines bind three buffers. |
| ICBs and GPU-driven culling | Apple | Skip (v2) | The quadtree selects ≈ 120–180 tiles and a few dozen instanced prop draws a frame; CPU culling of the tree is microseconds. GPU-driven culling pays off at thousands of draws (forge's dense props, below). |
| **Mesh shaders** (Metal 3+, Apple7 GPUs: every phone we target) with **meshoptimizer** meshlets | meshoptimizer: MIT (v1.x, Dec 2025; `clusterlod.h` MIT) | **Take for the asset pipeline; the draw path in v2** | meshoptimizer runs offline in the forge pipeline (tools/forge, another agent's), not in the app: `meshopt_simplify` makes each prop's LOD chain, `meshopt_buildMeshlets` its meshlets, `clusterlod.h` a Nanite-style cluster hierarchy for the heaviest assets. The app's prop interface (§4.4) takes a list of LOD meshes now and a meshlet stream later. |
| **MetalFX** spatial upscaling | Apple | **Keep** (already in) | The governor's resolution floor. |
| MetalFX temporal upscaling (WWDC26's redesigned upscaler) | Apple | v2 | Needs motion vectors and jitter from every pipeline in the renderer (plumes, mist, crash included): a renderer-wide change. The biggest quality win at 0.5 scale once it's done. |
| MetalFX frame interpolation (`MTLFXFrameInterpolator`, iOS 26) | Apple | Skip in v1, documented fallback | Rendering 60 and presenting 120 doubles the budget, but adds a frame of latency to a driving game and needs motion vectors and a UI pass after interpolation. If the device bench misses 120 Hz in Free Drive at the resolution floor, this is the lever, behind a setting. |
| Sparse textures / virtual texturing | Apple / technique | Skip | The land is shaded procedurally (biome palette from the vertex, slope and two noise octaves in the fragment): there's no unique texture to page. |
| Jolt Physics | MIT | Skip | Rapier (Apache-2.0) is already vendored, bit-exact with the web's, and handles the scale once the origin floats. Two engines would be two contact models. Our vehicle is our own (Pacejka, raycast suspension), so Jolt's vehicle constraint brings nothing. |
| FastNoiseLite | MIT | Skip | Float noise in another family. We port the web's integer-hashed value noise (src/sim/noise.js): the same hills' character as the web's endless world, and only `+ − × ÷` and `floor` (deterministic everywhere). |
| Wave function collapse road layout (Gumin) | MIT | Skip | Tile-based; our roads are continuous splines on a lattice (§4.2). |

Sources: Apple's WWDC26 Metal and Games guides (Metal 4.1, the redesigned MetalFX upscaler, MetalFX frame interpolation
and upscaling session 357); meshoptimizer's README and `clusterlod.h` header (MIT, v1.0 Dec 2025, v1.2 tag); the CBT
papers (Dupuy 2020, Benyoub & Dupuy 2024) and github.com/AnisB/large_cbt (DX12, no licence file found).

## 3 · The budget

120 Hz is 8.33 ms. NATIVE.md §4 measured the Show on a cool iPhone 15 Pro Max at GPU 6.1 ms (render scale 0.5,
MetalFX). Free Drive keeps the same renderer, so the world has to fit in what the stage leaves, and the stage is
mostly out of view once you leave the apron:
- **Terrain** ≤ 1.0 ms GPU: ≤ 180 tiles × 2,048 triangles (≈ 370 k), one pipeline, no textures, receives the key
  light's shadow but never casts (the shadow box is the car's 56 m square anyway).
- **Roads** ≤ 0.3 ms: ribbons of 4 m quads within 2 km.
- **Props** ≤ 0.6 ms: instanced, ≤ 24 k instances within 1.2 km, faded out by distance (no pop).
- **Off in Free Drive:** the mirror (the wet slab's quarter redraw) once the car is off the apron, the searchlight
  beams beyond 1.5 km. The stage's static mesh is culled as a whole beyond 6 km.
- **CPU** ≤ 1 ms main thread: quadtree selection, uploads (≤ 2 tiles a frame), the sim (2 ticks at 120 Hz:
  ≈ 40 µs), the streamed colliders (one 16 m cell a tick at most).

The bench: `-freedrive -bench` drives the autopilot along a road out from the apron for 10 s and prints `BENCH`
with frame times and the world's counters (tiles drawn, triangles, instances, uploads, cache MB).

## 4 · The world (ColdGasWorld, pure; the app draws it)

A new target in `ios/Packages/ColdGasCore`, **`ColdGasWorld`**: Foundation only, no Metal, `swift test` on macOS and
Linux. Everything in it is a pure function of the seed and a coordinate. It never touches the scored sim.

### 4.1 Terrain

- **Noise:** src/sim/noise.js in Swift (`hash2` with `Int32` wrapping multiplies, value noise with a quintic fade and
  analytic gradients, `fbm`, `ridged`). The web's endless world draws from the same functions.
- **Land:** four biomes blended by low-frequency fields (mountain ranges from ridged noise, mesas and dunes, forest
  hills, a coast that falls into the sea), heights in metres, with the exact gradient for normals. Unlike the web's
  endless world (laid out along a north-going valley), these fields are isotropic: the land goes on in every
  direction.
- **The site:** inside the Show's 3 km floor (|x|, |z| < 1,500 m) the land is the floor: 0 m, flat. From the floor's
  edge the relief grows over 1.6 km (a smooth C¹ ramp), so the apron sits in a broad basin and the ranges rise
  around it.
- **Carving:** the ground under and beside a road is the road's own grade: flat under the shoulders, then a 1:4
  recoverable apron to the natural land (the web's roads.js rule), blended by distance to the nearest road.

### 4.2 Roads: a lattice that never ends

The web's endless road is one road generated sequentially northward (z only grows), which is why it can't serve a
world with no edge. Native Free Drive uses **lattice roads**:
- The plane is cut into 1,024 m cells. Each cell has one **junction**, jittered inside it by a hash of (seed, cell).
- Each junction joins its east and its north neighbour (so every junction has up to four roads). A hash drops some
  links (never two at one junction), so the network isn't a grid.
- A link is a Hermite curve between its junctions; the tangents at a junction come from the directions to its
  neighbours, so roads flow through junctions. It's sampled every 4 m.
- **Elevation:** each sample's target is the land averaged across ±60 m along the curve, then clamped to a 9 %
  design grade by forward/backward passes and pinned to the junctions' heights, so two links meeting at a junction
  agree. Banking from curvature, up to 6 %.
- **Locality:** any point's road depends only on the links of the 3×3 cells round it, built from (seed, cells). So
  the network is infinite in every direction and the same everywhere it's asked for, in any order.
- **The site:** links are clipped where they reach the floor: roads leave the apron's edge in every direction.
- **Look:** the web's endless road's cross-section: asphalt, white edge lines, a dashed centre line, a gravel
  shoulder, delineator posts every 50 m with a reflector that catches the headlamps.

### 4.3 Streaming and LOD (the app's `WorldView`)

- **CDLOD quadtree** over the plane: roots of 16,384 m, eight levels down to 128 m leaves (33×33 vertices, 4 m), split
  where the camera is within 2.2 tile sizes. Leaves are drawn; each tile has skirts (1.5 of its steps) against cracks.
  - The split has to be at least twice the node, or neighbours can be two levels apart and the skirts show. The first
    cut used 1.6, and from 5 km a pale sheet stood over a summit.
- **Geomorph:** each vertex carries its own height and the height its parent level would give it there (the coarse
  grid's bilinear value); the vertex shader slides between them over the last 30 % of the tile's range.
- **Tiles** are generated on a background queue, cached in an LRU (by bytes), uploaded into pooled slabs.
- **Camera-relative:** each tile's vertices are relative to its own corner; its draw passes `corner − origin` as
  `Float`. The stage at the centre is drawn with a `−origin` model; the car with `carPos − origin`.
- **Roads:** per 512 m cell, the ribbons of the links crossing it, within 2.5 km; **props:** per 128 m cell, instance
  lists within 1.2 km.

### 4.4 Props, and the forge's assets

`ScatterProp` (pure): where things stand, from a jittered 8–16 m grid per 128 m cell: kind, position, yaw, scale.
Densities by biome and slope; nothing on a road, its shoulder or the floor. Kinds are strings
(`tree.spruce`, `tree.broadleaf`, `shrub`, `rock`, `post`).

What each kind looks like is the app's **`PropLibrary`**, a small interface:

```swift
protocol PropSource {
    /// The LOD chain for a kind (finest first) in the stage's 44-byte vertex format, and each LOD's end distance (m).
    func lods(for kind: String) -> [PropMesh]?
}
```

The app ships a procedural source (cones, a canopy, a faceted boulder, a post), so Free Drive draws with no assets.
The forge pipeline's props (tools/forge, .glb → the stage's format by scripts/native-stage.mjs, not edited here) plug
in as a second source that reads `Resources/Props/<kind>/lod<i>.bin` + `props.json` when present, first match wins.
Meshlets (meshoptimizer) later extend `PropMesh`, not the interface.

## 5 · Driving

- **The car is the scored car:** the same Swift `Vehicle` and `step`, the same tyres, fan and jets; the drive levels'
  Standard hands (Hands.swift). Free Drive is a `Course` of its own (`drive`), never one of the three.
- **Its world:** `createWorld` gives the drive course the Show's colliders (floor, the Wall's deck, steel, the parked
  row, the launch complex) and a **streamer**: 16 m cells of the exact ground as trimeshes (2 m posts) within ±3 cells,
  the next cell built one a tick, plus tree trunks and boulders as solids. The world's origin floats (§2).
- **Controls:** the app's controls as they are (classic stick and pedals; LIFT/LAND fly the jets as on the Lineup).
  Another agent is reworking ios/ColdGas/Input; Free Drive consumes `Controls` and `LiveRun`'s touch types.
- **Camera:** the web's drive camera (src/drive/camera.js): chase (trailing the heading, longer with speed, clear of the
  ground) and bumper.
- **Reset:** back on the nearest road; upside down for 2 s or fallen through, the same.
- **Entry:** a Free Drive button beside Fly on the title. `-freedrive` opens it straight away (shots, bench).

### As built (0215)

- `DriveStreamer` (ColdGasPhysics/Drive.swift) is the world's `WorldStreamer`, called first in `preStep`. It's nil on
  every scored course, and the run vectors prove that path is unchanged. It streams:
  - 16 m ground cells on 2 m posts, as up to three trimeshes (asphalt, the gravel shoulder, the land's material by
    biome and slope);
  - the 3 × 3 cells round the car at once, the rest of the ±3 window from a background queue, two a tick;
  - trunks (cylinders, wood) and boulders (balls, rock) from the 128 m prop cells round the car.
- **The engine's origin** is 0 within 2.2 km of the centre, where the floor, the Wall, the steel and the launch site
  sit at their own coordinates. Further out it's the car's position snapped to 16 m, and it moves when the car gets
  512 m off it. A move:
  - takes the stage's colliders out (they're rebuilt when the origin comes back);
  - shifts the parked bodies and the car;
  - rebuilds the cells round the car.
  `FreeDriveTests` drives 30 s across rebases, and no tick moves the car further than its speed allows.
- **`FreeDrive`** (the app) steps the car at 240 Hz from the classic controls. `Controls.drive` routes the run's own
  touch pad to the drive's `InputSampler`, and the rest of it works as the web's does:
  - the web's reverse (hold the brake at a standstill);
  - the fan switch, and camera cycling;
  - reset to the nearest road (and the watchdog's reset when upside down, fallen or stuck);
  - `-fd-pilot <m/s>`, a pure-pursuit driver for the bench.

### Roam (0220)

The owner, 2026-11-12: "ensure free drive works within the game play so i can go drive around the stunt modes". A roam
is Free Drive on a scored course's own set:
- **Courses.** `drive` is the Show's set, which has the Wall's curl too. `drive-wall` and `drive-lineup` put the Wall's
  or the Lineup's set at the centre instead: its parked row (the same mass-correct bodies), its pad, its fixtures and its
  complex. `stageOf` maps each to its stage, `driveCourse(on:)` picks one, and `isDrive` is what the drive-only code
  checks. None of them is in `COURSES`.
- **Start.** The car starts on the course's own mark, facing down its run. The jets fly as in Free Drive (LIFT/LAND),
  the tanks refill on the ground (a full charge in 8 s, unscored), and the fan switch is the Wall's suction (the curl is
  solid).
- **In:** Roam beside Fly on the title (Free Drive moves to the globe button), Roam on the results sheet, or
  `-roam <course>`.
- **Out:** "Fly <course>" under Back goes straight into a scored run from the mark.
- `-fd-hold throttle,steer[,after s]` (Debug) holds the controls, for shots.

### The world takes the hits (0221)

- **Loose things** (ColdGasPhysics `Loose.swift`): cones, barriers and A-frame signs are free rigid bodies with their
  real masses, their centres of mass lowered. Each set's layout comes from `looseSet(stage)`. The wheels' rays leave
  them out (`World.rayFilter`; `RAY_ALL` on every scored course), the engine's origin carries them when it moves, and
  their poses are read after each step (`readLoose`). The app draws them instanced with a full pose (`LooseView`).
  Impacts within 0.7 m of one aren't drawn or felt as the car's crash (plastic doesn't spark); the thing itself
  knocks.
- **Rubber** (`SkidMarks`): a ring of 4,096 quads in world metres, rewritten relative to the origin when it moves. A
  wheel marks paving when its slip ratio passes 0.08 or its slip angle 0.05 rad. On the stage's black slab the marks
  read by a faint sky sheen.
- **Smoke, dust, spray** go through the crash's puff pool (`Crash.kick`), by what's underfoot.
- **Felt:** the crash's shake goes to `DriveCamera`, each impact is a haptic transient scaled by its speed, and rough
  ground and a slide are a rumble under them. `Crash.repair` (Back on the road) undoes the damage without replaying the
  drive's earlier impacts.

## 6 · What it must not change

- `src/sim`, the vectors, `SIM_VERSION`, the Worker: untouched. The Swift scored sim's only edits are additive: the
  `World` origin becomes a variable (always 0 on a scored course) and `createWorld` learns the `drive` course. The 52 run
  vectors and every other `make test` row prove the scored path is bit-identical.
- No input log is posted, no card is scored, no medal or Daily counts a drive.

## 7 · Phases

| # | Ticket | Ships | Gate |
|---|---|---|---|
| 1 | 0213 | This document | Merged |
| 2 | 0214 | ColdGasWorld (noise, land, lattice roads, props, tiles) + the app's WorldView (CDLOD, streaming, camera-relative, blue hour) | `make test` green with the world's determinism tests; simulator shots near the complex and ~5 km out |
| 3 | 0215 | The drive: `drive` course, streamed colliders with a floating origin, the camera, controls, reset, the title's card | `make test` green (vectors bit-exact); a drive from the apron to 5 km on the simulator |
| 4 | 0216 | `-freedrive -bench` numbers on the simulator; the device command for the owner | Numbers in §8 |

## 8 · Measured

### The world (0214, simulator, Release)

`-freedrive -fd-stats` (shots: `-fd-at x,z,yaw°` near the complex; `-fd-km 5 -fd-cruise 25` out on a road):

| Where | Tiles drawn | Triangles | Road ribbons | Props drawn | Tile memory |
|---|---|---|---|---|---|
| The apron, by the complex | 91 | 233 k | 47 | 33 | 29 MB |
| 4.8 km out, a mountain road | 96 | 246 k | 47 | 11,526 | 30 MB |

`-fd-lod` colours each tile by its level, and `-fd-nocull` / `-fd-skip terrain,roads,props` help attribute a draw.

### The bench (0216)

`make bench-freedrive` builds Release, launches `-freedrive -bench -fd-km 3 -fd-pilot 25` on the Pro Max simulator, and
prints `BENCH` once the world near the car is built. That's 10 s of the autopilot on a road 3 km out, with the world's
counters. `SIM_ID=<udid>` picks another simulator.

Measured on the simulator (iPhone 18 Pro Max, iOS 27.0, Release, Xcode 27.2, on the operator's Mac), with the Show's own
bench (`-replay ref-show -bench`) on the same simulator and build for scale:

| | Frames in 10 s | Interval avg / p95 | CPU ms avg / p95 | What was drawn |
|---|---|---|---|---|
| The Show (the stage bench) | 421 | 23.8 / 33.3 ms | 0.85 / 2.29 | the stage, render scale 0.85 |
| Free Drive, 3 km out | 410 | 24.5 / 33.3 ms | 1.21 / 3.38 | 94 tiles, 241 k triangles, 43 ribbons, 10.4 k props, 31 MB of tiles, render scale 0.95 |

What it says, and what it doesn't:
- **CPU.** The world adds about 0.36 ms a frame on the main thread: the quadtree, the uploads, the sim's two ticks with
  the streamed cells, and the HUD. That's inside §3's 1 ms.
- **GPU.** The simulator's frame rate is its emulated GPU's, the same for the Show and Free Drive (≈ 41 fps). Its GPU
  timestamps are not meaningful, so §3's GPU budget can only be checked on a phone.
- **Memory.** The tiles' slabs hold about 30 MB. The LRU starts evicting past 900 tiles.

After 0220/0221 (roam, loose things, rubber, puffs, shake), the same bench run back to back on the same simulator on
2026-11-12, with `main` (d80db6c) first and then the branch. The Mac was heavily loaded by other work, so compare the two
rows with each other, not with the table above:

| | Frames in 10 s | Interval avg / p95 | CPU ms avg / p95 | What was drawn |
|---|---|---|---|---|
| Before (main) | 408 | 24.57 / 33.33 ms | 1.12 / 3.39 | 97 tiles, 248 k triangles, 21.4 k props |
| After (0221) | 408 | 24.57 / 33.33 ms | 1.23 / 3.33 | the same, plus 23 loose things and 116 rubber quads |

The drive's new work (reading the loose bodies, the tyres' effects, the marks' buffer) costs about 0.1 ms of main-thread
CPU a frame. The simulator's GPU is not a phone's, so the GPU side waits for `make device-bench-freedrive`.

**On a phone (the owner runs this; an agent never runs it on the owner's phone):**

```
cd ios && make device-bench-freedrive
```

It builds Release for the paired iPhone, installs it and prints the same two `BENCH` lines (`DEVICE_ID=<udid>` picks the
phone). The bar is NATIVE.md's: a presentation p95 of 8.34 ms at 120 Hz, at thermal state 0. The bench prints the state,
and back-to-back runs heat a phone. If the frame misses at the resolution floor, these are the levers, in order:
1. Draw fewer props: lower `WorldView.propR`.
2. Make the quadtree split less: lower `WorldView.split` toward 2.0.
3. Take the shadow off the terrain.
4. Use MetalFX frame interpolation in Free Drive (§2).
