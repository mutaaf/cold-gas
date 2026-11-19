# NATIVE-MATTER.md: everything leaves a mark (the iPhone app's cause and effect)

The owner, 2026-11-19: "effects of the environment on the vehicle on the environment … every bit of damage, every bit of
effect, cause and effect is considered, and realistic … across the real, anime, and 8-bit versions", built with "the most
minimal amounts of re-renders, caching considered". This is the map of what does what to what in Free Drive and Roam (and,
drawn only, in a scored run), what existed before 0330, what this track built, and what's still a gap. Tickets 0330–0339.
Siblings: LANDSCAPE (terrain, streaming, vegetation, sky: NATIVE-FREEDRIVE.md) and WATER (water, buoyancy, splash, the
car's wetness). The scored stunt runs are untouched: `Vehicle.swift` and its 52 run vectors are bit-exact, and in a scored
run every effect here is pixels, sound or the hand's only.

## 1 · The matrix

Legend: **V** visual, **P** physical, **A** audio, **H** haptic. *Was*: before 0330. *Now*: after this track. A dash is "not
applicable". Gaps are in §5.

### 1.1 The ground under the car (car ↔ ground matter)

| Ground | Car → ground | Ground → car | Was | Now |
|---|---|---|---|---|
| Asphalt, concrete | V: rubber (slide/spin over κ 0.08 or α 0.05), tyre smoke on a hard slide | P: full grip; A: squeal voices; H: slide grain, ABS | V P A H | the same, and rubber only on ground that takes it (`GroundMatter.rubber`) |
| Wet asphalt (rain) | V: (as dry, the rubber washes) | P: grip × 0.72 (`MatterMaterials.wetAsphalt`, `DriveModel.gripK`) | — | P: material and per-wheel grip hook, fed by WATER's wetness (or `-fd-wet` Debug) |
| Gravel | V: rut 0.8 cm a pass (≤ 3 cm), stones thrown | P: grip 0.62, loose curve; dust; A: gravel bed | P V(dust) A | **V: rut + berm in the trace; stones flung (chips, grey)** |
| Dirt | V: rut 1.2 cm (≤ 5 cm), dust | P: grip 0.55, rolling drag; car dusted | P V(dust) A | **V: rut, berm, darker floor; dust coat on the car (≤ 0.55)** |
| Mud (dirt or grass soaked) | V: rut 6 cm a pass (≤ 14 cm), a wet sheen, clods thrown | P: grip 0.36, drag 0.07; car caked to the sills | — | **all new**: matter, material, deep ruts with berms, sheen, clods (6 s), caked coat |
| Sand | V: rut 3.5 cm (≤ 8 cm), dust | P: grip 0.5, drag 0.1 | P V(dust) | **V: rut, berm; dust coat** |
| Grass | V: turf rut 0.6 cm, the blades laid down (paler, straw) | P: grip 0.45; cut grass thrown | P V(dust) | **V: pressed track; grass bits flung** |
| Snow (over 900 m) | V: rut 8 cm (≤ 16), packed grey-blue, powder thrown | P: grip 0.30 (was gravel's 0.62); snow packs into the arches | P (as gravel) | **P: snow is snow; V: deep packed ruts, powder puffs; white packed in the arches, melts in water** |
| Ice (water above the snow line) | V: no rubber, no roost | P: grip 0.10, a near-frictionless slide | — | **P: material and tests** (V waits for WATER's frozen lakes: §5) |
| Rock | V: — | P: grip 0.7 | P | P (unchanged) |
| Water (a ford) | V: spray (puffs) | P: drag 0.06, grip 0.55; the car soaked | V P A (splash) | **P: shallow-water material; the car's wetness rinses the coat, darkens and polishes the paint** |

### 1.2 The tyres and the trace

| Cause | Effect | Was | Now |
|---|---|---|---|
| A loaded wheel crosses soft ground | A stroke in the ground's memory: depth × load × (1 + 1.5 × spin), berm beside it, pressed (grass, snow), its matter's colour; kept per 16 m tile until the tile's slot is needed (48 slots, LRU) | — | **new (0331)** |
| A wheel spins on soft ground | A deeper rut, more roost, more coat (× 1 + 2·slip) | dust only | **new** |
| A slide on paving | Rubber strips (a 4,096-quad ring) | yes (0223) | kept |
| The same track driven again | Ruts deepen toward the ground's limit; the berm rolls flat under a tread | — | **new** |

### 1.3 Props ↔ car

| Prop | Car → prop | Prop → car | Was | Now |
|---|---|---|---|---|
| Cone (4.2 kg) | P: tips at its real angle, rolls round its tip | P: a tick (impulse); A plastic; H light | yes | kept |
| Water-fill barrier (200 kg) | P: shoved, slides to rest | P: a thud | yes | kept |
| Tyre stack, drum, flight case, generator, K-rail | P: topple, roll, shove at their masses | A by material; H by impulse | yes (0273) | kept |
| A-frame sign | P: tips | A sign | yes | kept |
| Fence bay | P: breaks loose per 4 m bay at 6,000 N·s, a free 45 kg body | P: the car keeps what went past | yes (0227) | kept |
| Bend sign on its post | P: breaks at 2,500 N·s | A steel | yes | kept |
| Guard rail (W-beam) | P: holds a nudge, gives at 24,000 N·s | P: holds a glancing car | yes | kept |
| **Tree** | P: stands until the blow passes its trunk's strength (snap speed 12.5 m/s × (r/0.15)^1.5: ≈ 45 km/h for a 30 cm trunk, ≈ 128 km/h for 62 cm), then snaps at its foot and **topples away** as a 640 kg body (trunk and crown); V: its instance hidden, splinters, bark, dust | P: a slow car is stopped dead; a fast one keeps what went past; A: a timber crack; H: a crush; camera shake | stopped dead always | **new (0334)** |
| Boulder | — | P: stops the car | yes | kept (§5: no chips off it) |
| Delineator post | — | (drawn only, no collider) | — | gap (§5) |

The pieces persist (`World.loose`, pooled per kind, put away and reused when their cell is left behind), capped (96 drawn
per kind, `LooseView.maxPerKind`) and culled with their cell.

### 1.4 The car's own damage (car ← every hit)

| Part | Cause | Effect (V / P / A / H) | Was | Now |
|---|---|---|---|---|
| Body panels | HIT, CRUSH | V: dents at the probe (Dents.swift), per-zone deformation kept (nose, tail, flanks, roof, floor) | V | V + the zone model (CarDamage.dent) |
| Glass (canopy) | roof/flank > 5 m/s, any > 9 | **cracked → shattered** (roof/flank > 11, or the third hard hit): crazed milky, then gone (a dark empty frame) with 36 glass flakes; A: a glass crunch; H: a sharp hit | crazed only | **three states (0333)** |
| Lamps | nose/tail > 4 m/s on a corner, > 8 both | V: that corner's lamp out (half the end's light), both: dark; flicker on failing (crash.js) | whole end | **per corner** |
| Aero panels (front vanes, rear wing) | nose/tail > 5 m/s | V: **hangs** by one end, swinging (a 2.5 Hz damped pendulum, driven by speed); > 9 or a second hit: torn off as debris | torn off only | **hanging, then off** |
| Wheels / arms | a slam > 7 m/s on a wheel (kerb, ditch), a flank hit within 0.7 m of an axle > 4 m/s | P: toe bent (≤ 4.6°): **the steering pulls** (fronts), **the car crabs** (rears); V: the wheel turned and cambered | — | **new (0333)** |
| Drive unit | each hit's (v − 3)² against three 15 m/s crashes | V: **smoke** from the rear deck below 0.6 health (pale → thick, dark); P: **limp** below 0.4 (power to 35 %); cue "Limping" | — | **new (0333)** |
| Hazards, crash cut, slow-mo, shake, impact frame | big hits | yes (crash.js port, 0153, 0271, 0290) | V H | kept |
| All of it | a reset ("Back on the road") | restored | partial (dents, lamps, parts) | **all restored** (the coat stays: a reset doesn't wash the car) |

### 1.5 Other vehicles (the Lineup's row)

| Cause | Effect | Was | Now |
|---|---|---|---|
| The car hits a parked vehicle | P: rocks on its springs, shoved (its own mass, CoM, suspension); V: dented where hit, chips in its own paint; A: struck metal | yes | kept |
| A parked vehicle's glass, lamps, panels | — | — | gap (§5, 0337) |

### 1.6 Water (the WATER track's)

| Cause | Effect | Owner |
|---|---|---|
| The car in water | buoyancy, drag, splash, wake | WATER |
| The car's wetness (0…1) | **coat rinsed** (mud slowly, dust fast, snow melts), **paint darker and glossier**, wet mud darker; dirt and grass soaked turn to mud; roads lose grip | this track consumes it: `FreeDrive.wetSource` (one closure), a ford's own soak until then |

## 2 · How it's built

| Piece | Where | What |
|---|---|---|
| `GroundMatter`, `MatterMaterials` | ColdGasPhysics/Matter.swift (pure) | What the ground is (surface × wetness × freezing), what it gives a tyre, what it takes and throws |
| `CarDirt` | Matter.swift (pure) | The coat per part (wheels, sills, nose, tail, body), its colour, packed snow; rolled on, rinsed, shed |
| `CarDamage` | ColdGasPhysics/CarDamage.swift (pure) | Every impact into panels, glass, lamps, aero panels, arms, the drive unit; `toe`, `powerK` read by DriveCar |
| `DriveModel.toe / powerK / gripK` | DriveCar.swift | A bent arm's toe added to where a wheel points; the motors' torque scaled; a wheel's grip over its ground's |
| `DriveStreamer.material`, trunk items | Drive.swift | Snow and ice are their own materials; trunks break as the roadside does (`strength(_ s:)`, `snapSpeed`) |
| `TraceAtlas` | ColdGasWorld/Trace.swift (pure) | Slots per 16 m tile (LRU), strokes cut per tile with their texel boxes, the shader's 32 × 32 table |
| `TraceField` | World/TraceField.swift + Trace.metal | The 2D array texture (48 × 256² RGBA8, 12 MB, made once), a stroke = one dispatch over its box |
| Trace in the land | World/Trace.h (+ 3 lines in World.metal) | The terrain reads its tile's layer: rut walls lit by their slope, floor darker, berm, laid grass, packed snow, mud's sheen |
| The coat drawn | Render/CarMatter.h (+ 4 lines in Shaders.metal), MatterLook.swift | Frame.matter; a mask in the car's frame (height, nose/tail, near a wheel) broken by body-fixed noise |
| Damage drawn | Crash.swift (`absorb`, `adopt`), CarState (`shattered`, `hang`, `swing`), Renderer | One damage model in a drive (the physics'), the crash's own in a scored run's replay |
| Particles on the ground | Crash.swift (per-particle floors), Debris.swift | Sparks, chips, puffs and torn parts land on the world's ground (they all fell to y = 0 before) |
| Felled trees | LooseKind.log, LooseView, WorldView.setFelled | The snapped tree's body and mesh; its instance hidden by place |

**Hook contract (for LANDSCAPE and WATER):** `TraceField.texture` (2D array, RGBA8: R depth × 0.16 m, G berm × 0.04 m, B
pressed, A matter tag) with `TraceAtlas.slot(of:)` and the table (`WTrace`, Trace.h) is the per-tile trace slot: another
shader (grass, a finer near-field mesh that displaces) binds buffer 6 / texture 6 as the terrain does. `GroundMatter.of(_:wet:
freezing:)` is the material query (pass the land's own wetness and cold when LANDSCAPE has them). `FreeDrive.wetSource` takes
WATER's car wetness.

## 3 · The three looks

| Effect | Real | Anime | 8-bit |
|---|---|---|---|
| Ruts | soft walls lit by their slope, darker floor, a lighter berm, mud's sheen | the depth in two flat bands, an ink line round the rut's lip | nearest texels, the depth as one hard step (blocky tracks), quantised with the land |
| Laid grass, packed snow | paler straw, grey-blue | the same tones, flat | the same, stepped |
| The coat | soft-edged splashes, matte (no clear coat), wet mud darker | one flat tone, a clean edge | coarser blobs (3/m, not 7), then the palette |
| Roost | tumbling chips (clods, stones, grass), soft puffs (snow, dust) | the chips inked by the film pass, cel puffs (two tones, clean edge) | chips as solid blocks at ≥ 1 px, puffs one tone (celPuff) |
| Smoke | soft billows, pale to dark | cel puffs | one-tone blocks |
| Glass | crazed milky, then an empty frame | the same, inked | the same, quantised |
| Hits | sparks, flash | + impact frame, speed lines (0290) | sparks ≥ 1 px |

## 4 · Efficiency

- **Nothing per frame when idle.** No stroke: no compute encoder (TraceField.encode returns), the table's bytes rebound
  unchanged (2 KB), the terrain's read is one branch on `head.z`. A clean, dry car: `Frame.matter[0].w = 0`, one branch.
- **Small dispatches where a tyre touched.** ≤ 4 strokes a frame (one a wheel every 30 cm), each clipped to its tile and box
  (≈ 20 × 30 texels at 6.25 cm), so ≈ 600 threads a stroke; a tile's first stroke clears its layer once (65 k threads).
- **Cached.** The trace survives in its slot until the least recently pressed tile needs it (48 tiles ≈ 750 m of single track).
  The table rebuilds only when a slot changes or the camera crosses a tile.
- **Pooled.** Roost and splinters use the crash's fixed chip pool (220); puffs its 320; felled trees and broken roadside are
  pooled bodies (`spare`), put away with their cell.
- **Signposts:** `matter-trace` (Points of Interest) round each encode with strokes. **Feature flag:** `mt` in the session's
  use row (a trace laid or a hit taken), read by `npm run obs:report`.
- **Budget (Real, iPhone 17-class):** ≤ 1.5 ms GPU, ≤ 30 MB. Memory: 12 MB trace + 0 new buffers elsewhere (puffs, chips,
  loose reuse their pools). GPU: measured in §6.

## 5 · Gaps (not built here)

- **Displacement.** The ruts are shaded into the land, not displaced: the terrain's near mesh has 4 m between vertices. A
  finer near-field mesh (LANDSCAPE) can read the same layers (hook above). 0336.
- **Ice you can see.** Ice is a material and a test; the world has no frozen water yet (WATER's lakes above the snow line).
- **Other vehicles' glass, lamps and panels** (the Lineup's row is dented and chipped, nothing more). 0337.
- **Trees bending without snapping, poles and delineators.** A tree under its strength stops the car rigidly; delineator posts
  have no collider. 0338.
- **Surface voices** for mud, snow and ice in the tyre audio (the bed has paved, gravel, grass and wet). 0339.
- **Rocks chipping, props scuffing the ground** (a dragged K-rail leaves no gouge).

## 6 · Measured

See the PR (#PR) for the before/after shots in the three looks and the table below.
