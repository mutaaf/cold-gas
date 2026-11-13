// 0226: the forge's world props as the iPhone app reads them (ios/ColdGas/Resources/Props, written by
// `npm run forge -- <slot> --native`): each LOD file is exactly its vertices (44 bytes) and its triangles' indices, every
// index in range, every slot that names a native kind is there, LODs coarser and drawn further, colours in the palette's
// range and normals unit.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORLD_SLOTS } from '../../tools/forge/lib/slots.mjs';

const DIR = join(__dirname, '../../ios/ColdGas/Resources/Props');
const man = JSON.parse(readFileSync(join(DIR, 'props.json'), 'utf8'));

describe('the forged world props in the app', () => {
  it('has every world slot, under its native kind', () => {
    for (const s of Object.values(WORLD_SLOTS)) expect(man.kinds[s.native], s.id).toBeTruthy();
  });
  for (const [kind, lods] of Object.entries(man.kinds)) {
    it(`${kind}: well-formed LODs`, () => {
      let prevEnd = 0, prevTris = Infinity;
      for (const l of lods) {
        const buf = readFileSync(join(DIR, l.file));
        expect(buf.byteLength).toBe(l.vertices * 44 + l.triangles * 3 * 4);
        const f = new Float32Array(buf.buffer, buf.byteOffset, l.vertices * 11);
        const ix = new Uint32Array(buf.buffer.slice(buf.byteOffset + l.vertices * 44, buf.byteOffset + buf.byteLength));
        for (const i of ix) expect(i).toBeLessThan(l.vertices);
        for (let v = 0; v < l.vertices; v++) {
          const n = Math.hypot(f[v * 11 + 3], f[v * 11 + 4], f[v * 11 + 5]);
          expect(Math.abs(n - 1)).toBeLessThan(0.02);
          for (let c = 8; c < 11; c++) { expect(f[v * 11 + c]).toBeGreaterThanOrEqual(0); expect(f[v * 11 + c]).toBeLessThanOrEqual(1); }
        }
        expect(l.end).toBeGreaterThan(prevEnd);
        expect(l.triangles).toBeLessThanOrEqual(prevTris);
        prevEnd = l.end; prevTris = l.triangles;
      }
    });
  }
});
