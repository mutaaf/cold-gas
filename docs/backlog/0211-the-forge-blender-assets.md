---
id: 0211
title: The forge — real Blender assets, built headless from a seed or a brief, gated, reviewable
status: shipped
priority: P1
size: L
lens: authenticity
created: 2026-11-12
pr: 330
by: operator
---

## Why
The owner: "i want more real blender artifacts and ability to generate more inspired by pop culture artifacts in the exact
same modes". Every object in the game is procedural JS today (src/render/cars.js, parked/, world/): good silhouettes, but
no real modelling (bevels, weighted normals, proper UVs, baked occlusion, LODs). A pipeline that builds assets in Blender,
deterministically from a seed, and one that turns a brief ("an 80s rally hatch with light pods") into a model through
Claude, both behind the same gate, gives the game a way to keep getting more beautiful without hand-modelling, and
without ever drawing something that disagrees with the physics or carries someone else's name (AGENTS.md 3.7).

## What
Runs on: the operator's Mac (needs Blender: `/opt/homebrew/bin/blender`, or `BLENDER=`).

- `tools/forge/blender/forgekit.py`: the ONLY modelling API an archetype or a brief's script may call (primitives, a lofted
  body from cross-sections, lathe, extrude, bevel, subdivision, booleans, arrays, mirrors, panels projected onto a body,
  wheels on the spec's axles, wheel wells, palette materials). No text, curve, font, image or import call exists in it.
- `tools/forge/blender/finish.py`: merge by material, smart-UV unwrap, face-weighted normals (kept off the surfaces a cut
  re-tessellated: their normals come from the uncut shell), ambient occlusion ray-cast per vertex into the colour
  attribute (seeded), decimated LODs, validation (triangles, bounds, non-manifold edges, lettering-like island clusters,
  emblem-like outlines, fonts/curves/images), glTF export.
- `tools/forge/blender/turntable.py`: an eight-view EEVEE turntable on a dusk slab, stitched to one PNG for review.
- `tools/forge/lib/pack.mjs`: quantized attributes (KHR_mesh_quantization) + meshopt (EXT_meshopt_compression), which three's
  own GLTFLoader decodes with the decoder three ships (bundled, same origin). Build-time devDependencies only.
- `tools/forge/lib/slots.mjs`: the slots (sedan, suv, semi, pickup, cab, cone, barrier), each with the physics box read from
  the sim (`LINEUP_SPEC`, `CONE`, `BARRIER`), its budgets and its fit tolerances. `lib/gate.mjs`: the gate (pure, tested).
- `npm run forge -- <slot> [--seed N] [--promote]` (archetypes in `tools/forge/archetypes/`), `--all`.
- `npm run forge:brief -- "<trope or era>" [--slot cab] [--promote]`: Claude (`claude-opus-5-5`, adaptive thinking, server-side
  refusal fallback) writes a script against the kit's reference (read from forgekit.py's own docstrings); the brief and
  the script are screened for real names; the script is parsed and refused if it reaches outside the kit (imports other
  than math, bpy/os/sys/open/exec, dunder or `.obj` access, while, class, try); it runs headless, is gated, and its
  failures go back for up to three tries. Everything lands in `tools/forge/briefs/<date>-<slug>/`. No key: a clear
  message, exit 2, and the parametric path still works. `--script <file>` runs an existing script through the same
  checks with no model call (`tools/forge/briefs/example-rally-hatch/` is one, hand-written, and is the prompt's example).

## Acceptance criteria
- [x] `npm run forge -- --all` builds all seven slots headless, each PASSes the gate, with a turntable in `tools/forge/out/`
- [x] The gate refuses: over budget, a box that doesn't match the sim's, floating or off-centre, open shells, lettering-like
      clusters, emblem-like outlines, fonts/curves/images, materials outside the palette, a glb without LODs or meshopt
      (tests/unit/forge.test.js)
- [x] The brief prompt says tropes and eras only, no brands, logos, badges, lettering or real models; briefs and scripts
      naming real makes, models or film vehicles are refused before any call (tests/unit/forge.test.js)
- [x] Without ANTHROPIC_API_KEY, `npm run forge:brief` exits 2 with a message that names the parametric path
- [x] The same seed builds the same asset (the AO rays and every variation come from the seed)
- [x] Nothing personal goes into a request: the brief, the slot's spec and the kit's reference only

## Test plan
`tests/unit/forge.test.js`: the gate's every refusal on a fixture report and glb, the real-names screen (makes, models, film
vehicles caught; tropes and eras pass), the prompt (kit reference from source, public methods only; the rules' wording;
the reply parser), the example script's imports. Manual on the operator's Mac: `npm run forge -- --all`, every turntable
looked at; `npm run forge:brief -- --script tools/forge/briefs/example-rally-hatch/build.py --slot cab --brief "an 80s
rally hatch with light pods" --out tools/forge/briefs/example-rally-hatch` PASSes.

## Out of scope
- Textures (a baked albedo/normal atlas): the UVs are there for it; the game's look is palette materials today.
- A live brief run in CI (no key there, and Blender isn't on the runners): the brief path runs on the operator's Mac.
- Putting the assets in the game: 0212.
