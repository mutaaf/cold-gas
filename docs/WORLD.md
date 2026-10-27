# The endless world

Free Drive's procedural mode: `?drive=endless&seed=<anything>` (or the Endless card in the road
picker). One road, generated 3 m at a time northward forever, through mountain passes, coast,
desert and forest, all of it a pure function of the seed. Same seed, same world, on every device.

## Pieces

| File | Side | What |
|---|---|---|
| `src/sim/noise.js` | sim (pure) | integer-hashed value noise with analytic gradients, fbm, ridged, `seedOf(string)` |
| `src/sim/endless.js` | sim (pure) | terrain (`createTerrain`: biomes, height + exact gradient, materials), the road generator (`createEndlessRoad`), the course (`createEndlessCourse`) |
| `src/sim/objects.js` | sim (pure) | placed objects: registry, deterministic ids, SDF colliders, triggers, `colliders()` primitives |
| `src/world/tilegen.js` | worker | one terrain tile (positions, normals, colours, sea depth) + its vegetation |
| `src/world/roadchunk.js` | worker / main | road chunks built with `src/render/road.js` in the worker, rebuilt around the real materials |
| `src/world/terrain.worker.js` | worker | the worker (tiles and chunks, typed arrays transferred) |
| `src/world/endless-world.js` | main | LOD rings, scheduling, frame budget, caches, pools, the world API |
| `src/world/cache.js` | main | LRU of built tiles (byte budget) + optional IndexedDB (`v<ENDLESS_VERSION>:<seed>:<tile>`) |
| `src/world/pool.js` | main | one InstancedMesh per prop (spruce near/far, broadleaf, shrub, rock), blocks per tile |
| `src/world/look.js`, `objects-view.js` | main | terrain/water material, prop geometry, what placed objects look like |

### Determinism

- The road heads within ±72° of north, so **z only grows along it**. Everything that can shape the
  ground at z is generated once the road reaches `z + reach`; the course's `sdf` calls
  `road.ensure(z)` before answering. A published sample never changes. So the surface at any point
  is a pure function of (seed, x, y, z), whatever order things were generated in (unit-tested).
- Only `+ − × ÷ √`, `Math.floor`, integer hashing and `dmath` in `src/sim` (unit-tested).
- `ENDLESS_VERSION` (src/sim/endless.js): bump it whenever a seed would build a different world (it
  also keys the IndexedDB cache).

### The road and the land

The land is laid out along a macro path (a slow meander, `macroX(seed, z)`): a valley whose floor
`V(z)` rises to cols and falls to basins, with each biome's relief growing from 15 % on the valley
floor to all of it a kilometre out. Biomes come in bands of a few km along z. On the coast the sea
lies to one side, 150–320 m out. The generator winds on noise, leans toward the side whose ground is
nearer its own height (contours), keeps clear of itself and the sea, holds a design grade per biome
(7–10 %) through smooth vertical curves, banks and widens into its curves, and puts in bridges
(fill > 16 m, or over water), parapets on them, and guard rails above drops > 4 m.

The road object has the same shape as a baked one, so `src/sim/roads.js` drives it unchanged: the
ribbon, the graded 1:4 roadside apron, the structural slopes, rails. Two hooks there make that
possible: `road.dem(x, z, out)` (the natural ground) and an open-ended segment map (`grid.cells`).

## Streaming and budgets

Four tile levels (32 × 32 cells + skirts): 128 m within ≈ 480 m, 512 m within ≈ 2.3 km, 2 km within
≈ 9 km, 8 km to the horizon (`TIERS` in endless-world.js; `?gfx=high|mid|low`; phones and tablets get high like a desktop, 0097).
A finer tile cuts its hole in the coarser one; wholly covered tiles aren't drawn. Road chunks
(192 m) within ≈ 2 km. Everything is built in the worker(s); the main thread wraps typed arrays in
buffers under `budget` ms per frame, nearest-and-ahead first (priorities use the camera's velocity
3 s ahead). Tiles, chunks and GPU memory past their rings or over `gpuMB` are disposed; built tiles
stay in the LRU (`cacheMB`) and, for levels ≥ 1, IndexedDB (`?idb=0` turns it off).

Measured (`node scripts/perf-endless.mjs <url> phone|desktop cruise|drive 40`, phone = 390×844 DPR 3,
CPU ×4; cruise = carried along the road at 250 km/h):

| | fps | main thread, drive loop incl. world | world.update max | worker ms/tile | memory | fell behind |
|---|---|---|---|---|---|---|
| phone, cruise 250 km/h | 60 | 0.75 avg · 1.8 p95 · 5.1 max | 4 | 2.6 avg · 3.5 p95 | heap 41 MB · GPU 13 MB · cache 12.5 MB | 0 / 2401 frames |
| phone, autopilot | 60 | 3.1 avg · 4.6 p95 · 29.7 max (incl. physics on Rapier, #33; the max is its hull heightfield rebuild every 24 m, which samples the endless ground's noise ≈ 2,400 times) | 1.0 | 2.7 avg · 5.0 p95 | heap 38 MB · GPU 12 MB | 0 / 2392 |
| desktop, cruise 250 km/h | 60 | 0.22 avg · 0.5 p95 · 1.6 max | 1.2 | 2.6 avg · 3.2 p95 | heap 52 MB · GPU 19 MB · cache 18 MB | 0 / 2401 |

Road chunks: 2.3–2.9 ms in the worker, ≤ 1.3 ms to upload. (Chrome's CPU throttle may not slow
workers; in Node a tile takes 2–15 ms, so a 4× slower phone worker still has ample headroom: at
250 km/h it needs ≈ 5 level-0 tiles a second.) "Fell behind" counts frames where the full-detail
tile or the road chunk under the car wasn't drawn yet.

## The world API (for build modes, side quests, power-ups)

In Free Drive, `window.__coldgas.drive.world` (and the `world` the drive module creates):

```js
world.seed                         // number (seedOf of the string)
world.groundAt(x, z)               // { y, normal } — the ground the car drives on (the ribbon where it is)
world.nearestRoad(x, z)            // { s, lat (+ left), hw, y, biome } or null
world.roadPoseAt(s, dir = 1)       // { x, y, z, yaw, i }: a pose in the right-hand lane s m along
world.biomeAt(x, z)                // 'Mountain pass' | 'Coast road' | 'Desert' | 'Forest'

world.addObject(spec)              // → id (deterministic: type.chunkX.chunkZ.hash), collides at once
world.removeObject(id)             // → boolean
world.getObject(id)
world.objectsNear({ x, z }, r=50)  // nearest first
world.objectsInChunk(cx, cz)       // 64 m chunks: chunkOf(x, z) in src/sim/objects.js
world.onObjects((kind, obj) => {}) // 'add' | 'remove'; returns an unsubscribe
world.exportObjects() / world.importObjects(list)   // plain specs, sorted by id
world.colliders(minX, minZ, maxX, maxZ)             // primitives for another physics engine
```

Specs: `{ type: 'ramp' | 'box' | 'loop' | 'boost' | 'powerup', x, y?, z, yaw, …sizes }` (defaults
and meanings in `src/sim/objects.js`). `y` defaults to the ground. Ramps, boxes and loops are solid
(concrete); boost pads and power-ups are triggers: `course.objects.triggersAt(x, y, z)` lists the
ones a point is in, and what they do is the caller's.

### The physics coupling

Everything the car meets goes through one function: `course.sdf(x, y, z, out)` (signed distance,
normal into `out.{x,y,z}`, `out.mat`, `out.obstacle`, `out.object`), which `src/sim/courses.js`
`surface()` defers to. For an engine with its own colliders (Rapier-class), build from:
`world.groundAt` / `road.dem` (heightfield tiles, sample at 4 m), the road arrays (ribbon:
`x, z, y, hw, bank` per 3 m sample, `flags` for bridges and rails), and `objects.colliders()`
(`box` half-extents + pose, `wedge` w/l/h + pose, `loop` r/w/shift/t + pose).

The rigid-body engine (src/sim/world.js) does exactly that, near the car: the ground as heightfield
cells, the road's structures, the objects (`objects.shapes(o)`: a box, the wedge's hull, the loop's
band in convex slabs) and the vegetation. Trees, shrubs and boulders are placed by
`src/sim/scenery.js` (`endlessPropAt`): the tiles draw that placement (src/world/tilegen.js), and the
physics streams the same props, so a spruce is a solid trunk and a boulder the convex hull of the one
drawn; shrubs and crowns are soft (a drag on the car). Level 0 uses one grid spacing on every tier
(`VEG_SPACING`); the far tiers' trees are hidden within the near ring, where the solid ones stand.
