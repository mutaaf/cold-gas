// The Semi: an electric day-cab tractor, 6x4, parked without a trailer. A flat-fronted cab-over with a little rake
// (the forge's semi, tools/forge/archetypes/semi.py, drawn procedurally until it loads or with ?forge=0): a split
// two-pane windshield on a centre post under a sun visor, separate headlamp clusters with an L-shaped running light, a
// blanked front panel with cooling slats, a step bumper; a window in the door over the steer axle, two treads behind
// the wheel, mirror heads on arms; a roof fairing up to 4.11 m, battery packs strapped between the axles under a side
// fairing, a bare frame behind the cab carrying the fifth wheel, twin tyres on both drive axles, quarter fenders and
// mud flaps. Our own design, sized to the researched numbers (docs/VEHICLES.md).
import * as THREE from 'three';
import { curve, sweep, strip, patch, path, axleWheels, paint, MAT, LAMP, Parts } from './kit.js';

export function semi(spec, color) {
  const g = new THREE.Group();
  const L = spec.l, H = spec.h, hw = spec.w / 2, r = spec.tyreR;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, d1 = spec.axles[1].at, d2 = spec.axles[2].at;
  const cw = hw * 0.965;                       // the cab's half-width
  const zBack = fa - 0.91;                     // cab back wall
  const zFront = zf - 0.02;                    // the cab's face (the bumper stands proud of it)
  const body = paint(color, { metal: 0.2, rough: 0.3, coat: 1 });

  // --- The cab: a near-box swept from the back wall to the raked face ------------------------------
  const top = curve([[zBack, 3.15], [zBack + 0.1, 3.21], [zFront - 0.3, 3.2], [zFront - 0.14, 3.12], [zFront - 0.06, 2.8], [zFront - 0.02, 2.35], [zFront, 1.95]]);
  const bot = curve([[zBack, 1.07], [zBack + 0.1, 1.05], [fa + 0.31, 1.02], [fa + 0.59, 0.6], [zFront, 0.62]]);
  const cab = new THREE.Mesh(sweep((z) => ({ top: top(z), bot: bot(z), sh: 1.8, hw: cw, tt: 0.05, tb: 0.02, n: 8, nb: 8 }), {
    z0: zBack, z1: zFront, segZ: 30, segR: 40, round: 0.05, arches: [{ z: fa, r: r + 0.06, top: 2 * r + 0.06 }],
  }), body);
  cab.name = 'body';
  g.add(cab);
  // The roof fairing, rising from the windshield's header to the box's height at the cab's back.
  const fTop = curve([[zBack + 0.02, H - 0.04], [zBack + 0.12, H - 0.01], [1.6, 3.98], [2.3, 3.58], [zFront - 0.36, 3.24]]);
  const fHw = curve([[zBack + 0.02, cw * 0.95], [1.6, cw * 0.95], [2.3, cw * 0.9], [zFront - 0.36, cw * 0.78]]);
  g.add(new THREE.Mesh(sweep((z) => ({ top: fTop(z), bot: 3.1, sh: 3.3, hw: fHw(z), tt: 0.18, tb: 0, n: 3.4, nb: 6 }), {
    z0: zBack + 0.02, z1: zFront - 0.36, segZ: 20, segR: 28, round: 0.06,
  }), body));
  const T = [cab];
  const parts = new Parts();

  // Glazing: two windshield panes on a black surround (the post between them), a window in each door.
  parts.add(MAT.trim, patch(T, (u, v) => [-1.16 + u * 2.32, 2.1 + v * 0.94, 6], [0, 0, -1], 12, 5, 0.004));
  for (const s of [-1, 1]) {
    parts.add(MAT.glass, patch(T, (u, v) => [s * (0.045 + u * 1.06), 2.15 + v * 0.84, 6], [0, 0, -1], 8, 5, 0.008));
    parts.box(MAT.trim, [0.86, 0.022, 0.016], [s * 0.55, 2.2, zFront + 0.01], [0, 0, s * 0.1]);   // wiper
    parts.add(MAT.glass, patch(T, (u, v) => [s * 4, 2.15 + v * 0.76, fa - 0.54 + u * 0.95], [-s, 0, 0], 6, 4, 0.008));
    // Mirror heads on two arms, out to the spec's width at the arms.
    const reach = spec.wMirrors / 2 - 0.035, zm = zFront - 0.16;
    for (const y of [2.85, 2.2]) parts.box(MAT.trim, [reach - cw + 0.06, 0.035, 0.04], [s * (cw + (reach - cw) / 2 - 0.02), y, zm]);
    parts.box(MAT.trim, [0.07, 0.4, 0.11], [s * reach, 2.6, zm - 0.04]);
    parts.box(MAT.trim, [0.07, 0.17, 0.11], [s * reach, 2.24, zm - 0.04]);
    // Door handle, grab bar, two treads behind the steer wheel.
    parts.box(MAT.trim, [0.02, 0.035, 0.22], [s * (cw + 0.005), 1.98, fa - 0.44]);
    parts.box(MAT.steel, [0.03, 1.0, 0.03], [s * (cw + 0.03), 2.05, fa - 0.75]);
    parts.box(MAT.chassis, [0.34, 0.66, 0.44], [s * (cw - 0.2), 0.76, fa - 0.74]);
    for (const y of [0.56, 0.86]) parts.box(MAT.steel, [0.36, 0.032, 0.42], [s * (cw - 0.17), y, fa - 0.74]);
    // Headlamp clusters: a dark housing, two projectors under an L-shaped running light, the turn lamp outboard.
    parts.add(MAT.gloss, patch(T, (u, v) => [s * (0.6 + u * 0.54), 0.96 + v * 0.26, 6], [0, 0, -1], 4, 2, 0.004));
    parts.add(LAMP.white, strip(T, path([[s * 0.62, 1.18, 6], [s * 1.08, 1.18, 6]], 4), [0, 0, -1], 0.011, { lift: 0.008 }));
    parts.add(LAMP.white, strip(T, path([[s * 1.09, 1.17, 6], [s * 1.09, 1.01, 6]], 3), [0, 0, -1], 0.011, { lift: 0.008 }));
    for (const x of [0.74, 0.9]) parts.add(LAMP.white, strip(T, path([[s * (x - 0.03), 1.065, 6], [s * (x + 0.03), 1.065, 6]], 2), [0, 0, -1], 0.03, { lift: 0.008 }));
    parts.add(LAMP.amber, strip(T, path([[s * 1.15, 1.18, 6], [s * 1.15, 1.0, 6]], 3), [0, 0, -1], 0.022, { lift: 0.008 }));
    // Cab extender: a fin closing the gap behind the cab.
    parts.box(body, [0.03, 2.1, 0.4], [s * (cw - 0.02), 2.15, zBack - 0.18]);
  }
  // The blanked front panel with its slats, the sun visor, the step bumper with its treads and fog lamps.
  parts.add(MAT.gloss, patch(T, (u, v) => [-0.86 + u * 1.72, 1.32 + v * 0.56, 6], [0, 0, -1], 6, 3, 0.004));
  for (let k = 0; k < 5; k++) parts.box(MAT.trim, [1.6, 0.04, 0.03], [0, 1.4 + k * 0.105, zFront + 0.018]);
  parts.box(MAT.trim, [2.2, 0.035, 0.2], [0, 3.16, zFront - 0.06], [0.25, 0, 0]);
  parts.box(MAT.trim, [2.46, 0.42, 0.13], [0, 0.69, zf - 0.03]);
  parts.box(MAT.chassis, [2.3, 0.06, 0.09], [0, 0.47, zf - 0.03]);
  for (const s of [-1, 1]) {
    parts.box(MAT.steel, [0.42, 0.014, 0.11], [s * 0.62, 0.905, zf - 0.03]);
    parts.box(MAT.gloss, [0.2, 0.075, 0.012], [s * 0.98, 0.66, zf + 0.037]);
  }

  // --- Chassis ----------------------------------------------------------------------------------
  const rail = 0.43;                             // rails' half spacing (34" frame)
  for (const s of [-1, 1]) parts.box(MAT.chassis, [0.09, 0.3, zBack - zr + 0.4], [s * rail, 0.98, (zBack + zr) / 2 + 0.2]);
  for (const z of [zBack - 0.4, d1 + 0.4, d2 - 0.55]) parts.box(MAT.chassis, [rail * 2, 0.12, 0.08], [0, 0.98, z]);
  // Behind the cab: the power electronics box, two air tanks, the trailer lines' stand.
  parts.box(MAT.gloss, [1.6, 0.72, 0.42], [0, 1.5, zBack - 0.3]);
  for (const x of [-0.25, 0.25]) parts.cyl(MAT.steel, 0.13, 0.13, 0.75, [x, 0.72, zBack - 0.2], [Math.PI / 2, 0, 0], 12);
  parts.box(MAT.steel, [0.06, 0.95, 0.06], [0, 1.62, zBack - 0.6]);
  // Rear deck plate and the fifth wheel (a tilting steel plate with its throat), over the tandem.
  parts.box(MAT.steel, [rail * 2 + 0.1, 0.03, zBack - (d1 + 0.6)], [0, 1.15, (zBack + d1 + 0.6) / 2]);
  const fw = (d1 + d2) / 2 + 0.15;
  parts.cyl(MAT.chassis, 0.46, 0.46, 0.06, [0, 1.22, fw], [0, 0, 0], 28);
  parts.box(MAT.trim, [0.1, 0.07, 0.42], [0, 1.24, fw - 0.24]);
  parts.box(MAT.chassis, [0.9, 0.12, 0.5], [0, 1.13, fw]);
  // The battery packs between the steps and the tandem, strapped, under a body-colour side fairing.
  const fz0 = d1 + r + 0.1, fz1 = 0.94;
  for (const s of [-1, 1]) {
    parts.box(body, [0.05, 0.5, fz1 - fz0], [s * (cw - 0.05), 1.0, (fz0 + fz1) / 2]);
    for (let k = 0; k < 3; k++) parts.box(MAT.steel, [0.52, 0.44, 0.05], [s * (cw - 0.3), 0.52, fz1 - 0.3 - k * (fz1 - fz0 - 0.6) / 2]);
  }
  parts.box(MAT.chassis, [cw * 2 - 0.1, 0.42, fz1 - fz0 - 0.06], [0, 0.52, (fz0 + fz1) / 2]);
  // Quarter fenders over the front of each tandem wheel pair, and mud flaps behind the last axle.
  for (const s of [-1, 1]) {
    for (const a of [d1, d2]) {
      const fen = new THREE.CylinderGeometry(r + 0.08, r + 0.08, 0.62, 18, 1, true, 0, Math.PI * 0.62);
      fen.rotateZ(Math.PI / 2); fen.rotateX(-Math.PI * 0.12); fen.translate(s * spec.axles[1].track / 2, r, a);
      parts.add(MAT.trim, fen);
    }
    parts.box(MAT.trim, [0.62, 0.62, 0.02], [s * spec.axles[1].track / 2, 0.52, d2 - r - 0.2]);
    // Tail lamps on the frame's end, and their housing.
    parts.box(LAMP.redSolid, [0.26, 0.06, 0.03], [s * 0.72, 0.98, zr + 0.06]);
    parts.box(MAT.chassis, [0.4, 0.12, 0.05], [s * 0.72, 0.98, zr + 0.1]);
  }
  // The steer axle's wells, under the cab.
  parts.box(MAT.trim, [spec.axles[0].track - spec.tyreW - 0.1, 0.5, 2 * r + 0.1], [0, r + 0.3, fa]);
  parts.build(g, { name: spec.id });
  g.add(axleWheels(spec, { style: 'steel', mats: { rim: MAT.rimSilver } }));
  return g;
}
