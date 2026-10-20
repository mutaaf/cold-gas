// The Crossover: a tall five-door fastback with a glass roof. A smooth, grille-less nose under a
// thin full-width light bar (the headlamps sit low in the bumper corners), a high beltline, a long
// roof that falls into a sloped liftgate with a small spoiler lip, and a full-width red bar across
// the liftgate above a black lower bumper. Our own design, sized to the researched numbers
// (docs/VEHICLES.md).
import { curve, MAT, LAMP } from './kit.js';
import { smoothCar, frontStrip, rearStrip, sideStrip, band } from './smooth.js';

export function crossover(spec, color) {
  const L = spec.l, H = spec.h, hw = spec.w / 2;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, ra = spec.axles[1].at;
  const top = curve([[zr, 0.96], [zr + 0.08, 1.04], [zr + 0.3, 1.07], [ra + 0.4, 1.06], [fa - 0.62, 1.0], [fa - 0.2, 0.9], [zf - 0.35, 0.82], [zf - 0.08, 0.72], [zf, 0.58]]);
  const bot = curve([[zr, 0.46], [zr + 0.3, 0.3], [ra, 0.24], [0, spec.clearance + 0.03], [fa, 0.24], [zf - 0.25, 0.25], [zf, 0.38]]);
  const sh = curve([[zr, 0.74], [ra, 0.78], [0, 0.76], [fa, 0.76], [zf, 0.56]]);
  const half = curve([[zr, hw * 0.82], [zr + 0.35, hw * 0.98], [ra, hw], [0, hw * 0.99], [fa, hw * 0.99], [zf - 0.35, hw * 0.94], [zf, hw * 0.76]]);
  const gz0 = zr + 0.22, gz1 = fa - 0.58;
  const gTop = curve([[gz0, 1.05], [gz0 + 0.2, 1.38], [gz0 + 0.5, 1.52], [gz0 + 1.3, H - 0.01], [gz0 + 2.3, H], [gz1 - 0.42, 1.38], [gz1, 1.02]]);
  const gHw = curve([[gz0, hw * 0.74], [gz0 + 0.35, hw * 0.86], [0, hw * 0.9], [gz1 - 0.25, hw * 0.88], [gz1, hw * 0.74]]);
  return smoothCar(spec, {
    body: (z) => ({ top: top(z), bot: bot(z), sh: sh(z), hw: half(z), tt: 0.14, tb: 0.1, n: 3.6, nb: 3.4 }),
    glass: (z) => ({ top: gTop(z), bot: top(z) - 0.05, sh: top(z) + 0.02, hw: gHw(z), tt: 0.22, tb: 0, n: 3.2, nb: 4 }),
    glassZ: [gz0, gz1],
    mirrors: { z: gz1 - 0.14, y: 1.08, reach: spec.wMirrors / 2 },
    wheelStyle: 'aero',
    lamps(add, t) {
      // A thin full-width light bar along the nose's upper edge; headlamps low in the corners.
      add(MAT.gloss, band(frontStrip, t, -hw * 0.9, hw * 0.9, 0.79, 0.022));
      add(LAMP.white, frontStrip(t, -hw * 0.88, hw * 0.88, 0.79, 0.008));
      for (const s of [-1, 1]) {
        add(MAT.gloss, band(frontStrip, t, s * hw * 0.58, s * hw * 0.86, 0.6, 0.04));
        add(LAMP.white, frontStrip(t, s * hw * 0.62, s * hw * 0.84, 0.61, 0.012));
      }
      // Full-width tail bar across the liftgate, wrapping into the corners.
      add(MAT.gloss, band(rearStrip, t, -hw * 0.93, hw * 0.93, 0.9, 0.045));
      add(LAMP.red, rearStrip(t, -hw * 0.91, hw * 0.91, 0.91, 0.013));
      for (const s of [-1, 1]) {
        add(LAMP.red, rearStrip(t, s * hw * 0.62, s * hw * 0.93, 0.89, 0.028));
        add(LAMP.red, sideStrip(t, zr + 0.04, zr + 0.3, 0.9, 0.02, s));
      }
      add(MAT.trim, band(rearStrip, t, -hw * 0.85, hw * 0.85, 0.42, 0.09));
      add(MAT.trim, band(frontStrip, t, -hw * 0.5, hw * 0.5, 0.36, 0.04));
      // Black lower cladding along the sills.
      for (const s of [-1, 1]) add(MAT.trim, band(sideStrip, t, ra + 0.48, fa - 0.48, 0.32, 0.05, s));
    },
  }, color);
}
