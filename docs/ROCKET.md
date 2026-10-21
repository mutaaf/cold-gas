# The launch complex (the backdrop)

A reusable two-stage orbital launch vehicle stands on its mount a few hundred metres beyond the
stage, floodlit, venting, with a strongback, lightning masts and a water tank around it. It's
set dressing for the one moment (the Wall, the carry over the row, the title), built to read as
a real vehicle at real scale. Code: `src/render/rocket.js` (a lazy chunk). The film look that
came with it (atmosphere, wet slab) is `src/render/film.js`.

## IP (AGENTS.md invariant 3.7)

Inspired by the class, owned by nobody: no names, marks, wordmarks, flags or liveries of any
real vehicle, operator or agency, here or in code. The livery is ours: white tanks with
flight-proven soot, a charcoal interstage, charcoal legs, and one signal-red hairline where the
fairing meets the upper stage (the game's only accent colour). The silhouette is the generic
one every vehicle of this class shares (a 3.7 m core, a wider fairing, folded legs, grid fins);
nothing that identifies a particular vehicle or pad.

## Dimensions (metres)

Sources: the public payload user's guides and press kits of the current medium-lift reusable
class (2018–2025 editions), encyclopedic summaries of reusable first stages, and launch-site
environmental assessments for pad structures. Figures are the class's, rounded; where a part
varies between vehicles or isn't published, the value is marked ESTIMATE.

| Part | Value | Notes |
|---|---|---|
| Overall height | 70.0 | engine section to fairing tip; the class sits at 68–71 m |
| Core diameter | 3.66 | set by road transport (≈ 3.7 m is the class's ceiling) |
| First stage (tanks + engine section) | 41.2 | |
| Interstage | 6.5 | carries the grid fins; composite, charcoal |
| Second stage, visible | 8.9 | most of its nozzle hides inside the interstage |
| Payload fairing | 13.1 long, 5.2 diameter | boat-tail from 3.66 to 5.2 m over ≈ 1.6 m, then barrel and a tangent ogive |
| Grid fins | 1.3 × 1.5, stowed flat | four, 90° apart, near the top of the interstage (ESTIMATE: size of the stowed panel) |
| Landing legs, folded | 9.6 long, ≈ 1.0 wide | four, between the fins, flush along the engine section and lower tank |
| Launch mount deck | 5.0 above the pad | the vehicle stands on hold-downs; flame trench beneath, exiting to one side (ESTIMATE) |
| Pad (hardstand) | 3.0 high, ≈ 66 radius | raised, with a sloped skirt to grade |
| Strongback / tower | 82 high, 3.4 square | a lattice beside the vehicle; clamp arms at three heights; access arm and white room at the upper stage |
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
vapour 1, plus the static fire's glow (2 instances) while it burns. ≈ 6 draws, ~25 k triangles.

## Anti-flicker

- Masts, clamp arms, the jib and the tank legs carry `aSpread` (src/render/sliver.js): never
  under a pixel.
- Weld rings, fairing seams and the red hairline are drawn in the shader and fade by their own
  pixel footprint (fwidth), so far away they dim instead of sparkling.
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
- **Static fire** (title only, never with `prefers-reduced-motion`): first after ≈ 26 s on the
  title, then every 100–160 s. 7.5 s burn: a glow under the mount and at the trench exit, the
  vehicle and pad lit orange from below, a steam cloud out of the trench that lingers ≈ 20 s.
  `stage.rocket.fire(t)` triggers one (screenshots).

## Loading

`src/render/scene.js` imports the chunk when the page is idle after the first frame, builds it
in ≈ 8 ms slices, compiles its shaders with `compileAsync` (hidden parts too), and only then adds
it. First-load bytes and the time to the first frame are unchanged (see the PR for
`scripts/perf.mjs` numbers). `stage.backdrop` resolves when it's in.
