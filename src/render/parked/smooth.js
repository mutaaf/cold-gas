// A smooth-bodied car from a design: a painted lower body and a glass greenhouse, each swept from
// profile curves, wheels at the researched axle positions, mirrors, and lamp strips laid on the
// body's surface. The sedan, the crossover and the cab are all designs for this builder.
import * as THREE from 'three';
import { sweep, strip, path, axleWheels, paint, MAT, LAMP, Parts } from './kit.js';

// spec: the LINEUP_SPEC entry (src/sim/courses.js): l, w, h, axles, tyreR, tyreW …
// design: {
//   body(z) → section, glass(z) → section, glassZ: [z0, z1],
//   lamps(add, body, spec) → void   (add(mat, geometry))
//   mirrors: { z, y, reach } | null, wheelStyle, rimMat, extra(parts, body, spec)
// }
export function smoothCar(spec, design, color) {
  const g = new THREE.Group();
  const L = spec.l, r = spec.tyreR;
  const axles = spec.axles;
  const arches = axles.map((a) => ({ z: a.at, r: r + 0.075, top: 2 * r + 0.045 }));
  const bodyGeo = sweep(design.body, { z0: -L / 2, z1: L / 2, segZ: design.segZ ?? 52, segR: design.segR ?? 36, arches, round: design.round ?? 0.14 });
  const shell = new THREE.Mesh(bodyGeo, design.paint || paint(color));
  shell.name = 'body';
  g.add(shell);
  const glassGeo = sweep(design.glass, { z0: design.glassZ[0], z1: design.glassZ[1], segZ: 36, segR: 32, round: design.glassRound ?? 0.1 });
  const glass = new THREE.Mesh(glassGeo, MAT.glass);
  glass.name = 'glass';
  g.add(glass);

  const parts = new Parts();
  // The wheel tubs: dark wells so the arches never show daylight through the car.
  const trackIn = Math.min(...axles.map((a) => a.track)) / 2 - spec.tyreW / 2 - 0.02;
  for (const a of axles) parts.box(MAT.trim, [trackIn * 2 + 0.02, r * 1.1, 2 * r + 0.12], [0, r * 1.15, a.at]);
  parts.box(MAT.trim, [spec.w * 0.86, 0.06, L * 0.62], [0, spec.clearance + 0.05, 0]);   // floor pan
  // Mirrors: a body-colour shell on a short black stalk.
  if (design.mirrors) {
    const { z, y, reach, size = [0.2, 0.11, 0.1] } = design.mirrors;
    for (const sx of [-1, 1]) {
      const m = new THREE.SphereGeometry(0.5, 14, 8);
      m.scale(size[0], size[1], size[2]);
      m.translate(sx * (reach - size[0] / 2), y, z);
      parts.add(design.paint || paint(color), m);
      parts.box(MAT.trim, [reach - spec.w / 2 + 0.06, 0.025, 0.05], [sx * (spec.w / 2 + (reach - spec.w / 2) / 2 - 0.04), y - 0.03, z + 0.01]);
    }
  }
  design.lamps?.((mat, geo) => parts.add(mat, geo), [shell, glass], spec);
  design.extra?.(parts, [shell, glass], spec, color);
  parts.build(g, { name: spec.id });

  g.add(axleWheels(spec, { style: design.wheelStyle || 'aero', mats: design.wheelMats }));
  return g;
}

// Helpers for designs.
export const across = (x0, x1, y, z, n = 10) => path([[x0, y, z], [x1, y, z]], n);
// A strip across the front (rays toward −z) or the rear (rays toward +z) at height y. Lamps sit
// proud of any dark surround laid under them (lift), so the two never fight for depth.
export function frontStrip(targets, x0, x1, y, halfW, lift = 0.008) {
  return strip(targets, across(x0, x1, y, 6, 16), [0, 0, -1], halfW, { lift });
}
export function rearStrip(targets, x0, x1, y, halfW, lift = 0.008) {
  return strip(targets, across(x0, x1, y, -6, 16), [0, 0, 1], halfW, { lift });
}
// Along the side (rays toward −x from the left, mirrored for the right): z0 → z1 at height y.
export function sideStrip(targets, z0, z1, y, halfW, sx = 1, lift = 0.008) {
  return strip(targets, path([[sx * 4, y, z0], [sx * 4, y, z1]], 8), [-sx, 0, 0], halfW, { lift });
}
// A dark band (trim, gloss black) under or around lamps: flush with the paint.
export const band = (fn, ...a) => (fn === sideStrip ? sideStrip(a[0], a[1], a[2], a[3], a[4], a[5] ?? 1, 0.003) : fn(...a.slice(0, 5), 0.003));
