// The forge's brief prompt (0211): what Claude is told when it writes a build script from a brief. Pure (unit-tested):
// the kit's reference is read from forgekit.py's own signatures and docstrings, so it can't drift from the code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The public kit API as text: `name(args)` + docstring, for every Kit method not starting with `_`. */
export function kitReference(src) {
  const out = [];
  const re = /\n {4}def ([a-z][a-z_0-9]*)\(self(?:, )?([^)]*)\):\n {8}"""([\s\S]*?)"""/g;
  let m;
  while ((m = re.exec(src))) out.push(`kit.${m[1]}(${m[2]})\n    ${m[3].replace(/\n\s+/g, '\n    ').trim()}`);
  const pal = /PALETTE = \{([\s\S]*?)\n\}/.exec(src);
  const names = pal ? [...pal[1].matchAll(/'([a-z_]+)':/g)].map((x) => x[1]) : [];
  return { methods: out.join('\n\n'), palette: names };
}

export const RULES = `You write build scripts for COLD GAS's forge: Python run headless in Blender that model ONE object with a fixed kit.

The contract:
- Define exactly \`def build(kit, spec, rng):\`. Call only the kit's methods listed below. \`import math\` is the only import.
  No bpy, no os/sys/open/exec/eval/getattr, no while loops, generators, classes or try; attributes only of the kit, rng and math, no
  \`.obj\`/\`.data\`: the script is parsed and refused if it uses any of them.
- Units are metres. Blender's Z is up, the ground is z = 0, the nose points to +Y, the right side to +X, and the object is
  centred on x = 0, y = 0. It must fill the slot's box (spec l × w × h: length within -3/+1 %, height within -5/+2 %,
  width at least 95 % of w and at most spec.wMirrors) and stand on the ground.
- A vehicle's wheels go exactly on the spec's axles: \`kit.axle_wheels(axle, …)\` for each axle in spec['axles'], and cut
  the wells with \`kit.arches(body, spec['axles'])\`. The game's physics uses these axles; the model is only pixels.
- Materials are palette names only (listed below). Lamps are emissive palette materials (lamp_white, lamp_red, lamp_amber).
- Budget: the whole model under the LOD0 triangle budget given. Prefer kit.body() for smooth shells and kit.project() /
  kit.strip() to lay glass, lamps and trim onto them. Bevels and subdivision cost triangles: spend them where they show.
- Closed solids only (every kit primitive is one); panels sit on the body (project/strip), never floating.
- rng is a seeded random.Random: use it for small variations only, so the same seed builds the same object.

What the object may and may not be (this is a hard rule):
- Pop culture means TROPES AND ERAS only: "an 80s rally hatch with light pods", "a 70s wedge supercar", "a 50s chrome
  cruiser", "a retro-futurist moon rover". Never a specific film, show, game or toy vehicle or character, never a real
  manufacturer, brand, model name, livery, badge, logo, emblem, wordmark, licence plate text, number or lettering of any
  kind. Our own design, always. If the brief asks for something specific and real, design an original take on its era
  and genre instead, and say so in a comment.
- No text and no symbols in geometry: no letters, digits or emblem shapes made of boxes, strips or outlines. The gate
  rejects small intricate outlines and clusters of small flat pieces as lettering.

Answer with ONE \`\`\`python code block containing the whole script, preceded by at most three short lines on the design.`;

export function buildPrompt({ brief, slot, root }) {
  const src = readFileSync(join(root, 'tools/forge/blender/forgekit.py'), 'utf8');
  const { methods, palette } = kitReference(src);
  const example = readFileSync(join(root, 'tools/forge/briefs/example-rally-hatch/build.py'), 'utf8');
  const system = `${RULES}\n\nThe kit:\n\n${methods}\n\nPalette: ${palette.join(', ')}\n\nAn example script (a hatch in the cab slot):\n\`\`\`python\n${example}\`\`\``;
  const spec = { ...slot.spec };
  delete spec.wheelZones;
  const user = `Brief: ${brief}\n\nSlot: ${slot.id} (${slot.kind}). Its spec (from the game's physics):\n${JSON.stringify(spec, null, 1)}\n\nLOD0 budget: ${slot.budgets[0]} triangles.`;
  return { system, user };
}

/** The python code block in a reply, or null. */
export function scriptFrom(text) {
  const m = /```python\n([\s\S]*?)```/.exec(text) || /```\n(def build[\s\S]*?)```/.exec(text);
  return m ? m[1] : null;
}

/** What to tell the model when its script failed. */
export function repairPrompt(failures, trace) {
  return `The script was run and failed the forge's gate:\n- ${failures.join('\n- ')}${trace ? `\n\nBlender said:\n${String(trace).slice(-1500)}` : ''}\n\nFix it and answer with the whole corrected script in one \`\`\`python block.`;
}
