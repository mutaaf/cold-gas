// The Pickup: a full-size electric crew-cab pickup drawn the conventional way (the forge's pickup,
// tools/forge/archetypes/pickup.py, drawn procedurally until it loads or with ?forge=0): a long flat
// hood over the fenders' shoulder, a blanked grille panel between two separate headlamps, a bumper
// under it, a four-door cab with a body-colour roof and B-pillar, and a separate open bed behind it
// with its rails, a tailgate seam and tall lamps at the bed's corners. Round satin wheel lips,
// painted in the slot's colour. Our own design, sized to the researched numbers (docs/VEHICLES.md).
import * as THREE from 'three';
import { curve, sweep, paint, patch, strip, path, MAT, LAMP } from './kit.js';
import { smoothCar, frontStrip, rearStrip, band } from './smooth.js';

export function pickup(spec, color) {
  const L = spec.l, H = spec.h, hw = spec.w / 2, r = spec.tyreR;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, ra = spec.axles[1].at;
  const rail = 1.3, cabBack = -0.66;
  const gz0 = cabBack + 0.02, gz1 = 1.0;          // the greenhouse: cab back wall → the windshield's foot
  // The lower body, nose → tail: the hood's line, the belt along the cab, the bed's rails.
  const top = curve([[zr, rail - 0.02], [zr + 0.08, rail], [cabBack - 0.05, rail], [cabBack + 0.05, 1.27], [gz1 - 0.1, 1.29], [gz1 + 0.2, 1.3], [zf - 0.3, 1.24], [zf - 0.06, 1.18], [zf, 1.1]]);
  const bot = curve([[zr, 0.5], [zr + 0.12, 0.4], [ra, spec.clearance + 0.02], [fa, spec.clearance + 0.02], [zf - 0.25, 0.36], [zf, 0.5]]);
  const sh = curve([[zr, 1.0], [0, 1.02], [zf - 0.3, 1.0], [zf, 0.92]]);
  const half = curve([[zr, hw * 0.97], [zr + 0.12, hw], [fa, hw], [zf - 0.2, hw * 0.97], [zf, hw * 0.9]]);
  const gTop = curve([[gz0, H - 0.05], [gz0 + 0.08, H - 0.012], [0.3, H - 0.02], [0.55, 1.66], [gz1, 1.3]]);
  const gHw = curve([[gz0, hw * 0.8], [0, hw * 0.79], [gz1 - 0.2, hw * 0.8], [gz1, hw * 0.84]]);
  const body = paint(color, { metal: 0.6, rough: 0.3, coat: 1 });
  return smoothCar(spec, {
    paint: body,
    segZ: 60, segR: 40, round: 0.06, glassRound: 0.04,
    body: (z) => ({ top: top(z), bot: bot(z), sh: sh(z), hw: half(z), tt: 0.04, tb: 0.04, n: 7, nb: 6 }),
    glass: (z) => ({ top: gTop(z), bot: top(z) - 0.05, sh: top(z) + 0.02, hw: gHw(z), tt: 0.1, tb: 0, n: 6, nb: 4 }),
    glassZ: [gz0, gz1],
    mirrors: { z: gz1 - 0.12, y: 1.4, reach: spec.wMirrors / 2, size: [0.14, 0.17, 0.1] },
    wheelStyle: 'steel',
    wheelMats: { rim: MAT.rimSilver },
    lamps(add, t) {
      // The grille panel between the headlamps, a running-light line over each lamp, the bumper and its intake.
      add(MAT.gloss, patch(t, (u, v) => [-0.62 + u * 1.24, 0.8 + v * 0.3, 6], [0, 0, -1], 6, 3, 0.004));
      for (const s of [-1, 1]) {
        add(MAT.gloss, patch(t, (u, v) => [s * (0.66 + u * 0.29), 0.92 + v * 0.17, 6], [0, 0, -1], 3, 2, 0.004));
        add(LAMP.white, frontStrip(t, s * 0.68, s * 0.93, 1.067, 0.01));
        add(LAMP.white, frontStrip(t, s * 0.72, s * 0.84, 0.97, 0.025));
        // Tall tail lamps at the bed's corners, a reverse lamp at their foot.
        add(MAT.gloss, strip(t, path([[s * 0.92, 0.84, -6], [s * 0.92, 1.24, -6]], 4), [0, 0, 1], 0.06, { lift: 0.003, across: [1, 0, 0] }));
        add(LAMP.red, strip(t, path([[s * 0.92, 1.0, -6], [s * 0.92, 1.2, -6]], 4), [0, 0, 1], 0.03, { lift: 0.008, across: [1, 0, 0] }));
        add(LAMP.white, strip(t, path([[s * 0.92, 0.88, -6], [s * 0.92, 0.94, -6]], 2), [0, 0, 1], 0.025, { lift: 0.008, across: [1, 0, 0] }));
      }
      add(MAT.trim, band(frontStrip, t, -hw * 0.98, hw * 0.98, 0.6, 0.15));
      add(MAT.gloss, frontStrip(t, -0.65, 0.65, 0.6, 0.035, 0.012));
      // The tailgate's seam and handle; the rear bumper.
      add(MAT.trim, rearStrip(t, -0.83, 0.83, 0.62, 0.005, 0.003));
      add(MAT.trim, rearStrip(t, -0.13, 0.13, rail - 0.12, 0.025, 0.006));
    },
    extra(parts, t, s2, c) {
      // The open bed: its dark floor seen through the rails, the cab's back wall above it, rail caps.
      const bz0 = cabBack - 0.06, bz1 = zr + 0.07, bw = hw - 0.07;
      parts.box(MAT.trim, [bw * 2, 0.02, bz0 - bz1], [0, rail + 0.004, (bz0 + bz1) / 2]);
      for (const s of [-1, 1]) parts.box(MAT.trim, [0.09, 0.025, bz0 - bz1 + 0.1], [s * (hw - 0.045), rail + 0.01, (bz0 + bz1) / 2]);
      // The body-colour roof over the glass (its rails just inboard of the glass's shoulder), and the B-pillar.
      const roofZ0 = gz0 + 0.02, roofZ1 = 0.42;
      parts.add(body, sweep((z) => ({ top: gTop(z) + 0.012, bot: gTop(z) - 0.06, sh: gTop(z) - 0.03, hw: gHw(z) * 0.93, tt: 0.08, tb: 0, n: 5, nb: 6 }), { z0: roofZ0, z1: roofZ1, segZ: 14, segR: 24, round: 0.03 }));
      for (const s of [-1, 1]) parts.box(body, [0.03, 0.42, 0.12], [s * hw * 0.82, 1.5, -0.08]);
      // The rear bumper, running boards, round satin wheel lips.
      parts.box(MAT.rimSilver, [1.7, 0.16, 0.16], [0, 0.5, zr + 0.04]);
      for (const s of [-1, 1]) parts.box(MAT.trim, [0.14, 0.045, 1.5], [s * (hw - 0.07), spec.clearance + 0.12, 0.18]);
      for (const a of spec.axles) {
        for (const s of [-1, 1]) {
          const lip = new THREE.TorusGeometry(r + 0.065, 0.03, 4, 16, Math.PI);
          lip.rotateY(Math.PI / 2); lip.translate(s * (hw + 0.004), r, a.at);
          parts.add(MAT.trim, lip);
        }
      }
    },
  }, color);
}
