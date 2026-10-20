// The Sedan: a low four-door fastback with a glass roof. Long cab, short rounded nose with no
// grille opening, slim swept headlamps set into the corners, a bulging rear haunch over the rear
// wheel, a short trunk lid with a lip, and wrap-around tail lamps. Our own design, sized to the
// researched class numbers (docs/VEHICLES.md).
import { curve } from './kit.js';
import { smoothCar, frontStrip, rearStrip, sideStrip, band } from './smooth.js';
import { MAT, LAMP } from './kit.js';

export function sedan(spec, color) {
  const L = spec.l, H = spec.h, hw = spec.w / 2;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, ra = spec.axles[1].at;
  // Side profile of the lower body (the paint): nose → tail is +z → −z.
  const top = curve([[zr, 0.88], [zr + 0.1, 0.96], [zr + 0.45, 0.99], [ra + 0.3, 0.97], [fa - 0.62, 0.93], [fa - 0.15, 0.8], [zf - 0.45, 0.72], [zf - 0.1, 0.62], [zf, 0.5]]);
  const bot = curve([[zr, 0.42], [zr + 0.25, 0.27], [ra, 0.2], [0, spec.clearance + 0.02], [fa, 0.2], [zf - 0.2, 0.22], [zf, 0.36]]);
  const sh = curve([[zr, 0.66], [ra, 0.71], [0, 0.69], [fa, 0.68], [zf, 0.48]]);
  const half = curve([[zr, hw * 0.8], [zr + 0.35, hw * 0.97], [ra, hw], [0, hw * 0.985], [fa, hw * 0.99], [zf - 0.35, hw * 0.93], [zf, hw * 0.74]]);
  // The greenhouse: screen base at the cowl, roof crown just behind the B-pillar, a long fastback.
  const gz0 = zr + 0.56, gz1 = fa - 0.6;
  const gTop = curve([[gz0, 0.99], [gz0 + 0.45, 1.2], [gz0 + 1.05, 1.38], [gz0 + 1.6, H], [gz0 + 2.0, H - 0.01], [gz1 - 0.38, 1.27], [gz1, 0.97]]);
  const gHw = curve([[gz0, hw * 0.7], [gz0 + 0.4, hw * 0.86], [0, hw * 0.92], [gz1 - 0.25, hw * 0.88], [gz1, hw * 0.74]]);
  return smoothCar(spec, {
    body: (z) => ({ top: top(z), bot: bot(z), sh: sh(z), hw: half(z), tt: 0.13, tb: 0.1, n: 3.6, nb: 3.2 }),
    glass: (z) => ({ top: gTop(z), bot: top(z) - 0.05, sh: top(z) + 0.02, hw: gHw(z), tt: 0.2, tb: 0, n: 3.8, nb: 4 }),
    glassZ: [gz0, gz1],
    mirrors: { z: gz1 - 0.12, y: 1.0, reach: spec.wMirrors / 2 },
    wheelStyle: 'aero',
    lamps(add, t) {
      // Slim headlamps: a swept slit on each front corner, with a fine lower accent.
      for (const s of [-1, 1]) {
        add(LAMP.white, frontStrip(t, s * hw * 0.5, s * hw * 0.88, 0.69, 0.016));
        add(MAT.gloss, band(frontStrip, t, s * hw * 0.48, s * hw * 0.9, 0.69, 0.035));
      }
      // Tail: a lamp across each rear corner that wraps onto the side, under the trunk lip.
      for (const s of [-1, 1]) {
        add(LAMP.red, rearStrip(t, s * hw * 0.32, s * hw * 0.93, 0.83, 0.022));
        add(LAMP.red, sideStrip(t, zr + 0.04, zr + 0.4, 0.83, 0.02, s));
        add(LAMP.redDim, rearStrip(t, s * hw * 0.5, s * hw * 0.9, 0.77, 0.008));
      }
      // Black lower diffuser band across the tail, and a front intake slot.
      add(MAT.trim, band(rearStrip, t, -hw * 0.75, hw * 0.75, 0.36, 0.05));
      add(MAT.trim, band(frontStrip, t, -hw * 0.45, hw * 0.45, 0.3, 0.035));
    },
  }, color);
}
