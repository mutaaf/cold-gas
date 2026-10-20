// The Cab: a two-seat driverless coupe. A short, low nose under a full-width light bar, one glass
// canopy from the screen to behind the seats, then a long fastback with no rear window that ends in
// a full-width red bar. No mirrors (cameras), no handles (the two doors hinge up). Moulded-in
// champagne-gold panels, flat colour-matched wheel covers, and bigger wheels at the back than the
// front. Our own design, sized to the researched numbers (docs/VEHICLES.md).
import { curve, paint, MAT, LAMP } from './kit.js';
import { smoothCar, frontStrip, rearStrip, band } from './smooth.js';

export function cab(spec, color) {
  const L = spec.l, H = spec.h, hw = spec.w / 2;
  const zf = L / 2, zr = -L / 2;
  const fa = spec.axles[0].at, ra = spec.axles[1].at;
  const gz0 = ra + 0.3, gz1 = fa - 0.42;   // canopy: over the rear wheel → the screen base
  // One roofline, screen to tail: the canopy carries it to behind the seats, then the body-coloured
  // fastback (no rear window) takes it down to a short tail.
  const roof = curve([[zr + 0.08, 0.93], [ra - 0.2, 1.1], [ra + 0.3, 1.24], [ra + 0.95, 1.36], [-0.15, H], [0.15, H - 0.01], [gz1 - 0.45, 1.2], [gz1, 0.9]]);
  const top = curve([[zr, 0.8], [zr + 0.08, 0.93], [ra - 0.2, 1.1], [gz0 + 0.02, roof(gz0 + 0.02) - 0.01], [gz0 + 0.3, 0.97], [gz1 - 0.2, 0.92], [gz1, 0.9], [fa - 0.1, 0.8], [zf - 0.25, 0.7], [zf - 0.05, 0.6], [zf, 0.5]]);
  const bot = curve([[zr, 0.44], [zr + 0.3, 0.3], [ra, 0.22], [0, spec.clearance + 0.02], [fa, 0.2], [zf - 0.2, 0.22], [zf, 0.34]]);
  const sh = curve([[zr, 0.7], [ra, 0.8], [0, 0.72], [fa, 0.7], [zf, 0.46]]);
  const half = curve([[zr, hw * 0.78], [zr + 0.4, hw * 0.96], [ra, hw], [0, hw * 0.97], [fa, hw * 0.98], [zf - 0.35, hw * 0.92], [zf, hw * 0.72]]);
  const tt = curve([[zr, 0.3], [gz0 - 0.05, 0.28], [gz0 + 0.3, 0.14], [zf, 0.12]]);
  const gTop = roof;
  const gHw = curve([[gz0, hw * 0.7], [gz0 + 0.4, hw * 0.82], [gz1 - 0.4, hw * 0.86], [gz1, hw * 0.74]]);
  const gold = paint(color, { metal: 0.65, rough: 0.3, coat: 0.6 });
  return smoothCar(spec, {
    paint: gold,
    body: (z) => ({ top: top(z), bot: bot(z), sh: sh(z), hw: half(z), tt: tt(z), tb: 0.1, n: 3.2, nb: 3.2 }),
    glass: (z) => ({ top: gTop(z), bot: Math.min(top(z), gTop(z)) - 0.06, sh: Math.min(top(z), gTop(z) - 0.04) + 0.02, hw: gHw(z), tt: 0.26, tb: 0, n: 3, nb: 4 }),
    glassZ: [gz0 - 0.08, gz1],
    glassRound: 0.05,
    mirrors: null,
    wheelStyle: 'disc',
    wheelMats: { cover: gold, rim: MAT.rimDark },
    lamps(add, t) {
      add(MAT.gloss, band(frontStrip, t, -hw * 0.9, hw * 0.9, 0.66, 0.03));
      add(LAMP.white, frontStrip(t, -hw * 0.88, hw * 0.88, 0.66, 0.009));
      add(MAT.gloss, band(rearStrip, t, -hw * 0.9, hw * 0.9, 0.9, 0.035));
      add(LAMP.red, rearStrip(t, -hw * 0.88, hw * 0.88, 0.9, 0.012));
      add(MAT.trim, band(rearStrip, t, -hw * 0.7, hw * 0.7, 0.42, 0.07));
      add(MAT.trim, band(frontStrip, t, -hw * 0.55, hw * 0.55, 0.33, 0.035));
    },
  }, color);
}
