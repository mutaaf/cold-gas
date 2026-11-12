// The forge's assets in the game (0212): what the manifest says is what's on disk, on our own origin, inside each slot's
// budgets, meshopt-compressed with its LODs, palette materials and no images; the flag's parsing.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { glbJson, bannedIn } from '../../tools/forge/lib/gate.mjs';
import { SLOTS } from '../../tools/forge/lib/slots.mjs';
import { forgeWanted, FORGE_DEFAULT_ON } from '../../src/render/forge-registry.js';
import MANIFEST from '../../src/render/forge-manifest.json';
import { LINEUP_SPEC } from '../../src/sim/courses.js';

describe('quantized geometry comes in as metres', () => {
  it('dequantizes int16 positions through the node matrix into floats past ±1 m (crash.js dents, the Sandbox merges)', async () => {
    const THREE = await import('three');
    const { floatGeometry } = await import('../../src/render/forged.js');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array([32767, 0, -32767, -32767, 16384, 32767, 0, 32767, 0]), 3, true));
    g.setIndex([0, 1, 2]);
    const p = floatGeometry(g, new THREE.Matrix4().makeScale(2.4, 2.4, 2.4)).getAttribute('position');
    expect(p.array).toBeInstanceOf(Float32Array);
    expect(p.normalized).toBe(false);
    expect(p.getX(0)).toBeCloseTo(2.4, 3);
    expect(p.getZ(1)).toBeCloseTo(2.4, 3);
  });
});

describe('the forged assets in the game (0212)', () => {
  const assets = Object.entries(MANIFEST.assets);
  it('fill slots the sim has, within each slot\'s budgets', () => {
    expect(assets.length).toBeGreaterThanOrEqual(5);
    for (const [slot, a] of assets) {
      expect(SLOTS[slot], slot).toBeTruthy();
      if (a.kind === 'vehicle') expect(LINEUP_SPEC.some((s) => s.id === slot)).toBe(true);
      SLOTS[slot].budgets.forEach((b, i) => expect(a.tris[i], `${slot} LOD${i}`).toBeLessThanOrEqual(b));
    }
  });
  it('are on our own origin, meshopt-compressed, with their LODs, palette materials and no images', () => {
    for (const [slot, a] of assets) {
      const path = `public/${a.file}`;
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBe(a.bytes);
      expect(a.file).toMatch(/^forge\/[a-z]+\.glb$/);   // relative: served under the base path, never a host
      const j = glbJson(readFileSync(path));
      expect(j.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(j.images ?? []).toEqual([]);
      const names = j.nodes.map((n) => n.name);
      SLOTS[slot].budgets.forEach((_, i) => expect(names).toContain(`LOD${i}`));
      for (const m of j.materials) expect(bannedIn(m.name)).toEqual([]);
      expect(a.bytes).toBeLessThanOrEqual(a.kind === 'vehicle' ? 420_000 : 60_000);
    }
  });
  it('are off unless asked for or the default says so', () => {
    expect(forgeWanted('?forge=1')).toBe(true);
    expect(forgeWanted('?forge=0')).toBe(false);
    expect(forgeWanted('?play=jump')).toBe(FORGE_DEFAULT_ON);
  });
});
