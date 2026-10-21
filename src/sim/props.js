// LOOSE THINGS: the light objects a car knocks about (traffic cones, plastic barriers) and the parked
// car a player can put in the Sandbox, as rigid bodies with their own mass, centre of mass, inertia,
// colliders and materials. src/sim/world.js streams them into the engine near the car (pooled, asleep
// until something touches them); src/build/render.js draws each one where its body is.
// Pure data and arithmetic. Sources: OFFICIAL / REPORTED / ESTIMATE, as in spec.js and courses.js.
//
// A prop's frame: origin on the ground under its footprint's centre, +y up, +z the way the piece
// faces (src/build/catalogue.js), +x its length for a barrier. Every number is at scale 1; `scaled`
// takes a uniform scale s (mass × s³, inertia × s⁵, lengths × s).
import { LINEUP_SPEC } from './courses.js';
import { dsin, dcos } from './dmath.js';

// Materials (as courses.js MATERIALS: tyre grip, bodywork slide, bounce). ESTIMATES: PVC or rubber
// on dry asphalt/concrete μ ≈ 0.5–0.7 (a cone's rubber base grips; Coulomb tables for elastomers on
// pavement), a polyethylene barrier's skids μ ≈ 0.4–0.5; both rebound more than steel bodywork
// (e ≈ 0.3–0.4, hollow moulded plastic).
export const PROP_MATERIALS = {
  rubber: { id: 'rubber', grip: 0.7, slide: 0.6, bounce: 0.35 },
  plastic: { id: 'plastic', grip: 0.5, slide: 0.45, bounce: 0.3 },
};

// The traffic cone: the 28-inch highway class (the national traffic-control manual's minimum for
// freeways, 0.71 m), a 0.36 m square rubber base 4 cm thick, a PVC cone 0.14 m in radius at its foot
// and 0.03 m at its tip (REPORTED, manufacturers' sheets for the class). 3.2 kg (REPORTED: 7 lb is the
// class's common weight; 10 lb ones carry a heavier base). About 60 % of it is the base (ESTIMATE), so
// the CoM sits 0.12 m up. Inertia about the CoM (ESTIMATE, the base as a slab and the cone as a solid
// cone): Ix = Iz ≈ 0.075, Iy ≈ 0.049 kg·m².
export const CONE = {
  id: 'cone', mass: 3.2, com: 0.12, inertia: { x: 0.075, y: 0.049, z: 0.075 },
  base: { hx: 0.18, hy: 0.02, hz: 0.18 }, cone: { r0: 0.14, r1: 0.03, y0: 0.04, y1: 0.71 },
  h: 0.71, half: 0.18, mat: PROP_MATERIALS.rubber,
};

// The plastic road barrier: a hollow, water-fillable 6 ft (1.83 m) section 32 in (0.81 m) tall, the
// safety-shape profile 0.46 m across its base and 0.20 m across its top (REPORTED, manufacturers'
// sheets). Empty, as a work zone sets them out before filling: 34 kg (REPORTED: 60–80 lb empty for the
// class). CoM 0.36 m up (ESTIMATE: the wide lower half carries more plastic). Inertia (ESTIMATE, a
// uniform box of its bounds): Ix = m(h² + d²)/12, Iy = m(l² + d²)/12, Iz = m(l² + h²)/12.
const BL = 1.83, BH = 0.81, BD = 0.46, BM = 34;
export const BARRIER = {
  id: 'barrier', mass: BM, com: 0.36,
  inertia: { x: (BM * (BH * BH + BD * BD)) / 12, y: (BM * (BL * BL + BD * BD)) / 12, z: (BM * (BL * BL + BH * BH)) / 12 },
  l: BL, h: BH, d: BD, top: 0.2, mat: PROP_MATERIALS.plastic,
};

/** The convex hull points of a prop (Float32Array), at scale s, in its frame. */
export function propPoints(spec, s = 1) {
  const p = [];
  if (spec.id === 'cone') {
    const { r0, r1, y0, y1 } = spec.cone, n = 12;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, cs = dcos(a), sn = dsin(a);
      p.push(r0 * cs * s, y0 * s, r0 * sn * s, r1 * cs * s, y1 * s, r1 * sn * s);
    }
  } else if (spec.id === 'barrier') {
    const hl = (spec.l / 2) * s, b = (spec.d / 2) * s, t = (spec.top / 2) * s, h = spec.h * s;
    for (const x of [-hl, hl]) p.push(x, 0, -b, x, 0, b, x, h, -t, x, h, t);
  }
  return Float32Array.from(p);
}

/** A prop's body at scale s: { kind: 'prop', spec, mass, com, inertia, shapes, mat, ccd, size }. */
export function propBody(spec, s = 1) {
  const s3 = s * s * s, s5 = s3 * s * s;
  const shapes = [{ kind: 'hull', points: propPoints(spec, s) }];
  if (spec.id === 'cone') shapes.push({ kind: 'box', x: 0, y: spec.base.hy * s, z: 0, hx: spec.base.hx * s, hy: spec.base.hy * s, hz: spec.base.hz * s });
  return {
    kind: 'prop', spec, s, mass: spec.mass * s3, com: spec.com * s,
    inertia: { x: spec.inertia.x * s5, y: spec.inertia.y * s5, z: spec.inertia.z * s5 },
    shapes, mat: spec.mat,
    // Light and small: a car at speed moves it more than its own size in a tick, so it sweeps (CCD).
    ccd: true,
    // Its bounding radius from the frame's origin (the render's culling and the bench).
    size: (spec.id === 'cone' ? spec.h : spec.l / 2 + spec.h) * s,
  };
}

// The Sandbox's parked car: the lineup's sedan (courses.js LINEUP_SPEC, every number sourced in
// docs/VEHICLES.md) as the same rigid body on four suspended, parked tyres the scored row uses. At
// scale s it is that sedan scaled: lengths × s, mass × s³, inertia × s⁵ (a toy at 0.5, a monster at 3).
const SEDAN = LINEUP_SPEC.find((v) => v.id === 'sedan');
export function parkedBody(s = 1) {
  const s3 = s * s * s, s5 = s3 * s * s, v = SEDAN;
  const b = {
    ...v, w: v.w * s, l: v.l * s, h: v.h * s, clearance: v.clearance * s, wheelbase: v.wheelbase * s,
    tyreR: v.tyreR * s, tyreW: v.tyreW * s,
    axles: v.axles.map((a) => ({ ...a, at: a.at * s, track: a.track * s, r: a.r * s, w: a.w * s })),
    mass: v.mass * s3, cgHeight: v.cgHeight * s, cgAt: v.cgAt * s,
    inertia: { roll: v.inertia.roll * s5, pitch: v.inertia.pitch * s5, yaw: v.inertia.yaw * s5 },
  };
  // Box form, as courses.js parks the row: length along the frame's x, width along z, centred.
  Object.assign(b, { minX: -b.l / 2, maxX: b.l / 2, minY: 0, maxY: b.h, minZ: -b.w / 2, maxZ: b.w / 2, cz: 0 });
  return { kind: 'parked', vehicle: b, s };
}
