// The Pickup: an unpainted stainless monocoque drawn as flat panels. Its side elevation is one
// triangle: a straight line from the nose's light bar up the hood and screen to a roof apex over
// the rear doors, and one straight line down from there over the covered bed to the tailgate.
// Flat flanks with a sharp crease at the waist, a narrow roof, trapezoidal black arch flares
// around angular wheel openings, a full-width light bar on the nose's leading edge and another on
// the tailgate. Our own design, sized to the researched numbers (docs/VEHICLES.md).
import * as THREE from 'three';
import { facets, mirrorPoly, strip, path, axleWheels, MAT, LAMP, Parts, setFlat } from './kit.js';

export function pickup(spec) {
  const g = new THREE.Group();
  const L = spec.l, H = spec.h, hw = spec.w / 2, r = spec.tyreR;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, ra = spec.axles[1].at;
  const zApex = ra + 1.2;                       // roof apex: over the rear door's back edge
  const noseY = 1.02, tailY = 1.28, sill = 0.5;  // light-bar edge, tailgate top, body underside
  const zWs = fa - 0.34;                        // screen base (the hood is short and flat)
  const lin = (a, b, t) => a + (b - a) * t;
  // The silhouette's top.
  const top = (z) => (z >= zApex ? lin(H, noseY + 0.04, (z - zApex) / (zf - 0.05 - zApex)) : lin(tailY, H, (z - zr) / (zApex - zr)));
  // Arches: angular openings (trapezoids) around each wheel.
  const archTop = 2 * r + 0.08, archHalf = r + 0.2, archFoot = r + 0.42;
  const botAt = (z) => {
    let y = sill;
    for (const a of spec.axles) {
      const d = Math.abs(z - a.at);
      if (d < archHalf) y = Math.max(y, archTop);
      else if (d < archFoot) y = Math.max(y, lin(archTop, sill, (d - archHalf) / (archFoot - archHalf)));
    }
    return y;
  };
  // Half-section on the left (+x): bottom centre → sill corner → flank → waist crease → roof edge → roof centre.
  const half = (z) => {
    const t = top(z), b = botAt(z);
    const waist = Math.min(t - 0.03, 1.2);
    const lean = Math.max(0, t - waist) * 0.62;          // the glasshouse leans in above the waist
    const w = hw - (z > zf - 0.5 ? (z - (zf - 0.5)) * 0.1 : 0) - (z < zr + 0.3 ? (zr + 0.3 - z) * 0.05 : 0);
    return [[0, b], [w - 0.06, b], [w, b + 0.06], [w, waist], [w - lean, t - 0.02], [w - lean - 0.05, t], [0, t]];
  };
  const full = (z) => mirrorPoly(half(z));
  // Stations: every corner of the elevation gets one, so straight panels meet in crisp creases.
  const zs = new Set([zr, zr + 0.02, zr + 0.3, zApex, zWs, zf - 0.5, zf - 0.13, zf - 0.04, zf]);
  for (const a of spec.axles) for (const d of [-archFoot, -archHalf, archHalf, archFoot]) zs.add(a.at + d);
  const stations = [...zs].sort((a, b) => a - b).map((z) => ({ z, poly: full(z) }));
  // The nose: the light-bar edge is the forward-most line; below it the fascia slopes back.
  const nose = stations.at(-1);
  nose.poly = nose.poly.map(([x, y]) => [x * 0.97, Math.max(noseY - 0.02, Math.min(noseY + 0.02, y))]);
  const n2 = stations.at(-2);
  n2.poly = n2.poly.map(([x, y]) => [x, Math.max(y, 0.86)]);
  // The tail: the tailgate is a flat vertical face (the first station closes it).
  const body = new THREE.Mesh(setFlat(facets(stations)), MAT.stainless);
  body.name = 'body';
  g.add(body);

  // The glasshouse: the same panels, a few millimetres proud, from the screen base to the C-pillar,
  // above the waist crease (windscreen, glass roof, side glass).
  const zC = zApex - 0.12;
  const gl = [];
  for (const z of [zC, zC + 0.02, zApex, zWs + 0.01]) {
    const h = half(z), t = top(z), waist = Math.min(t - 0.03, 1.2);
    if (t - waist < 0.02) { gl.push({ z, poly: null }); continue; }
    const up = h.slice(3).map(([x, y]) => [x + 0.006, y + 0.006]);     // waist → roof centre
    const ring = [[0, waist - 0.02], [h[3][0] - 0.05, waist - 0.02], ...up];
    gl.push({ z, poly: mirrorPoly(ring) });
  }
  const ok = gl.filter((s) => s.poly);
  const glass = new THREE.Mesh(setFlat(facets(ok)), MAT.glass);
  glass.name = 'glass';
  g.add(glass);

  const parts = new Parts();
  const T = [body, glass];
  // Light bars: across the nose's leading edge, and along the tailgate's top edge (wrapping onto
  // the vault's rear corners).
  parts.add(LAMP.white, strip(T, path([[-hw * 0.94, noseY, 4], [hw * 0.94, noseY, 4]], 30), [0, 0, -1], 0.012));
  parts.add(LAMP.red, strip(T, path([[-hw * 0.96, tailY - 0.06, -5], [hw * 0.96, tailY - 0.06, -5]], 30), [0, 0, 1], 0.02));
  parts.add(MAT.trim, strip(T, path([[-hw * 0.92, 0.62, -5], [hw * 0.92, 0.62, -5]], 8), [0, 0, 1], 0.07));     // rear step / bumper shadow
  parts.add(MAT.trim, strip(T, path([[-hw * 0.9, 0.62, 5], [hw * 0.9, 0.62, 5]], 8), [0, 0, -1], 0.09));         // lower fascia
  // Black arch flares: a flat band around each angular opening, standing proud of the flank.
  for (const a of spec.axles) {
    for (const sx of [-1, 1]) {
      const outline = [[a.at - archFoot - 0.06, sill], [a.at - archHalf - 0.04, archTop + 0.05], [a.at + archHalf + 0.04, archTop + 0.05], [a.at + archFoot + 0.06, sill]];
      const pts = [], idx = [];
      for (let i = 0; i < outline.length; i++) {
        const [z, y] = outline[i];
        const inner = i === 0 || i === 3 ? [z + (i === 0 ? 0.1 : -0.1), y] : [z + (i === 1 ? 0.06 : -0.06), y - 0.08];
        pts.push(sx * (hw + 0.02), y, z, sx * (hw + 0.02), inner[1], inner[0]);
        pts.push(sx * (hw - 0.03), y, z);
        if (i) { const b = (i - 1) * 3; idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 2, b + 5, b, b, b + 5, b + 3); }
      }
      const f = new THREE.BufferGeometry();
      f.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      f.setIndex(sx > 0 ? idx : idx.map((v, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]));
      f.computeVertexNormals();
      parts.add(MAT.trim, f);
    }
  }
  // Wells and underside.
  for (const a of spec.axles) parts.box(MAT.trim, [a.track - spec.tyreW - 0.06, archTop - r * 0.5, 2 * archHalf], [0, (archTop + r * 0.5) / 2 + 0.02, a.at]);
  parts.box(MAT.chassis, [spec.w * 0.84, 0.18, L * 0.7], [0, spec.clearance + 0.12, 0]);
  // Mirrors: small angular pods on the doors, just behind the screen base.
  for (const sx of [-1, 1]) parts.box(MAT.stainless, [spec.wMirrors / 2 - hw + 0.02, 0.1, 0.16], [sx * (hw + (spec.wMirrors / 2 - hw) / 2), 1.24, zWs - 0.22], [0, 0, sx * 0.1]);
  parts.build(g, { name: spec.id });
  g.add(axleWheels(spec, { style: 'facet' }));
  return g;
}
