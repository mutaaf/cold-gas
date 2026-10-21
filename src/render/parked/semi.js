// The Semi: an electric day-cab tractor, 6x4, parked without a trailer. A tall bullet-nosed cab
// with the roof fairing built in (4.11 m at its crown), a wide wrap-around screen above a short
// sloping hood, a full-width light bar across the nose, small side windows, chassis fairings
// enclosing the battery between the steer axle and the tandem, a bare frame behind the cab
// carrying the fifth-wheel plate, twin tyres on both drive axles, quarter fenders and mud flaps.
// Our own design, sized to the researched numbers (docs/VEHICLES.md).
import * as THREE from 'three';
import { curve, sweep, strip, patch, path, axleWheels, paint, MAT, LAMP, Parts } from './kit.js';

export function semi(spec, color) {
  const g = new THREE.Group();
  const L = spec.l, H = spec.h, hw = spec.w / 2, r = spec.tyreR;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, d1 = spec.axles[1].at, d2 = spec.axles[2].at;
  const zBack = fa - 1.62;                     // cab back wall
  const body = paint(color, { metal: 0.2, rough: 0.3, coat: 1 });

  // --- The cab: one sweep from the back wall to the nose -----------------------------------------
  const top = curve([[zBack, H - 0.04], [zBack + 0.08, H], [zBack + 0.75, H - 0.02], [fa - 0.35, 3.62], [fa + 0.1, 3.08], [fa + 0.62, 2.18], [zf - 0.42, 1.72], [zf - 0.12, 1.5], [zf, 1.28]]);
  const bot = curve([[zBack, 0.95], [zBack + 0.3, 0.62], [fa - 0.6, 0.5], [fa, 0.5], [zf - 0.3, 0.4], [zf, 0.5]]);
  const sh = curve([[zBack, 2.1], [fa, 2.0], [zf - 0.4, 1.3], [zf, 0.95]]);
  const half = curve([[zBack, hw * 0.96], [zBack + 0.3, hw * 0.985], [fa, hw * 0.985], [zf - 0.55, hw * 0.93], [zf - 0.15, hw * 0.82], [zf, hw * 0.7]]);
  const tt = curve([[zBack, 0.1], [fa - 0.5, 0.14], [fa + 0.4, 0.3], [zf, 0.3]]);
  const cab = new THREE.Mesh(sweep((z) => ({ top: top(z), bot: bot(z), sh: sh(z), hw: half(z), tt: tt(z), tb: 0.02, n: 4.4, nb: 7 }), {
    z0: zBack, z1: zf, segZ: 52, segR: 48, round: 0.1, arches: [{ z: fa, r: r + 0.14, top: 2 * r + 0.1 }],
  }), body);
  cab.name = 'body';
  g.add(cab);
  const T = [cab];
  const parts = new Parts();

  // Glazing: the wrap-around screen and a small window in each door, laid onto the cab's surface.
  const ws = patch(T, (u, v) => [-hw * 0.86 + u * hw * 1.72, 2.2 + v * 0.95, 6], [0, 0, -1], 18, 8, 0.008);
  parts.add(MAT.glass, ws);
  for (const s of [-1, 1]) {
    parts.add(MAT.glass, patch(T, (u, v) => [s * 4, 2.3 + v * 0.62, fa - 0.95 + u * 0.75], [-s, 0, 0], 6, 4, 0.008));
    // Cab-side camera arms (no glass mirrors): a slim pod forward of the door.
    const reach = spec.wMirrors / 2;
    parts.box(MAT.trim, [reach - hw + 0.06, 0.05, 0.08], [s * (hw + (reach - hw) / 2 - 0.03), 2.45, fa + 0.38]);
    parts.box(body, [0.12, 0.3, 0.12], [s * (reach - 0.06), 2.45, fa + 0.38]);
    // Grab handle and a two-step ladder behind the steer wheel, under the door.
    parts.box(MAT.trim, [0.08, 0.42, 0.42], [s * (hw - 0.04), 0.72, fa - 0.82]);
    parts.box(MAT.steel, [0.03, 0.03, 0.36], [s * (hw + 0.01), 0.9, fa - 0.82]);
    parts.box(MAT.steel, [0.03, 0.03, 0.36], [s * (hw + 0.01), 0.58, fa - 0.82]);
  }
  // The nose: a full-width light bar on the hood's leading edge, the headlamps in its ends, a dark
  // lower intake, and five amber clearance lamps across the roof's leading edge.
  parts.add(MAT.gloss, strip(T, path([[-hw * 0.88, 1.38, 6], [hw * 0.88, 1.38, 6]], 30), [0, 0, -1], 0.05, { lift: 0.003 }));
  parts.add(LAMP.white, strip(T, path([[-hw * 0.86, 1.38, 6], [hw * 0.86, 1.38, 6]], 30), [0, 0, -1], 0.014, { lift: 0.008 }));
  for (const s of [-1, 1]) parts.add(LAMP.white, strip(T, path([[s * hw * 0.62, 1.37, 6], [s * hw * 0.84, 1.37, 6]], 8), [0, 0, -1], 0.035, { lift: 0.008 }));
  parts.add(MAT.trim, patch(T, (u, v) => [-hw * 0.6 + u * hw * 1.2, 0.62 + v * 0.38, 6], [0, 0, -1], 10, 3, 0.003));
  for (let k = -2; k <= 2; k++) parts.add(LAMP.amber, strip(T, path([[k * 0.32 - 0.05, 6, fa - 0.42], [k * 0.32 + 0.05, 6, fa - 0.42]], 2), [0, -1, 0], 0.02, { lift: 0.01 }));
  // Back wall lamps: two red markers high on the cab's back corners.
  for (const s of [-1, 1]) parts.add(LAMP.red, strip(T, path([[s * hw * 0.8, H - 0.3, zBack - 3], [s * hw * 0.8, H - 0.6, zBack - 3]], 3), [0, 0, 1], 0.02, { lift: 0.01 }));

  // --- Chassis ----------------------------------------------------------------------------------
  const rail = 0.43;                             // rails' half spacing (34" frame)
  for (const s of [-1, 1]) parts.box(MAT.chassis, [0.09, 0.3, zBack - zr + 0.4], [s * rail, 0.98, (zBack + zr) / 2 + 0.2]);
  for (const z of [zBack - 0.4, d1 + 0.4, d2 - 0.55]) parts.box(MAT.chassis, [rail * 2, 0.12, 0.08], [0, 0.98, z]);
  // Rear deck plate and the fifth wheel (a tilting steel plate with its throat), over the tandem.
  parts.box(MAT.steel, [rail * 2 + 0.1, 0.03, zBack - (d1 + 0.6)], [0, 1.15, (zBack + d1 + 0.6) / 2]);
  const fw = (d1 + d2) / 2 + 0.15;
  parts.cyl(MAT.chassis, 0.46, 0.46, 0.06, [0, 1.22, fw], [0, 0, 0], 28);
  parts.box(MAT.trim, [0.1, 0.07, 0.42], [0, 1.24, fw - 0.24]);
  parts.box(MAT.chassis, [0.9, 0.12, 0.5], [0, 1.13, fw]);
  // Chassis fairings: the battery enclosure between the steer wheels and the tandem, body colour.
  const fz0 = d1 + r + 0.2, fz1 = fa - r - 0.35;
  for (const s of [-1, 1]) {
    parts.box(body, [0.06, 0.78, fz1 - fz0], [s * (hw - 0.06), 0.72, (fz0 + fz1) / 2]);
    parts.box(MAT.trim, [0.065, 0.06, fz1 - fz0], [s * (hw - 0.058), 0.36, (fz0 + fz1) / 2]);
  }
  parts.box(MAT.chassis, [hw * 2 - 0.2, 0.7, fz1 - fz0], [0, 0.72, (fz0 + fz1) / 2]);       // the pack inside
  // Quarter fenders over the front of each tandem wheel pair, and mud flaps behind the last axle.
  for (const s of [-1, 1]) {
    for (const a of [d1, d2]) {
      const fen = new THREE.CylinderGeometry(r + 0.08, r + 0.08, 0.62, 18, 1, true, 0, Math.PI * 0.62);
      fen.rotateZ(Math.PI / 2); fen.rotateX(-Math.PI * 0.12); fen.translate(s * spec.axles[1].track / 2, r, a);
      parts.add(MAT.trim, fen);
    }
    parts.box(MAT.trim, [0.62, 0.62, 0.02], [s * spec.axles[1].track / 2, 0.52, d2 - r - 0.2]);
    // Tail lamps on the frame's end, and a light bar under them.
    parts.box(LAMP.redSolid, [0.26, 0.06, 0.03], [s * 0.72, 0.98, zr + 0.06]);
    parts.box(MAT.chassis, [0.4, 0.12, 0.05], [s * 0.72, 0.98, zr + 0.1]);
  }
  // Wells for the steer axle, and the cab's underside.
  parts.box(MAT.trim, [spec.axles[0].track - spec.tyreW - 0.1, 0.7, 2 * r + 0.25], [0, r + 0.25, fa]);
  parts.build(g, { name: spec.id });
  g.add(axleWheels(spec, { style: 'steel', mats: { rim: MAT.rimSilver } }));
  return g;
}
