// The forge (0211): its gate, its screen for real names, its prompt.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gate, bannedIn } from '../../tools/forge/lib/gate.mjs';
import { SLOTS } from '../../tools/forge/lib/slots.mjs';
import { kitReference, scriptFrom, RULES, repairPrompt } from '../../tools/forge/lib/prompt.mjs';

// A report as finish.py writes it, for a sedan that fits.
const S = SLOTS.sedan;
const goodReport = () => ({
  ok: true, id: 'sedan-0', source: 'sedan', seed: 0, outlineFlags: [],
  lod0: {
    tris: 15000, edges: 30000, nonManifoldEdges: 0, glyphClusterCount: 0, fonts: 0, curves: 0, images: 0,
    objectTypes: ['MESH', 'EMPTY'], materials: ['paint', 'glass', 'rubber'],
    bounds: { min: [-1.0, -2.36, 0], max: [1.0, 2.36, 1.44] },
  },
  lod1: { tris: 5000 },
});

// A minimal glb: a JSON chunk only.
function glbOf(json) {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (enc.length % 4)) % 4, len = enc.length + pad;
  const buf = new Uint8Array(20 + len);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, buf.length, true);
  dv.setUint32(12, len, true); dv.setUint32(16, 0x4e4f534a, true);
  buf.set(enc, 20); buf.fill(0x20, 20 + enc.length);
  return buf;
}
const goodGlb = () => glbOf({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'], nodes: [{ name: 'LOD0' }, { name: 'LOD1' }], materials: [{ name: 'paint' }, { name: 'glass' }] });

describe('forge gate', () => {
  it('passes a model that fits its slot', () => {
    const v = gate(goodReport(), S, goodGlb());
    expect(v.failures).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it('refuses a model over its triangle budget', () => {
    const r = goodReport(); r.lod0.tris = S.budgets[0] + 1;
    expect(gate(r, S, goodGlb()).failures.join()).toMatch(/LOD0: .* over the budget/);
  });
  it('refuses a model that does not fill the sim\'s box, floats, or is off centre', () => {
    const r = goodReport(); r.lod0.bounds = { min: [-1, -2.0, 0.05], max: [1, 2.8, 1.44] };
    const f = gate(r, S, goodGlb()).failures.join('\n');
    expect(f).toMatch(/length/);
    expect(f).toMatch(/ground/);
    expect(f).toMatch(/centred/);
    const w = goodReport(); w.lod0.bounds = { min: [-1.3, -2.36, 0], max: [1.3, 2.36, 1.44] };
    expect(gate(w, S, goodGlb()).failures.join()).toMatch(/width/);
  });
  it('refuses open shells, lettering and emblems, fonts and images', () => {
    const r = goodReport();
    Object.assign(r.lod0, { nonManifoldEdges: 500, glyphClusterCount: 2, fonts: 1 });
    r.outlineFlags = [{ part: 'panel', span: 0.2, concave: 9 }];
    const f = gate(r, S, glbOf({ images: [{}], nodes: [{ name: 'LOD0' }, { name: 'LOD1' }], extensionsUsed: ['EXT_meshopt_compression'] })).failures.join('\n');
    expect(f).toMatch(/non-manifold/);
    expect(f).toMatch(/lettering/);
    expect(f).toMatch(/emblem-like/);
    expect(f).toMatch(/fonts 1/);
    expect(f).toMatch(/images/);
  });
  it('refuses a glb without its LODs, without meshopt, or with a material outside the palette', () => {
    const f = gate(goodReport(), S, glbOf({ nodes: [{ name: 'LOD0' }], materials: [{ name: 'chrome-logo' }] })).failures.join('\n');
    expect(f).toMatch(/no LOD1/);
    expect(f).toMatch(/meshopt/);
    expect(f).toMatch(/outside the palette/);
  });
  it('reports a failed build as a failure', () => {
    expect(gate({ ok: false, error: 'boom', scriptProblems: ['line 1: `open` is not available'] }, S, null).failures).toEqual(['build failed: boom', 'line 1: `open` is not available']);
  });
});

describe('real names are screened out (AGENTS.md 3.7)', () => {
  it('catches makes, models and film vehicles, as words', () => {
    expect(bannedIn('a Tesla Model 3 in gold')).toEqual(expect.arrayContaining(['tesla', 'model 3']));
    expect(bannedIn('the Batmobile from the 89 film')).toContain('batmobile');
    expect(bannedIn('a DeLorean with gull wings')).toContain('delorean');
  });
  it('lets tropes and eras through', () => {
    expect(bannedIn('an 80s rally hatch with light pods')).toEqual([]);
    expect(bannedIn('a cyberpunk courier van, 2080s')).toEqual([]);
    expect(bannedIn('a 70s wedge supercar with pop-up lamps')).toEqual([]);
  });
});

describe('the brief prompt', () => {
  const src = readFileSync('tools/forge/blender/forgekit.py', 'utf8');
  it('documents the kit from its own source, public methods only', () => {
    const { methods, palette } = kitReference(src);
    for (const m of ['kit.body(', 'kit.project(', 'kit.strip(', 'kit.wheel(', 'kit.axle_wheels(', 'kit.arches(', 'kit.boolean(', 'kit.bevel(']) expect(methods).toContain(m);
    expect(methods).not.toMatch(/kit\._/);
    expect(palette).toEqual(expect.arrayContaining(['paint', 'glass', 'lamp_white', 'rubber']));
  });
  it('says tropes and eras only, no text, no logos, no real names', () => {
    expect(RULES).toMatch(/TROPES AND ERAS only/);
    expect(RULES).toMatch(/logo/);
    expect(RULES).toMatch(/lettering/);
    expect(RULES).toMatch(/import math` is the only import/);
  });
  it('takes the script out of a reply and asks for a fix with the gate\'s words', () => {
    expect(scriptFrom('A hatch.\n```python\ndef build(kit, spec, rng):\n    pass\n```\n')).toBe('def build(kit, spec, rng):\n    pass\n');
    expect(scriptFrom('no code here')).toBe(null);
    expect(repairPrompt(['width 2 m is 110 %'], 'Traceback')).toMatch(/width 2 m[\s\S]*Traceback/);
  });
  it('sends no absolute path (home folder, user name) back to the model in a traceback', async () => {
    const { scrub } = await import('../../tools/forge/lib/prompt.mjs');
    const t = scrub('File "/Users/someone/Desktop/projects/x/tools/forge/blender/forgekit.py", line 3, in body');
    expect(t).not.toMatch(/someone|Users|Desktop/);
    expect(t).toMatch(/forgekit\.py/);
    expect(repairPrompt(['x'], 'File "/home/someone/a/run.py"')).not.toMatch(/someone/);
  });
  it('ships the example script with no imports but math and no real names', () => {
    const ex = readFileSync('tools/forge/briefs/example-rally-hatch/build.py', 'utf8');
    expect(ex).toMatch(/def build\(kit, spec, rng\):/);
    expect([...ex.matchAll(/^\s*(?:import|from) (\S+)/gm)].map((m) => m[1])).toEqual(['math']);
    expect(bannedIn(ex)).toEqual([]);
  });
});
